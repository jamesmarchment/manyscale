import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireArchitectAdmin } from "../middleware.js";
import { ARCHITECT_ADMIN_PASSWORD_HASH, MULTI_TENANT, PROJECT_ROOT, _tenantsList, TENANTS_FILE, primaryTenant, updateEnvVar } from "../config.js";
import { verifyPassword, hashPassword } from "../lib/auth.js";
import { tenantCaches, lastRefreshTimes, resolveTableIDs, runFullRefresh, scaffoldTenantTables } from "../lib/airtable.js";
import { transporter } from "../lib/email.js";

const router = Router();

router.get("/architect/login", (req, res) => {
  if (req.session?.architectLoggedIn) return res.redirect("/architect");
  res.render("architect/login", { error: null });
});

router.post("/architect/login", (req, res) => {
  if (!ARCHITECT_ADMIN_PASSWORD_HASH) {
    return res.render("architect/login", { error: "Architect admin password is not configured. Run npm run hash-password and set ARCHITECT_ADMIN_PASSWORD_HASH in .env." });
  }
  if (verifyPassword(req.body.password || "", ARCHITECT_ADMIN_PASSWORD_HASH)) {
    req.session.architectLoggedIn = true;
    return res.redirect("/architect");
  }
  res.render("architect/login", { error: "Incorrect password." });
});

router.post("/architect/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/architect/login"));
});

router.get("/architect", requireArchitectAdmin, (req, res) => {
  const tenants = _tenantsList.map(t => ({
    ...t,
    recordCount: (tenantCaches.get(t.slug) || []).length,
    lastRefresh: lastRefreshTimes.get(t.slug) || null,
    active: t.active !== false,
    // In multi-tenant mode every tenant's admin panel is reachable at /{slug}/admin.
    // In single-tenant mode only the primary tenant is reachable at all, at /admin.
    adminUrl: MULTI_TENANT ? `/${t.slug}/admin` : (t.slug === primaryTenant.slug ? "/admin" : null),
  }));
  const flash = req.session.architectFlash || null;
  delete req.session.architectFlash;
  const emailSettings = {
    host: process.env.SMTP_HOST || "mail.manyscale.org",
    port: process.env.SMTP_PORT || "465",
    secure: process.env.SMTP_SECURE !== "false",
  };
  res.render("architect/index", { tenants, flash, emailSettings });
});

router.post("/architect/settings/email", requireArchitectAdmin, (req, res) => {
  const { smtpHost, smtpPort, smtpSecure } = req.body;
  try {
    if (smtpHost?.trim()) updateEnvVar("SMTP_HOST", smtpHost.trim());
    if (smtpPort?.trim()) updateEnvVar("SMTP_PORT", smtpPort.trim());
    updateEnvVar("SMTP_SECURE", smtpSecure === "on" ? "true" : "false");
    req.session.architectFlash = { type: "ok", msg: "Email settings saved. Restart the server to apply." };
  } catch (err) {
    console.error("Architect email settings error:", err);
    req.session.architectFlash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/architect");
});

router.get("/architect/tenants/new", requireArchitectAdmin, (req, res) => {
  res.render("architect/tenant-form", { errors: null, values: {} });
});

router.post("/architect/tenants", requireArchitectAdmin, async (req, res) => {
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
  if (trimmedSlug === "architect") {
    errors.push('Slug "architect" is reserved for the architect admin panel.');
  }
  if (trimmedSlug && _tenantsList.some(t => t.slug === trimmedSlug)) {
    errors.push(`A tenant with slug "${trimmedSlug}" already exists.`);
  }
  if (adminPassword && adminPassword.length < 8) {
    errors.push("Admin password must be at least 8 characters.");
  }

  if (errors.length) {
    return res.render("architect/tenant-form", { errors, values });
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

  const contentFile = path.join(PROJECT_ROOT, "data", `${tenant.slug}.json`);
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

  res.render("architect/tenant-created", {
    tenant,
    airtableSyncOk,
    adminUrl,
    multiTenantNote,
    scaffoldResult,
  });
});

router.post("/architect/tenants/:slug/refresh-cache", requireArchitectAdmin, async (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  try {
    await runFullRefresh(slug);
    const count = (tenantCaches.get(slug) || []).length;
    req.session.architectFlash = { type: "ok", msg: `Cache refreshed for "${tenant.name}" — ${count} records loaded.` };
  } catch (err) {
    console.error(`[${slug}] Architect cache refresh error:`, err);
    req.session.architectFlash = { type: "err", msg: `Cache refresh failed for "${tenant.name}": ${err.message}` };
  }
  res.redirect("/architect");
});

router.post("/architect/tenants/:slug/toggle-active", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  const wasActive = tenant.active !== false;
  tenant.active = !wasActive;
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(_tenantsList, null, 2), "utf8");
  req.session.architectFlash = { type: "ok", msg: `Tenant "${tenant.name}" ${tenant.active ? "activated" : "deactivated"}.` };
  res.redirect("/architect");
});

router.post("/architect/tenants/:slug/delete", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const { confirmSlug } = req.body;
  const idx = _tenantsList.findIndex(t => t.slug === slug);
  if (idx === -1) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  if (confirmSlug !== slug) {
    req.session.architectFlash = { type: "err", msg: `Deletion not confirmed — typed slug didn't match "${slug}".` };
    return res.redirect("/architect");
  }
  const [removed] = _tenantsList.splice(idx, 1);
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(_tenantsList, null, 2), "utf8");
  tenantCaches.delete(slug);
  lastRefreshTimes.delete(slug);
  req.session.architectFlash = { type: "ok", msg: `Tenant "${removed.name}" deleted. Its on-disk cache and data files were preserved.` };
  res.redirect("/architect");
});

export default router;
