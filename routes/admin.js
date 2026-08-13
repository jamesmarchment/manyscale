import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { requireAdmin, loginRateLimitOk, forgotPasswordRateLimitOk } from "../middleware.js";
import { tenantCaches, lastRefreshTimes, refreshTenant, syncTenantPDFs, refreshTenantCacheOnly } from "../lib/airtable.js";
import { TENANTS_FILE, PROJECT_ROOT, _tenantsList, updateEnvVar, SITE_URL } from "../config.js";
import { verifyPassword, hashPassword, safeTokenEqual, createPasswordResetToken, verifyPasswordResetToken } from "../lib/auth.js";
import { COLOR_PRESETS, TAG_COLOR_RECIPES, DEFAULT_RECIPE_FOR_PRESET } from "../lib/colorPresets.js";
import { writeJsonAtomic, getTenantContent, updateTenantContent } from "../lib/jsonStore.js";
import { generateCsrfToken } from "../lib/csrf.js";
import { transporter } from "../lib/email.js";
import { passwordChangedEmail } from "../lib/emails/passwordChanged.js";
import { passwordResetRequestEmail } from "../lib/emails/passwordReset.js";

// Normalizes a bracket-indexed form field (parsed by express.urlencoded as either an
// array or, if indices have gaps, a plain object keyed by index) into an ordered array.
function toOrderedArray(raw) {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  const indices = Object.keys(raw).map(Number).sort((a, b) => a - b);
  return indices.map(i => raw[i]);
}

const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// "jo***@example.com" — enough for a tenant admin to recognize their own address on the
// forgot-password page without printing it in full on an unauthenticated page.
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "the address on file";
  return `${local.slice(0, 2)}***@${domain}`;
}

const router = Router();

// Photo upload — saves to public/{tenant-slug}/team/
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PROJECT_ROOT, "public", req.tenant.slug, "team");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 60);
    cb(null, `${base}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /\.(jpe?g|png|webp|gif)$/i.test(file.originalname));
  },
});


router.get("/admin/login", (req, res) => {
  if (req.session?.adminLoggedIn && req.session?.adminTenantSlug === req.tenant.slug) {
    return res.redirect(res.locals.basePath + "/admin");
  }
  // With saveUninitialized:false, express-session won't persist (or keep a stable id
  // for) a session that nothing has written to — writing this marker now means the
  // browser gets a real session cookie with this page's response, so the CSRF token
  // generated below stays valid for the POST that follows.
  req.session.csrfSeed = true;
  const notice = req.session.notice || null;
  delete req.session.notice;
  res.render("admin/login", { error: null, notice, csrfToken: generateCsrfToken(req, res) });
});

router.post("/admin/login", (req, res) => {
  if (!loginRateLimitOk(`${req.ip}:${req.tenant.slug}`)) {
    return res.status(429).render("admin/login", { error: "Too many attempts. Please try again in a few minutes.", csrfToken: generateCsrfToken(req, res) });
  }
  const adminPasswordHash = req.tenant.adminPasswordHash;
  if (!adminPasswordHash) return res.render("admin/login", { error: "Admin password is not configured for this tenant. Run npm run hash-password to generate one.", csrfToken: generateCsrfToken(req, res) });
  if (verifyPassword(req.body.password || "", adminPasswordHash)) {
    const tenantSlug = req.tenant.slug;
    const basePath = res.locals.basePath;
    // Regenerate on every successful login so a session ID that existed before
    // authentication (which could have been fixated by an attacker) never becomes
    // privileged — the client gets a brand-new session ID here.
    return req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.render("admin/login", { error: "Login failed — please try again.", csrfToken: generateCsrfToken(req, res) });
      }
      req.session.adminLoggedIn = true;
      req.session.adminTenantSlug = tenantSlug;
      res.redirect(basePath + "/admin");
    });
  }
  res.render("admin/login", { error: "Incorrect password.", csrfToken: generateCsrfToken(req, res) });
});

router.post("/admin/logout", (req, res) => {
  const loginPath = res.locals.basePath + "/admin/login";
  req.session.destroy(() => res.redirect(loginPath));
});

router.get("/admin/forgot-password", (req, res) => {
  req.session.csrfSeed = true;
  res.render("admin/forgot-password", {
    maskedEmail: maskEmail(req.tenant.contact_recipient),
    sent: false,
    csrfToken: generateCsrfToken(req, res),
  });
});

router.post("/admin/forgot-password", async (req, res) => {
  const tenant = req.tenant;
  if (!forgotPasswordRateLimitOk(`${req.ip}:${tenant.slug}`)) {
    return res.status(429).render("admin/forgot-password", {
      maskedEmail: maskEmail(tenant.contact_recipient),
      sent: false,
      error: "Too many requests. Please try again in a few minutes.",
      csrfToken: generateCsrfToken(req, res),
    });
  }
  try {
    const siteOrigin = SITE_URL || `${req.protocol}://${req.get("host")}`;
    const token = createPasswordResetToken(tenant);
    const resetUrl = `${siteOrigin}${res.locals.basePath}/admin/reset-password?token=${token}`;
    const { subject, text, html } = passwordResetRequestEmail({ siteOrigin, tenant, resetUrl, expiresInMinutes: 60 });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: tenant.contact_recipient, subject, text, html });
  } catch (err) {
    console.error(`[${tenant.slug}] Password-reset email failed to send:`, err);
  }
  res.render("admin/forgot-password", { maskedEmail: maskEmail(tenant.contact_recipient), sent: true, csrfToken: generateCsrfToken(req, res) });
});

router.get("/admin/reset-password", (req, res) => {
  const { token } = req.query;
  // Verified against req.tenant — the tenant resolveTenant already resolved from the
  // URL — not a tenant re-derived from the token itself. verifyPasswordResetToken checks
  // the token's embedded slug against tenant.slug internally, so this also guarantees a
  // token can only ever be used under the URL of the exact tenant it was issued for; it
  // can't succeed while acting on a different tenant than resolveTenant put us on.
  const valid = verifyPasswordResetToken(token, req.tenant);
  req.session.csrfSeed = true;
  res.render("admin/reset-password", { token, valid, error: null, csrfToken: generateCsrfToken(req, res) });
});

router.post("/admin/reset-password", async (req, res) => {
  const { token, new_password, confirm_password } = req.body;
  const tenant = req.tenant;
  if (!verifyPasswordResetToken(token, tenant)) {
    return res.render("admin/reset-password", { token, valid: false, error: null, csrfToken: generateCsrfToken(req, res) });
  }
  if (!new_password || new_password.length < 8) {
    return res.render("admin/reset-password", { token, valid: true, error: "New password must be at least 8 characters.", csrfToken: generateCsrfToken(req, res) });
  }
  if (new_password !== confirm_password) {
    return res.render("admin/reset-password", { token, valid: true, error: "New password and confirmation don't match.", csrfToken: generateCsrfToken(req, res) });
  }
  tenant.adminPasswordHash = hashPassword(new_password);
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  try {
    const siteOrigin = SITE_URL || `${req.protocol}://${req.get("host")}`;
    const { subject, text, html } = passwordChangedEmail({ siteOrigin, tenant, reason: "via a password reset link" });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: tenant.contact_recipient, subject, text, html });
  } catch (err) {
    console.error(`[${tenant.slug}] Password-changed email failed to send:`, err);
  }
  req.session.notice = "Password reset. You can log in with your new password.";
  res.redirect(res.locals.basePath + "/admin/login");
});

router.get("/admin", requireAdmin, (req, res) => {
  const tenant = req.tenant;
  let hero = {}, submitFormUrl = "", team = [], whyMarkdown = "";
  let bubbleChartPreset = "default", cardGradientsPreset = "default", tagColorsPreset = "default";
  let bubbleChartColors = COLOR_PRESETS.bubbleChart.default;
  let cardGradients     = COLOR_PRESETS.cardGradients.default;
  let tagColors         = COLOR_PRESETS.tagColors.default;
  let tagRecipe         = "pastel";
  try {
    const content = getTenantContent(tenant.slug);
    hero = content.hero || {};
    submitFormUrl = content.submitFormUrl || "";
    team = content.team || [];
    whyMarkdown = content.whyMarkdown || "";
    bubbleChartPreset   = content.bubbleChartPreset   || "default";
    cardGradientsPreset = content.cardGradientsPreset || "default";
    tagColorsPreset     = content.tagColorsPreset     || "default";
    bubbleChartColors = content.bubbleChartColors || bubbleChartColors;
    cardGradients     = content.cardGradients     || cardGradients;
    // A tenant saved before palettes shrank to 16 accents may still hold a 24-entry
    // snapshot — self-heal by re-pulling the current preset's array (see middleware.js
    // for the matching public-site fallback).
    tagColors = (Array.isArray(content.tagColors) && content.tagColors.length === 16)
      ? content.tagColors
      : (COLOR_PRESETS.tagColors[tagColorsPreset] || tagColors);
    tagRecipe = content.tagRecipe || DEFAULT_RECIPE_FOR_PRESET[tagColorsPreset] || "pastel";
  } catch {}
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render("admin/index", {
    tenant,
    hero,
    submitFormUrl,
    team,
    whyMarkdown,
    colorPresets: COLOR_PRESETS,
    bubbleChartPreset, cardGradientsPreset, tagColorsPreset,
    bubbleChartColors, cardGradients, tagColors, tagRecipe,
    recordCount: (tenantCaches.get(req.tenant.slug) || []).length,
    lastRefresh: lastRefreshTimes.get(req.tenant.slug) || null,
    flash,
    csrfToken: generateCsrfToken(req, res),
  });
});

router.post("/admin/config", requireAdmin, (req, res) => {
  const { name, baseId, pat, contact_recipient } = req.body;
  const tenant = req.tenant; // same object reference held in _tenantsList (see resolveTenant
  // in middleware.js) — mutate it directly, same pattern as /admin/password below.
  // Previously this route re-parsed tenants.json into a disconnected local array instead
  // of mutating _tenantsList, so the very next write from any /architect/tenants/* route
  // (which always serializes the shared _tenantsList) would silently revert this save.
  try {
    if (name?.trim())               tenant.name               = name.trim();
    if (baseId?.trim())             tenant.baseId             = baseId.trim();
    if (contact_recipient !== undefined) tenant.contact_recipient = contact_recipient.trim();
    writeJsonAtomic(TENANTS_FILE, _tenantsList);
    if (pat?.trim()) {
      const patVar = tenant.patEnvVar || "AIRTABLE_PAT";
      updateEnvVar(patVar, pat.trim());
    }
    req.session.flash = { type: "ok", msg: "Configuration saved. Restart the server to apply PAT or Base ID changes." };
  } catch (err) {
    console.error("Admin config error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/password", requireAdmin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const tenant = req.tenant;
  if (!verifyPassword(current_password || "", tenant.adminPasswordHash || "")) {
    req.session.flash = { type: "err", msg: "Current password is incorrect." };
    return res.redirect(res.locals.basePath + "/admin");
  }
  if (!new_password || new_password.length < 8) {
    req.session.flash = { type: "err", msg: "New password must be at least 8 characters." };
    return res.redirect(res.locals.basePath + "/admin");
  }
  if (new_password !== confirm_password) {
    req.session.flash = { type: "err", msg: "New password and confirmation don't match." };
    return res.redirect(res.locals.basePath + "/admin");
  }
  try {
    // tenant is the same object reference held in _tenantsList (see resolveTenant in
    // middleware.js), so this mutation is visible to every request immediately —
    // no server restart needed, unlike the PAT/Base ID fields below.
    tenant.adminPasswordHash = hashPassword(new_password);
    writeJsonAtomic(TENANTS_FILE, _tenantsList);
    req.session.flash = { type: "ok", msg: "Password changed." };
    try {
      const siteOrigin = SITE_URL || `${req.protocol}://${req.get("host")}`;
      const { subject, text, html } = passwordChangedEmail({ siteOrigin, tenant, reason: "from your account settings" });
      await transporter.sendMail({ from: process.env.SMTP_USER, to: tenant.contact_recipient, subject, text, html });
    } catch (err) {
      console.error(`[${tenant.slug}] Password-changed email failed to send:`, err);
    }
  } catch (err) {
    console.error("Admin password change error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/content", requireAdmin, (req, res) => {
  const { hero_heading, hero_subheading, meta_tagline, meta_description, landing_tagline, submit_form_url, why_markdown } = req.body;
  try {
    updateTenantContent(req.tenant.slug, (content) => {
      if (!content.hero) content.hero = {};
      if (!content.meta) content.meta = {};
      if (hero_heading      !== undefined) content.hero.heading     = hero_heading;
      if (hero_subheading   !== undefined) content.hero.subheading  = hero_subheading;
      if (meta_tagline      !== undefined) content.meta.tagline     = meta_tagline;
      if (meta_description  !== undefined) content.meta.description = meta_description;
      if (landing_tagline   !== undefined) content.landingTagline   = landing_tagline;
      if (submit_form_url   !== undefined) content.submitFormUrl    = submit_form_url;
      if (why_markdown      !== undefined) content.whyMarkdown      = why_markdown;
    });
    req.session.flash = { type: "ok", msg: "Site content saved." };
  } catch (err) {
    console.error("Admin content error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/colors", requireAdmin, (req, res) => {
  const { bubbleChartPreset, bubbleColors, cardGradientsPreset, cardGradients, tagColorsPreset, tagColors, tagRecipe, logo_color, landing_header_color, landing_accent_color } = req.body;
  try {
    updateTenantContent(req.tenant.slug, (content) => {
      if (isHex(logo_color)) content.logoColor = logo_color.toLowerCase();
      if (isHex(landing_header_color)) content.landingHeaderColor = landing_header_color.toLowerCase();
      if (isHex(landing_accent_color)) content.landingAccentColor = landing_accent_color.toLowerCase();

      const bubbleArr = toOrderedArray(bubbleColors);
      if (bubbleArr.length === 12 && bubbleArr.every(isHex)) {
        content.bubbleChartColors = bubbleArr.map(c => c.toLowerCase());
        content.bubbleChartPreset = bubbleChartPreset || "custom";
      }

      const gradientArr = toOrderedArray(cardGradients);
      if (gradientArr.length === 12 && gradientArr.every(g => g && isHex(g.from) && isHex(g.to))) {
        content.cardGradients = gradientArr.map(g => ({ from: g.from.toLowerCase(), to: g.to.toLowerCase() }));
        content.cardGradientsPreset = cardGradientsPreset || "custom";
      }

      const tagArr = toOrderedArray(tagColors);
      if (tagArr.length === 16 && tagArr.every(isHex)) {
        content.tagColors = tagArr.map(c => c.toLowerCase());
        content.tagColorsPreset = tagColorsPreset || "custom";
      }

      // Recipe/style is always one of the 4 fixed names (never "custom" — it has no
      // per-palette variant to fall back to), independent of which palette was saved above.
      if (Object.prototype.hasOwnProperty.call(TAG_COLOR_RECIPES, tagRecipe)) {
        content.tagRecipe = tagRecipe;
      }
    });
    req.session.flash = { type: "ok", msg: "Colors saved." };
  } catch (err) {
    console.error("Admin colors error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/cache", requireAdmin, async (req, res) => {
  try {
    await refreshTenant(req.tenant.slug);
    const count = (tenantCaches.get(req.tenant.slug) || []).length;
    req.session.flash = { type: "ok", msg: `Cache refreshed — ${count} records loaded.` };
  } catch (err) {
    console.error("Admin cache refresh error:", err);
    req.session.flash = { type: "err", msg: "Refresh failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/sync-pdfs", requireAdmin, async (req, res) => {
  try {
    await syncTenantPDFs(req.tenant.slug);
    req.session.flash = { type: "ok", msg: "PDF sync complete." };
  } catch (err) {
    console.error("Admin PDF sync error:", err);
    req.session.flash = { type: "err", msg: "PDF sync failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/team/upload-photo", requireAdmin, (req, res) => {
  photoUpload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type." });
    res.json({ path: `/${req.tenant.slug}/team/${req.file.filename}` });
  });
});

router.post("/admin/team", requireAdmin, (req, res) => {
  try {
    updateTenantContent(req.tenant.slug, (content) => {
      const raw = req.body.team || {};
      const indices = Array.isArray(raw)
        ? raw.map((_, i) => i)
        : Object.keys(raw).map(Number).sort((a, b) => a - b);
      const members = Array.isArray(raw) ? raw : indices.map(i => raw[i]);
      content.team = members.map(m => {
        const entry = {
          name:  (m.name  || "").trim(),
          title: (m.title || "").trim(),
          photo: (m.photo || "").trim(),
          bio:   (m.bio   || "").trim(),
        };
        if (m.linkedin?.trim())  entry.linkedin  = m.linkedin.trim();
        if (m.twitter?.trim())   entry.twitter   = m.twitter.trim();
        if (m.github?.trim())    entry.github    = m.github.trim();
        if (m.instagram?.trim()) entry.instagram = m.instagram.trim();
        if (m.website?.trim())   entry.website   = m.website.trim();
        if (m.scholar?.trim())   entry.scholar   = m.scholar.trim();
        if (m.bluesky?.trim())   entry.bluesky   = m.bluesky.trim();
        return entry;
      });
    });
    req.session.flash = { type: "ok", msg: "Team saved." };
  } catch (err) {
    console.error("Admin team error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});


// TOKEN-PROTECTED ADMIN API (for scripted access)
//
// Disabled 2026-08-09: superseded by the session-based admin panel buttons above
// ("Refresh Cache Now" / "Re-sync PDFs"), which cover the same actions plus more and
// already have proper error handling. Also, GET /admin/refresh-cache only refreshes
// records — it never runs syncLocalPDFs — so calling it directly wiped every PDF
// download button on the site until the next full refresh (see lib/airtable.js's
// attachExistingLocalPaths for the actual fix to that). Left here, commented out
// rather than deleted, in case scripted/external access via ADMIN_TOKEN is wanted again
// later — if revived, give it the same try/catch treatment as the panel buttons above.
//
// router.get("/admin/sync-pdfs", async (req, res) => {
//   if (!safeTokenEqual(req.query.token, process.env.ADMIN_TOKEN)) {
//     return res.status(401).send("Unauthorized");
//   }
//   await syncTenantPDFs(req.tenant.slug);
//   res.send("PDF sync completed");
// });
//
// router.get("/admin/refresh-cache", async (req, res) => {
//   if (!safeTokenEqual(req.query.token, process.env.ADMIN_TOKEN)) {
//     return res.status(401).send("Unauthorized");
//   }
//   await refreshTenantCacheOnly(req.tenant.slug);
//   res.send(`Cache refreshed. ${(tenantCaches.get(req.tenant.slug) || []).length} records loaded.`);
// });


export default router;
