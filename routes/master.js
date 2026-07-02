import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireMasterAdmin } from "../middleware.js";
import { MASTER_ADMIN_PASSWORD_HASH, MULTI_TENANT, _tenantsList, TENANTS_FILE, updateEnvVar } from "../config.js";
import { verifyPassword, hashPassword } from "../lib/auth.js";
import { tenantCaches, lastRefreshTimes, resolveTableIDs, runFullRefresh, scaffoldTenantTables } from "../lib/airtable.js";
import { transporter } from "../lib/email.js";

const router = Router();

router.get("/master/login", (req, res) => {
  if (req.session?.masterLoggedIn) return res.redirect("/master");
  res.render("master/login", { error: null });
});

router.post("/master/login", (req, res) => {
  if (!MASTER_ADMIN_PASSWORD_HASH) {
    return res.render("master/login", { error: "Master admin password is not configured. Run npm run hash-password and set MASTER_ADMIN_PASSWORD_HASH in .env." });
  }
  if (verifyPassword(req.body.password || "", MASTER_ADMIN_PASSWORD_HASH)) {
    req.session.masterLoggedIn = true;
    return res.redirect("/master");
  }
  res.render("master/login", { error: "Incorrect password." });
});

router.post("/master/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/master/login"));
});

router.get("/master", requireMasterAdmin, (req, res) => {
  const tenants = _tenantsList.map(t => ({
    ...t,
    recordCount: (tenantCaches.get(t.slug) || []).length,
    lastRefresh: lastRefreshTimes.get(t.slug) || null,
    active: t.active !== false,
  }));
  const flash = req.session.masterFlash || null;
  delete req.session.masterFlash;
  res.render("master/index", { tenants, flash });
});

router.get("/master/tenants/new", requireMasterAdmin, (req, res) => {
  res.render("master/tenant-form", { errors: null, values: {} });
});

router.post("/master/tenants", requireMasterAdmin, async (req, res) => {
  const { name, slug, contact_email, baseId, pat, adminPassword, scaffoldTables } = req.body;
  const values = { name, slug, contact_email, baseId, pat: "", adminPassword: "", scaffoldTables };

  const errors = [];
  if (!name?.trim())          errors.push("Name is required.");
  if (!slug?.trim())          errors.push("Slug is required.");
  if (!contact_email?.trim()) errors.push("Contact email is required.");
  if (!baseId?.trim())        errors.push("Airtable Base ID is required.");
  if (!pat?.trim())           errors.push("Airtable PAT is required.");
  if (!adminPassword)         errors.push("Admin password is required.");

  const trimmedSlug = slug?.trim() || "";
  if (trimmedSlug && !/^[a-z0-9-]+$/.test(trimmedSlug)) {
    errors.push("Slug can only contain lowercase letters, numbers, and hyphens.");
  }
  if (trimmedSlug === "master") {
    errors.push('Slug "master" is reserved for the master admin panel.');
  }
  if (trimmedSlug && _tenantsList.some(t => t.slug === trimmedSlug)) {
    errors.push(`A tenant with slug "${trimmedSlug}" already exists.`);
  }
  if (adminPassword && adminPassword.length < 8) {
    errors.push("Admin password must be at least 8 characters.");
  }

  if (errors.length) {
    return res.render("master/tenant-form", { errors, values });
  }

  const patEnvVar = trimmedSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_PAT";
  const adminPasswordHash = hashPassword(adminPassword);
  const tenant = {
    slug: trimmedSlug,
    name: name.trim(),
    patEnvVar,
    baseId: baseId.trim(),
    adminPasswordHash,
    contact_recipient: contact_email.trim(),
    active: true,
  };

  _tenantsList.push(tenant);
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(_tenantsList, null, 2), "utf8");

  updateEnvVar(patEnvVar, pat.trim());
  process.env[patEnvVar] = pat.trim();

  const contentFile = path.join(process.cwd(), "data", `${tenant.slug}.json`);
  fs.writeFileSync(contentFile, JSON.stringify({
    meta: { tagline: "", description: "" },
    submitFormUrl: "",
    hero: { heading: tenant.name, subheading: "" },
    team: [],
  }, null, 2), "utf8");

  let scaffoldResult = null;
  if (scaffoldTables) {
    try {
      scaffoldResult = await scaffoldTenantTables(pat.trim(), tenant.baseId);
    } catch (err) {
      console.error(`[${tenant.slug}] Table scaffolding failed:`, err);
    }
  }

  let airtableSyncOk = false;
  try {
    const resolved = await resolveTableIDs(tenant);
    if (resolved) {
      await runFullRefresh(tenant.slug);
      airtableSyncOk = true;
    }
  } catch (err) {
    console.error(`[${tenant.slug}] Initial provisioning refresh failed:`, err);
  }

  const adminUrl = MULTI_TENANT ? `/${tenant.slug}/admin/login` : null;
  const multiTenantNote = "This tenant won't be reachable until MULTI_TENANT=true is set in .env and the server is restarted.";

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: tenant.contact_recipient,
      subject: "Your ManyScale tenant is ready",
      text: [
        `Hi,`,
        ``,
        `Your ManyScale tenant "${tenant.name}" (slug: ${tenant.slug}) has been created.`,
        ``,
        adminUrl
          ? `You can log in to your admin panel at: ${adminUrl}`
          : multiTenantNote,
      ].join("\n"),
    });
  } catch (err) {
    console.error(`[${tenant.slug}] Onboarding email failed to send:`, err);
  }

  res.render("master/tenant-created", {
    tenant,
    airtableSyncOk,
    adminUrl,
    multiTenantNote,
    scaffoldResult,
  });
});

router.post("/master/tenants/:slug/refresh-cache", requireMasterAdmin, async (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.masterFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/master");
  }
  try {
    await runFullRefresh(slug);
    const count = (tenantCaches.get(slug) || []).length;
    req.session.masterFlash = { type: "ok", msg: `Cache refreshed for "${tenant.name}" — ${count} records loaded.` };
  } catch (err) {
    console.error(`[${slug}] Master cache refresh error:`, err);
    req.session.masterFlash = { type: "err", msg: `Cache refresh failed for "${tenant.name}": ${err.message}` };
  }
  res.redirect("/master");
});

router.post("/master/tenants/:slug/toggle-active", requireMasterAdmin, (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.masterFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/master");
  }
  const wasActive = tenant.active !== false;
  tenant.active = !wasActive;
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(_tenantsList, null, 2), "utf8");
  req.session.masterFlash = { type: "ok", msg: `Tenant "${tenant.name}" ${tenant.active ? "activated" : "deactivated"}.` };
  res.redirect("/master");
});

router.post("/master/tenants/:slug/delete", requireMasterAdmin, (req, res) => {
  const { slug } = req.params;
  const { confirmSlug } = req.body;
  const idx = _tenantsList.findIndex(t => t.slug === slug);
  if (idx === -1) {
    req.session.masterFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/master");
  }
  if (confirmSlug !== slug) {
    req.session.masterFlash = { type: "err", msg: `Deletion not confirmed — typed slug didn't match "${slug}".` };
    return res.redirect("/master");
  }
  const [removed] = _tenantsList.splice(idx, 1);
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(_tenantsList, null, 2), "utf8");
  tenantCaches.delete(slug);
  lastRefreshTimes.delete(slug);
  req.session.masterFlash = { type: "ok", msg: `Tenant "${removed.name}" deleted. Its on-disk cache and data files were preserved.` };
  res.redirect("/master");
});

export default router;
