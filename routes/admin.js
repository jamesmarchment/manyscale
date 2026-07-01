import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { requireAdmin } from "../middleware.js";
import { tenantCaches, lastRefreshTimes, runFullRefresh, syncLocalPDFs, refreshCache } from "../lib/airtable.js";
import { TENANTS_FILE, updateEnvVar, primaryTenant } from "../config.js";

const router = Router();

// Photo upload — saves to public/{slug}/team/
const TEAM_PHOTO_SLUG = "relationships";
const TEAM_PHOTO_DIR  = path.join(process.cwd(), "public", TEAM_PHOTO_SLUG, "team");
if (!fs.existsSync(TEAM_PHOTO_DIR)) fs.mkdirSync(TEAM_PHOTO_DIR, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEAM_PHOTO_DIR),
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
  if (req.session?.adminLoggedIn) return res.redirect("/admin");
  res.render("admin/login", { error: null });
});

router.post("/admin/login", (req, res) => {
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) return res.render("admin/login", { error: "ADMIN_PASSWORD is not configured on the server." });
  if (req.body.password === adminPwd) {
    req.session.adminLoggedIn = true;
    return res.redirect("/admin");
  }
  res.render("admin/login", { error: "Incorrect password." });
});

router.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

router.get("/admin", requireAdmin, (req, res) => {
  let tenants = [];
  try { tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8")); } catch {}
  const tenant = tenants.find(t => t.slug === "relationships") || tenants[0] || {};
  let hero = {}, submitFormUrl = "", team = [];
  try {
    const content = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", `${tenant.slug}.json`), "utf8"));
    hero = content.hero || {};
    submitFormUrl = content.submitFormUrl || "";
    team = content.team || [];
  } catch {}
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render("admin/index", {
    tenant,
    hero,
    submitFormUrl,
    team,
    recordCount: (tenantCaches.get("relationships") || []).length,
    lastRefresh: lastRefreshTimes.get("relationships") || null,
    flash,
  });
});

router.post("/admin/config", requireAdmin, (req, res) => {
  const { name, baseId, pat, contact_recipient } = req.body;
  try {
    let tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8"));
    const idx = tenants.findIndex(t => t.slug === "relationships");
    if (idx !== -1) {
      if (name?.trim())               tenants[idx].name               = name.trim();
      if (baseId?.trim())             tenants[idx].baseId             = baseId.trim();
      if (contact_recipient !== undefined) tenants[idx].contact_recipient = contact_recipient.trim();
      fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2), "utf8");
    }
    if (pat?.trim()) {
      const patVar = tenants[idx]?.patEnvVar || "AIRTABLE_PAT";
      updateEnvVar(patVar, pat.trim());
    }
    req.session.flash = { type: "ok", msg: "Configuration saved. Restart the server to apply PAT or Base ID changes." };
  } catch (err) {
    console.error("Admin config error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/admin");
});

router.post("/admin/content", requireAdmin, (req, res) => {
  const { hero_heading, hero_subheading, meta_tagline, meta_description, submit_form_url, logo_color } = req.body;
  const contentFile = path.join(process.cwd(), "data", `${primaryTenant.slug}.json`);
  try {
    let content = {};
    try { content = JSON.parse(fs.readFileSync(contentFile, "utf8")); } catch {}
    if (!content.hero) content.hero = {};
    if (!content.meta) content.meta = {};
    if (hero_heading      !== undefined) content.hero.heading     = hero_heading;
    if (hero_subheading   !== undefined) content.hero.subheading  = hero_subheading;
    if (meta_tagline      !== undefined) content.meta.tagline     = meta_tagline;
    if (meta_description  !== undefined) content.meta.description = meta_description;
    if (submit_form_url   !== undefined) content.submitFormUrl    = submit_form_url;
    if (logo_color        !== undefined && /^#[0-9a-f]{6}$/i.test(logo_color)) content.logoColor = logo_color;
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2), "utf8");
    req.session.flash = { type: "ok", msg: "Site content saved." };
  } catch (err) {
    console.error("Admin content error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/admin");
});

router.post("/admin/cache", requireAdmin, async (req, res) => {
  try {
    await runFullRefresh("relationships");
    const count = (tenantCaches.get("relationships") || []).length;
    req.session.flash = { type: "ok", msg: `Cache refreshed — ${count} records loaded.` };
  } catch (err) {
    console.error("Admin cache refresh error:", err);
    req.session.flash = { type: "err", msg: "Refresh failed: " + err.message };
  }
  res.redirect("/admin");
});

router.post("/admin/team/upload-photo", requireAdmin, (req, res) => {
  photoUpload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type." });
    res.json({ path: `/${TEAM_PHOTO_SLUG}/team/${req.file.filename}` });
  });
});

router.post("/admin/team", requireAdmin, (req, res) => {
  const contentFile = path.join(process.cwd(), "data", `${primaryTenant.slug}.json`);
  try {
    let content = {};
    try { content = JSON.parse(fs.readFileSync(contentFile, "utf8")); } catch {}
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
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2), "utf8");
    req.session.flash = { type: "ok", msg: "Team saved." };
  } catch (err) {
    console.error("Admin team error:", err);
    req.session.flash = { type: "err", msg: "Save failed: " + err.message };
  }
  res.redirect("/admin");
});


// TOKEN-PROTECTED ADMIN API (for scripted access)

router.get("/admin/sync-pdfs", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await syncLocalPDFs("relationships");
  res.send("PDF sync completed");
});

router.get("/admin/refresh-cache", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await refreshCache("relationships");
  res.send(`Cache refreshed. ${(tenantCaches.get("relationships") || []).length} records loaded.`);
});


export default router;
