// server.js
/*

ManyScale Server
v0.0.1
2026-06-14
James Marchment and Samantha Joel

*/

// imports
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
import multer from "multer";

import { PORT, TENANTS_FILE, updateEnvVar } from "./config.js";
import { tenantCaches, lastRefreshTimes, resolveTableIDs, refreshCache, runFullRefresh, syncLocalPDFs } from "./lib/airtable.js";
import { sessionMiddleware, tenantLocalsMiddleware, requireAdmin } from "./middleware.js";
import apiRouter from "./routes/api.js";
import formsRouter from "./routes/forms.js";
import publicRouter from "./routes/public.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();


// using EJS
app.set("view engine", "ejs");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(sessionMiddleware);

// static files
app.use(express.static("public"));



// Expose tenant-level locals to all templates
app.use(tenantLocalsMiddleware);
app.use(apiRouter);
app.use(formsRouter);
app.use(publicRouter);






// double-check that server started up, save to log
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});


// ADMIN UI **********************************************

// Photo upload — saves to public/{slug}/team/
const TEAM_PHOTO_SLUG = "relationships";
const TEAM_PHOTO_DIR  = path.join(__dirname, "public", TEAM_PHOTO_SLUG, "team");
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

app.post("/admin/team/upload-photo", requireAdmin, (req, res) => {
  photoUpload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded or unsupported type." });
    res.json({ path: `/${TEAM_PHOTO_SLUG}/team/${req.file.filename}` });
  });
});

app.post("/admin/team", requireAdmin, (req, res) => {
  const slug = "relationships";
  const contentFile = path.join(__dirname, "data", `${slug}.json`);
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

app.get("/admin/login", (req, res) => {
  if (req.session?.adminLoggedIn) return res.redirect("/admin");
  res.render("admin/login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) return res.render("admin/login", { error: "ADMIN_PASSWORD is not configured on the server." });
  if (req.body.password === adminPwd) {
    req.session.adminLoggedIn = true;
    return res.redirect("/admin");
  }
  res.render("admin/login", { error: "Incorrect password." });
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.get("/admin", requireAdmin, (req, res) => {
  let tenants = [];
  try { tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8")); } catch {}
  const tenant = tenants.find(t => t.slug === "relationships") || tenants[0] || {};
  let hero = {}, submitFormUrl = "", team = [];
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "data", `${tenant.slug}.json`), "utf8"));
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

app.post("/admin/config", requireAdmin, (req, res) => {
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

app.post("/admin/content", requireAdmin, (req, res) => {
  const { hero_heading, hero_subheading, meta_tagline, meta_description, submit_form_url, logo_color } = req.body;
  const slug = "relationships";
  const contentFile = path.join(__dirname, "data", `${slug}.json`);
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

app.post("/admin/cache", requireAdmin, async (req, res) => {
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


// TOKEN-PROTECTED ADMIN API (for scripted access) **********************************************

app.get("/admin/sync-pdfs", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await syncLocalPDFs("relationships");
  res.send("PDF sync completed");
});

app.get("/admin/refresh-cache", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await refreshCache("relationships");
  res.send(`Cache refreshed. ${(tenantCaches.get("relationships") || []).length} records loaded.`);
});



// Resolve table IDs once at startup, then kick off the data refresh cycle.
// If Airtable is unreachable the server still starts and serves from the local disk cache;
// the interval keeps retrying so it auto-recovers when connectivity is restored.
console.log("Starting ManyScale…");
resolveTableIDs().then(ok => {
  if (ok) {
    runFullRefresh("relationships").catch(err => console.error("[startup] Initial refresh failed:", err));
  } else {
    console.warn("[startup] Airtable unavailable — serving from local disk cache if available. Will retry in 6 hours.");
  }
  setInterval(async () => {
    const resolved = await resolveTableIDs();
    if (resolved) {
      await runFullRefresh("relationships").catch(err => console.error("[refresh] Scheduled refresh failed:", err));
    } else {
      console.warn("[refresh] Airtable still unavailable — will retry next cycle.");
    }
  }, 6 * 60 * 60 * 1000);
});
