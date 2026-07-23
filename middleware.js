import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import { primaryTenant, SESSION_SECRET, MULTI_TENANT, _tenantsList } from "./config.js";

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
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "data", `${tenant.slug}.json`), "utf8"));
    const meta = content.meta || {};
    res.locals.siteTagline     = meta.tagline     || "";
    res.locals.siteDescription = meta.description || "";
    res.locals.logoColor       = content.logoColor || "";
  } catch {}
  next();
}

export function requireAdmin(req, res, next) {
  if (req.session?.architectLoggedIn) return next();
  if (req.session?.adminLoggedIn && req.session?.adminTenantSlug === req.tenant.slug) return next();
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
