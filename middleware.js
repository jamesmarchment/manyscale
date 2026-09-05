import fs from "fs";
import path from "path";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { primaryTenant, SESSION_SECRET, MULTI_TENANT, TRUST_PROXY, PROJECT_ROOT, _tenantsList } from "./config.js";
import { COLOR_PRESETS, DEFAULT_RECIPE_FOR_PRESET } from "./lib/colorPresets.js";
import { getTenantContent } from "./lib/jsonStore.js";
import { createNotification } from "./lib/notifications.js";

const FileStore = FileStoreFactory(session);
const SESSIONS_DIR = path.join(PROJECT_ROOT, "sessions");

// One JSON file per session under sessions/, instead of express-session's default
// in-memory MemoryStore — sessions now survive a restart/crash, and MemoryStore is
// explicitly documented as unfit for production (unbounded memory growth, no
// persistence). The store reaps its own expired files on an interval (default hourly) —
// no separate cleanup job needed for that. logFn's routine "starting/deleting expired
// sessions" lines are dropped (they'd otherwise flood server.log every reap cycle,
// reapAsync defaults to false so this callback runs in-process and actually sees them);
// anything else logFn reports — which in practice is only the package's own "will retry,
// error on last attempt" reap-failure line — is a genuine problem worth surfacing.
//
// retries/minTimeout/maxTimeout are raised well above the package's defaults (5 tries,
// 50-100ms) because reads race against the reap worker's deletes and other requests'
// writes on the NAS this runs on — that filesystem is slower and less consistent than
// local disk, so the default ~0.5s retry budget isn't always enough for a raced file to
// reappear, producing spurious ENOENT here even though the session is fine a moment
// later. fallbackSessionFn covers the case where retries are still exhausted: without it,
// any error other than ENOENT (e.g. an EPERM mid-rename) is passed to express-session's
// callback and turns into a 500 for that one request; express-session already treats a
// bare ENOENT as "no session, start fresh" (see its store.get callback), so returning a
// fresh session here for every exhausted-retry case just extends that same graceful
// fallback to the other transient filesystem errors too — worst case is an unwanted
// logout, never a 500.
const sessionStore = new FileStore({
  path: SESSIONS_DIR,
  retries: 10,
  minTimeout: 100,
  maxTimeout: 1000,
  factor: 2,
  fallbackSessionFn: () => ({}),
  logFn: (message) => {
    if (/deleting expired sessions|starting reap worker/i.test(message)) return;
    createNotification({
      scope: "architect", type: "session_store_error", severity: "warn",
      message: `Session store: ${message}`,
      dedupeKey: "session_store_error",
    });
  },
});

// Best-effort growth check, piggybacked on the same reap interval (default hourly) —
// under normal load (8h cookie maxAge, hourly reap) the sessions/ dir should never hold
// more than a few hundred files; a much larger count suggests reap isn't keeping up or
// something is generating sessions abnormally fast. readdir (not statfs) because this
// project runs from a UNC/NAS path where filesystem-level stats are unreliable (see
// HANDOFF.md) — a plain directory listing is not.
const SESSION_COUNT_WARNING_THRESHOLD = 2000;
setInterval(() => {
  fs.readdir(SESSIONS_DIR, (err, files) => {
    if (err) return; // sessions/ not created yet, or a transient NAS hiccup — not worth flagging
    if (files.length >= SESSION_COUNT_WARNING_THRESHOLD) {
      createNotification({
        scope: "architect", type: "session_store_growth", severity: "warn",
        message: `sessions/ contains ${files.length} files — growing much larger than expected under normal load. Reap may not be keeping up.`,
        dedupeKey: "session_store_growth",
      });
    }
  });
}, 60 * 60 * 1000).unref();

export const sessionMiddleware = session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // secure tied to TRUST_PROXY (same signal lib/csrf.js's CSRF cookie already uses) —
  // previously unset here, meaning the session cookie defaulted to being sent over plain
  // HTTP even in deployments that are actually behind TLS.
  cookie: { httpOnly: true, sameSite: "lax", secure: TRUST_PROXY, maxAge: 8 * 60 * 60 * 1000 }
});

// Expose tenant-level locals to all templates. Must run after resolveTenant so
// req.tenant reflects the tenant actually being requested, not always the primary one.
export function tenantLocalsMiddleware(req, res, next) {
  const tenant = req.tenant || primaryTenant;
  res.locals.siteName = tenant.name;
  res.locals.siteOrigin = `${req.protocol}://${req.get("host")}`;
  res.locals.canonicalUrl = `${res.locals.siteOrigin}${req.originalUrl}`;
  try {
    const content = getTenantContent(tenant.slug);
    const meta = content.meta || {};
    res.locals.siteTagline     = meta.tagline     || "";
    res.locals.siteDescription = meta.description || "";
    res.locals.landingTagline  = content.landingTagline || "";
    res.locals.logoColor       = content.logoColor || "";
    res.locals.logoUrl         = content.logoUrl || "";
    res.locals.landingHeaderColor = content.landingHeaderColor || "";
    res.locals.landingAccentColor = content.landingAccentColor || "";
    res.locals.metaImagePath   = content.metaImageUrl || "/assets/img/manyscale_meta.jpg";
    res.locals.bubbleChartColors = content.bubbleChartColors || COLOR_PRESETS.bubbleChart.default;
    res.locals.cardGradients     = content.cardGradients     || COLOR_PRESETS.cardGradients.default;
    const tagColorsPreset = content.tagColorsPreset || "default";
    // A tenant saved before palettes shrank to 16 accents may still hold a 24-entry
    // snapshot — self-heal by re-pulling the current preset's array instead of trusting
    // a stale one (no tenant has ever hand-edited individual tagColors, only picked a
    // named preset, so nothing is lost by re-deriving from the preset name).
    res.locals.tagColors = (Array.isArray(content.tagColors) && content.tagColors.length === 16)
      ? content.tagColors
      : (COLOR_PRESETS.tagColors[tagColorsPreset] || COLOR_PRESETS.tagColors.default);
    res.locals.tagColorsPreset = tagColorsPreset;
    res.locals.tagRecipe = content.tagRecipe || DEFAULT_RECIPE_FOR_PRESET[tagColorsPreset] || "pastel";
    res.locals.whyMarkdown = content.whyMarkdown || "";
    res.locals.whyHtml = content.whyMarkdown
      ? sanitizeHtml(marked.parse(content.whyMarkdown))
      : "";
  } catch {
    res.locals.metaImagePath = "/assets/img/manyscale_meta.jpg";
    res.locals.bubbleChartColors = COLOR_PRESETS.bubbleChart.default;
    res.locals.cardGradients     = COLOR_PRESETS.cardGradients.default;
    res.locals.tagColors         = COLOR_PRESETS.tagColors.default;
    res.locals.tagColorsPreset   = "default";
    res.locals.tagRecipe         = "pastel";
    res.locals.whyMarkdown       = "";
    res.locals.whyHtml           = "";
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

// New tenant admins must accept the ToS (and, right after, set their own password — see
// /admin/set-password) before reaching the rest of /admin. architectLoggedIn bypasses this:
// an architect impersonating a tenant's admin panel isn't the new admin being onboarded.
export function requireTosAccepted(req, res, next) {
  if (req.session?.architectLoggedIn) return next();
  if (req.tenant.tosAcceptedAt) return next();
  res.redirect(res.locals.basePath + "/admin/accept-terms");
}

export function requireArchitectAdmin(req, res, next) {
  if (req.session?.architectLoggedIn) return next();
  res.redirect("/architect/login");
}

// In-memory fixed-window rate limiter factory, keyed by an arbitrary string (IP,
// IP+tenant, etc). Each call site gets its own independent Map/window/max.
export function createRateLimiter(max, windowMs) {
  const map = new Map();
  return function rateLimitOk(key) {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      map.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}

// Max 5 submissions per key per hour — same values as before this was factored out.
export const contactRateLimitOk = createRateLimiter(5, 60 * 60 * 1000);
// Max 3 password-reset requests per key per hour — keeps a tenant's inbox from being spammed.
export const forgotPasswordRateLimitOk = createRateLimiter(3, 60 * 60 * 1000);
// Max 8 login attempts per key per 15 minutes.
export const loginRateLimitOk = createRateLimiter(8, 15 * 60 * 1000);
// Layered on top of loginRateLimitOk above (checked in addition to it, not instead of):
// that one is keyed by IP (+tenant), so a distributed attacker spreading login attempts
// across many source IPs against one account never trips it — no single IP's budget
// gets exhausted. This one is keyed by account only (tenant slug, or "architect" for the
// single global architect account), so it catches that case regardless of source IP.
// Deliberately more generous than the IP-keyed limit (20 vs 8) since legitimate
// shared-IP traffic (office/NAT) already hits the tighter one first.
export const accountLoginRateLimitOk = createRateLimiter(20, 15 * 60 * 1000);
// Guards GET/POST /admin/reset-password (token-validity check and token redemption).
// Kept separate from forgotPasswordRateLimitOk on purpose — "request a new reset email"
// and "redeem a reset token" are different actions, and sharing one budget would mean a
// legitimate user's retry-typos on the reset form could exhaust the counter that gates
// new reset emails. Not meaningfully brute-forceable at the reset token's current
// entropy (see lib/auth.js's HMAC-SHA256 signing) — this exists for defense-in-depth
// consistency with every other auth-adjacent route, not because it's closing an
// exploitable gap today.
export const resetPasswordRateLimitOk = createRateLimiter(10, 15 * 60 * 1000);

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
