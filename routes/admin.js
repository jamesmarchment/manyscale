import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { requireAdmin, loginRateLimitOk } from "../middleware.js";
import { tenantCaches, lastRefreshTimes, runFullRefresh, syncLocalPDFs, refreshCache } from "../lib/airtable.js";
import { TENANTS_FILE, PROJECT_ROOT, _tenantsList, updateEnvVar } from "../config.js";
import { verifyPassword, hashPassword, safeTokenEqual } from "../lib/auth.js";
import { COLOR_PRESETS, TAG_COLOR_RECIPES, DEFAULT_RECIPE_FOR_PRESET } from "../lib/colorPresets.js";
import { writeJsonAtomic, getTenantContent, updateTenantContent } from "../lib/jsonStore.js";
import { generateCsrfToken } from "../lib/csrf.js";

// Normalizes a bracket-indexed form field (parsed by express.urlencoded as either an
// array or, if indices have gaps, a plain object keyed by index) into an ordered array.
function toOrderedArray(raw) {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  const indices = Object.keys(raw).map(Number).sort((a, b) => a - b);
  return indices.map(i => raw[i]);
}

const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

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
  res.render("admin/login", { error: null, csrfToken: generateCsrfToken(req, res) });
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

router.post("/admin/password", requireAdmin, (req, res) => {
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
  } catch (err) {
    console.error("Admin password change error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/content", requireAdmin, (req, res) => {
  const { hero_heading, hero_subheading, meta_tagline, meta_description, landing_tagline, submit_form_url, logo_color, why_markdown } = req.body;
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
      if (logo_color        !== undefined && /^#[0-9a-f]{6}$/i.test(logo_color)) content.logoColor = logo_color;
    });
    req.session.flash = { type: "ok", msg: "Site content saved." };
  } catch (err) {
    console.error("Admin content error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect(res.locals.basePath + "/admin");
});

router.post("/admin/colors", requireAdmin, (req, res) => {
  const { bubbleChartPreset, bubbleColors, cardGradientsPreset, cardGradients, tagColorsPreset, tagColors, tagRecipe } = req.body;
  try {
    updateTenantContent(req.tenant.slug, (content) => {
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
    await runFullRefresh(req.tenant.slug);
    const count = (tenantCaches.get(req.tenant.slug) || []).length;
    req.session.flash = { type: "ok", msg: `Cache refreshed — ${count} records loaded.` };
  } catch (err) {
    console.error("Admin cache refresh error:", err);
    req.session.flash = { type: "err", msg: "Refresh failed: " + err.message };
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

router.get("/admin/sync-pdfs", async (req, res) => {
  if (!safeTokenEqual(req.query.token, process.env.ADMIN_TOKEN)) {
    return res.status(401).send("Unauthorized");
  }
  await syncLocalPDFs(req.tenant.slug);
  res.send("PDF sync completed");
});

router.get("/admin/refresh-cache", async (req, res) => {
  if (!safeTokenEqual(req.query.token, process.env.ADMIN_TOKEN)) {
    return res.status(401).send("Unauthorized");
  }
  await refreshCache(req.tenant.slug);
  res.send(`Cache refreshed. ${(tenantCaches.get(req.tenant.slug) || []).length} records loaded.`);
});


export default router;
