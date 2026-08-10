import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";
import { requireArchitectAdmin, loginRateLimitOk } from "../middleware.js";
import { ARCHITECT_ADMIN_PASSWORD_HASH, MULTI_TENANT, PROJECT_ROOT, _tenantsList, TENANTS_FILE, primaryTenant, updateEnvVar, SITE_URL } from "../config.js";
import { verifyPassword, hashPassword } from "../lib/auth.js";
import { RESERVED_SLUGS } from "../lib/reservedSlugs.js";
import { tenantCaches, lastRefreshTimes, resolveTableIDs, refreshTenant, scaffoldTenantTables } from "../lib/airtable.js";
import { transporter } from "../lib/email.js";
import { writeJsonAtomic, getTenantContent, updateTenantContent, invalidateTenantContent } from "../lib/jsonStore.js";
import { generateCsrfToken } from "../lib/csrf.js";
import { tenantOnboardingEmail } from "../lib/emails/onboarding.js";
import { passwordChangedEmail } from "../lib/emails/passwordChanged.js";

const router = Router();

// Branding uploads (logo / social preview image) — saves to public/{tenant-slug}/branding/.
// Filename is fixed per kind (logo.<ext> / meta.<ext>), not derived from the original
// upload's name, since this is a single canonical current image per kind, not a growing
// gallery — any existing file for that kind is removed first so a re-upload with a
// different extension doesn't leave a stale orphan behind.
function brandingStorage(kind) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(PROJECT_ROOT, "public", req.params.slug, "branding");
      fs.mkdirSync(dir, { recursive: true });
      fs.readdirSync(dir)
        .filter(f => f.startsWith(`${kind}.`))
        .forEach(f => fs.unlinkSync(path.join(dir, f)));
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${kind}${ext}`);
    },
  });
}
const brandingFileFilter = (req, file, cb) => {
  cb(null, /\.(jpe?g|png|webp|gif)$/i.test(file.originalname));
};
// Logos may also be SVG (vector logos are the common case) — social preview images stay
// raster-only since Facebook/Twitter/Slack link-unfurlers don't render SVG.
const logoFileFilter = (req, file, cb) => {
  cb(null, /\.(jpe?g|png|webp|gif|svg)$/i.test(file.originalname));
};
const logoUpload = multer({ storage: brandingStorage("logo"), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: logoFileFilter });
const metaImageUpload = multer({ storage: brandingStorage("meta"), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: brandingFileFilter });

// Strips the parts of an uploaded SVG that could execute script if the file were ever
// opened directly as a top-level document (uploads embedded via <img src> never execute
// scripts regardless, but this is served from the same origin as the tenant site — with
// an X-Content-Type-Options: nosniff header set in lib/app.js — so a direct visit to the
// file's URL should still be safe even for a maliciously crafted SVG). DOMPurify actually
// parses the markup instead of pattern-matching text, so it also catches vectors a regex
// blocklist misses: <foreignObject>/<iframe>/<embed> src, SMIL <animate> attribute
// hijacking, <style>/CSS url(), and entity-encoded scheme strings.
const svgPurify = DOMPurify(new JSDOM("").window);
function sanitizeSvg(svg) {
  return svgPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

// logoUrl/metaImageUrl are normally relative upload paths ("/{slug}/branding/x.png"),
// so an empty value or one with no URI scheme at all is fine; a value that does carry
// an explicit scheme must be http/https (blocks javascript:, data:, vbscript:, etc.).
function isSafeBrandingUrl(value) {
  if (!value) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  return /^https?:\/\//i.test(value);
}

router.get("/architect/login", (req, res) => {
  if (req.session?.architectLoggedIn) return res.redirect("/architect");
  // See the matching comment in routes/admin.js's GET /admin/login — this write forces
  // express-session to actually persist a session cookie now, so the CSRF token
  // generated below stays valid for the POST that follows.
  req.session.csrfSeed = true;
  res.render("architect/login", { error: null, csrfToken: generateCsrfToken(req, res) });
});

router.post("/architect/login", (req, res) => {
  if (!loginRateLimitOk(req.ip)) {
    return res.status(429).render("architect/login", { error: "Too many attempts. Please try again in a few minutes.", csrfToken: generateCsrfToken(req, res) });
  }
  if (!ARCHITECT_ADMIN_PASSWORD_HASH) {
    return res.render("architect/login", { error: "Architect admin password is not configured. Run npm run hash-password and set ARCHITECT_ADMIN_PASSWORD_HASH in .env.", csrfToken: generateCsrfToken(req, res) });
  }
  if (verifyPassword(req.body.password || "", ARCHITECT_ADMIN_PASSWORD_HASH)) {
    // Regenerate on every successful login so a pre-authentication session ID (which
    // could have been fixated by an attacker) never becomes privileged.
    return req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.render("architect/login", { error: "Login failed — please try again.", csrfToken: generateCsrfToken(req, res) });
      }
      req.session.architectLoggedIn = true;
      res.redirect("/architect");
    });
  }
  res.render("architect/login", { error: "Incorrect password.", csrfToken: generateCsrfToken(req, res) });
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
    networkContactEmail: process.env.NETWORK_CONTACT_EMAIL || "",
    siteUrl: SITE_URL,
  };
  const analyticsSettings = {
    plausibleDomain: process.env.PLAUSIBLE_DOMAIN || "",
    plausibleScriptSrc: process.env.PLAUSIBLE_SCRIPT_SRC || "https://analytics.relascale.com/js/script.file-downloads.js",
  };
  res.render("architect/index", { tenants, flash, emailSettings, analyticsSettings, csrfToken: generateCsrfToken(req, res) });
});

router.post("/architect/settings/email", requireArchitectAdmin, (req, res) => {
  const { smtpHost, smtpPort, smtpSecure, networkContactEmail, siteUrl } = req.body;
  const trimmedSiteUrl = (siteUrl || "").trim().replace(/\/+$/, "");
  if (trimmedSiteUrl && !/^https?:\/\//i.test(trimmedSiteUrl)) {
    req.session.architectFlash = { type: "err", msg: "Site domain must start with http:// or https://." };
    return res.redirect("/architect");
  }
  try {
    if (smtpHost?.trim()) updateEnvVar("SMTP_HOST", smtpHost.trim());
    if (smtpPort?.trim()) updateEnvVar("SMTP_PORT", smtpPort.trim());
    updateEnvVar("SMTP_SECURE", smtpSecure === "on" ? "true" : "false");
    if (networkContactEmail?.trim()) updateEnvVar("NETWORK_CONTACT_EMAIL", networkContactEmail.trim());
    updateEnvVar("SITE_URL", trimmedSiteUrl);
    req.session.architectFlash = { type: "ok", msg: "Email settings saved. Restart the server to apply." };
  } catch (err) {
    console.error("Architect email settings error:", err);
    req.session.architectFlash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/architect");
});

router.post("/architect/settings/analytics", requireArchitectAdmin, (req, res) => {
  const { plausibleDomain, plausibleScriptSrc } = req.body;
  try {
    // Blank domain intentionally disables the Plausible script tag (see header.ejs) —
    // there's no separate on/off toggle needed.
    updateEnvVar("PLAUSIBLE_DOMAIN", (plausibleDomain || "").trim());
    updateEnvVar("PLAUSIBLE_SCRIPT_SRC", (plausibleScriptSrc || "").trim());
    req.session.architectFlash = { type: "ok", msg: "Analytics settings saved. Restart the server to apply." };
  } catch (err) {
    console.error("Architect analytics settings error:", err);
    req.session.architectFlash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/architect");
});

router.post("/architect/settings/password", requireArchitectAdmin, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!ARCHITECT_ADMIN_PASSWORD_HASH || !verifyPassword(currentPassword || "", ARCHITECT_ADMIN_PASSWORD_HASH)) {
    req.session.architectFlash = { type: "err", msg: "Current password is incorrect." };
    return res.redirect("/architect");
  }
  if (!newPassword || newPassword.length < 8) {
    req.session.architectFlash = { type: "err", msg: "New password must be at least 8 characters." };
    return res.redirect("/architect");
  }
  if (newPassword !== confirmPassword) {
    req.session.architectFlash = { type: "err", msg: "New password and confirmation don't match." };
    return res.redirect("/architect");
  }
  try {
    updateEnvVar("ARCHITECT_ADMIN_PASSWORD_HASH", hashPassword(newPassword));
    req.session.architectFlash = { type: "ok", msg: "Architect password changed. Restart the server to apply — until then, the old password remains active." };
  } catch (err) {
    console.error("Architect password change error:", err);
    req.session.architectFlash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/architect");
});

router.get("/architect/tenants/new", requireArchitectAdmin, (req, res) => {
  res.render("architect/tenant-form", { errors: null, values: {}, csrfToken: generateCsrfToken(req, res) });
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
  if (RESERVED_SLUGS.includes(trimmedSlug)) {
    errors.push(`Slug "${trimmedSlug}" is reserved and can't be used for a tenant.`);
  }
  if (trimmedSlug && _tenantsList.some(t => t.slug === trimmedSlug)) {
    errors.push(`A tenant with slug "${trimmedSlug}" already exists.`);
  }
  if (adminPassword && adminPassword.length < 8) {
    errors.push("Admin password must be at least 8 characters.");
  }

  if (errors.length) {
    return res.render("architect/tenant-form", { errors, values, csrfToken: generateCsrfToken(req, res) });
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
  writeJsonAtomic(TENANTS_FILE, _tenantsList);

  updateEnvVar(patEnvVar, pat.trim());
  process.env[patEnvVar] = pat.trim();

  const contentFile = path.join(PROJECT_ROOT, "data", `${tenant.slug}.json`);
  writeJsonAtomic(contentFile, {
    meta: { tagline: "", description: "" },
    submitFormUrl: "",
    hero: { heading: tenant.name, subheading: "" },
    team: [],
  });

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
      await refreshTenant(tenant.slug);
      airtableSyncOk = true;
    }
  } catch (err) {
    console.error(`[${tenant.slug}] Initial provisioning refresh failed:`, err);
  }

  const adminUrl = MULTI_TENANT ? `/${tenant.slug}/admin/login` : null;
  const multiTenantNote = "This tenant won't be reachable until MULTI_TENANT=true is set in .env and the server is restarted.";

  try {
    const siteOrigin = SITE_URL || `${req.protocol}://${req.get("host")}`;
    const { subject, text, html } = tenantOnboardingEmail({
      siteOrigin,
      tenant,
      adminUrl: adminUrl ? siteOrigin + adminUrl : null,
      adminPassword: adminPassword.trim(),
      multiTenantNote,
    });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: tenant.contact_recipient, subject, text, html });
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
    await refreshTenant(slug);
    const count = (tenantCaches.get(slug) || []).length;
    req.session.architectFlash = { type: "ok", msg: `Cache refreshed for "${tenant.name}" — ${count} records loaded.` };
  } catch (err) {
    console.error(`[${slug}] Architect cache refresh error:`, err);
    req.session.architectFlash = { type: "err", msg: `Cache refresh failed for "${tenant.name}": ${err.message}` };
  }
  res.redirect("/architect");
});

router.post("/architect/tenants/:slug/reset-password", requireArchitectAdmin, async (req, res) => {
  const { slug } = req.params;
  const { newPassword } = req.body;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  if (!newPassword || newPassword.length < 8) {
    req.session.architectFlash = { type: "err", msg: "New password must be at least 8 characters." };
    return res.redirect("/architect");
  }
  // No current-password check here — this is the recovery path for a forgotten or
  // never-configured tenant admin password, which the self-service form on /admin
  // (routes/admin.js) can't handle since it requires knowing the current one.
  tenant.adminPasswordHash = hashPassword(newPassword);
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  try {
    const siteOrigin = SITE_URL || `${req.protocol}://${req.get("host")}`;
    const { subject, text, html } = passwordChangedEmail({ siteOrigin, tenant, reason: "by an administrator" });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: tenant.contact_recipient, subject, text, html });
  } catch (err) {
    console.error(`[${tenant.slug}] Password-changed email failed to send:`, err);
  }
  req.session.architectFlash = { type: "ok", msg: `Password reset for "${tenant.name}".` };
  res.redirect("/architect");
});

router.post("/architect/tenants/:slug/link", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const { externalUrl } = req.body;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  const trimmed = (externalUrl || "").trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    req.session.architectFlash = { type: "err", msg: "External URL must start with http:// or https://." };
    return res.redirect("/architect");
  }
  // Used by the network landing page's repository card to link out to a tenant hosted
  // on its own server (e.g. RelaScale) instead of this deployment's /{slug} route — the
  // /{slug} route stays live either way so the tenant still participates in cross-tenant
  // search.
  if (trimmed) tenant.externalUrl = trimmed;
  else delete tenant.externalUrl;
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  req.session.architectFlash = { type: "ok", msg: trimmed ? `External link set for "${tenant.name}".` : `External link cleared for "${tenant.name}".` };
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
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  req.session.architectFlash = { type: "ok", msg: `Tenant "${tenant.name}" ${tenant.active ? "activated" : "deactivated"}.` };
  res.redirect("/architect");
});

router.post("/architect/tenants/:slug/toggle-new", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  tenant.markedNew = !tenant.markedNew;
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  req.session.architectFlash = { type: "ok", msg: `Tenant "${tenant.name}" ${tenant.markedNew ? "marked as new" : "unmarked as new"}.` };
  res.redirect("/architect");
});

router.get("/architect/tenants/:slug/branding", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  let content = {};
  try {
    content = getTenantContent(slug);
  } catch {
    // Corrupt content file — defaults below cover it; this is a read path, so
    // defaulting for display is fine (see lib/jsonStore.js's write path for the
    // distinction that matters).
  }
  const flash = req.session.architectFlash || null;
  delete req.session.architectFlash;
  res.render("architect/tenant-branding", {
    tenant,
    logoUrl: content.logoUrl || "",
    metaImageUrl: content.metaImageUrl || "",
    logoColor: content.logoColor || "",
    flash,
    csrfToken: generateCsrfToken(req, res),
  });
});

router.post("/architect/tenants/:slug/branding", requireArchitectAdmin, (req, res) => {
  const { slug } = req.params;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    req.session.architectFlash = { type: "err", msg: `No tenant found with slug "${slug}".` };
    return res.redirect("/architect");
  }
  const { logoUrl, metaImageUrl } = req.body;
  const trimmedLogoUrl = (logoUrl || "").trim();
  const trimmedMetaImageUrl = (metaImageUrl || "").trim();
  // Unlike externalUrl (always a full http(s) link), these are normally relative
  // upload paths like "/{slug}/branding/logo.png" — so the check isn't "must be
  // http(s)" but "must not be a dangerous scheme" (javascript:, data:, etc.) when a
  // scheme is present at all.
  if (!isSafeBrandingUrl(trimmedLogoUrl) || !isSafeBrandingUrl(trimmedMetaImageUrl)) {
    req.session.architectFlash = { type: "err", msg: "Logo/meta image URL must be a relative path or an http:// / https:// link." };
    return res.redirect(`/architect/tenants/${slug}/branding`);
  }
  try {
    updateTenantContent(slug, (content) => {
      content.logoUrl = trimmedLogoUrl;
      content.metaImageUrl = trimmedMetaImageUrl;
    });
    req.session.architectFlash = { type: "ok", msg: "Branding saved." };
  } catch (err) {
    console.error(`[${slug}] Architect branding save error:`, err);
    req.session.architectFlash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(`/architect/tenants/${slug}/branding`);
});

router.post("/architect/tenants/:slug/branding/upload-logo", requireArchitectAdmin, (req, res) => {
  const tenant = _tenantsList.find(t => t.slug === req.params.slug);
  if (!tenant) return res.status(404).json({ error: "Unknown tenant." });
  logoUpload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type." });
    if (path.extname(req.file.filename).toLowerCase() === ".svg") {
      try {
        const raw = fs.readFileSync(req.file.path, "utf8");
        fs.writeFileSync(req.file.path, sanitizeSvg(raw), "utf8");
      } catch (err) {
        console.error(`[${req.params.slug}] SVG sanitization error:`, err);
        return res.status(400).json({ error: "Could not process SVG file." });
      }
    }
    res.json({ path: `/${req.params.slug}/branding/${req.file.filename}` });
  });
});

router.post("/architect/tenants/:slug/branding/upload-meta-image", requireArchitectAdmin, (req, res) => {
  const tenant = _tenantsList.find(t => t.slug === req.params.slug);
  if (!tenant) return res.status(404).json({ error: "Unknown tenant." });
  metaImageUpload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type." });
    res.json({ path: `/${req.params.slug}/branding/${req.file.filename}` });
  });
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
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  tenantCaches.delete(slug);
  lastRefreshTimes.delete(slug);
  invalidateTenantContent(slug);
  req.session.architectFlash = { type: "ok", msg: `Tenant "${removed.name}" deleted. Its on-disk cache and data files were preserved.` };
  res.redirect("/architect");
});

export default router;
