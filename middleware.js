import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import { primaryTenant, SESSION_SECRET, MULTI_TENANT, _tenantsList } from "./config.js";
import { COLOR_PRESETS } from "./lib/colorPresets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.SESSION_SECRET) {
  console.warn("[session] SESSION_SECRET not set — using insecure default. Set it in .env.");
}

export const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
});

// Expose tenant-level locals to all templates. Must run after resolveTenant so
// req.tenant reflects the tenant actually being requested, not always the primary one.
export function tenantLocalsMiddleware(req, res, next) {
  const tenant = req.tenant || primaryTenant;
  res.locals.siteName = tenant.name;
  res.locals.siteOrigin = `${req.protocol}://${req.get("host")}`;
  res.locals.canonicalUrl = `${res.locals.siteOrigin}${req.originalUrl}`;
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "data", `${tenant.slug}.json`), "utf8"));
    const meta = content.meta || {};
    res.locals.siteTagline     = meta.tagline     || "";
    res.locals.siteDescription = meta.description || "";
    res.locals.logoColor       = content.logoColor || "";
    res.locals.logoUrl         = content.logoUrl || "";
    res.locals.metaImagePath   = content.metaImageUrl || "/assets/img/manyscale_meta.jpg";
    res.locals.bubbleChartColors = content.bubbleChartColors || COLOR_PRESETS.bubbleChart.default;
    res.locals.cardGradients     = content.cardGradients     || COLOR_PRESETS.cardGradients.default;
    res.locals.tagColors         = content.tagColors         || COLOR_PRESETS.tagColors.default;
    res.locals.tagColorsPreset   = content.tagColorsPreset   || "default";
  } catch {
    res.locals.metaImagePath = "/assets/img/manyscale_meta.jpg";
    res.locals.bubbleChartColors = COLOR_PRESETS.bubbleChart.default;
    res.locals.cardGradients     = COLOR_PRESETS.cardGradients.default;
    res.locals.tagColors         = COLOR_PRESETS.tagColors.default;
    res.locals.tagColorsPreset   = "default";
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.session?.architectLoggedIn) return next();
  if (req.session?.adminLoggedIn && req.session?.adminTenantSlug === req.tenant.slug) return next();
  // fetch-based admin calls (e.g. photo upload) ask for JSON explicitly — a redirect
  // to the login page's HTML would otherwise fail client-side JSON parsing with a
  // cryptic error instead of a clear "session expired" message.
  if (req.headers.accept?.includes("application/json")) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
  res.redirect(res.locals.basePath + "/admin/login");
}

export function requireArchitectAdmin(req, res, next) {
  if (req.session?.architectLoggedIn) return next();
  res.redirect("/architect/login");
}

// In-memory rate limiter: max 5 submissions per IP per hour
export const _contactRateMap = new Map();
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function contactRateLimitOk(ip) {
  const now = Date.now();
  const entry = _contactRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _contactRateMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export function resolveTenant(req, res, next) {
  if (!MULTI_TENANT) {
    req.tenant = primaryTenant;
    res.locals.basePath = "";
    return next();
  }
  const slug = req.params.slug;
  const tenant = _tenantsList.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).send("Unknown tenant");
  req.tenant = tenant;
  res.locals.basePath = "/" + slug;
  next();
}
