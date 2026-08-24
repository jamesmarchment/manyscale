import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { MULTI_TENANT, TRUST_PROXY } from "../config.js";
import { sessionMiddleware, tenantLocalsMiddleware, resolveTenant } from "../middleware.js";
import { csrfProtection, csrfErrorHandler } from "./csrf.js";
import { tenantLogPrefix } from "./log.js";
import apiRouter from "../routes/api.js";
import formsRouter from "../routes/forms.js";
import publicRouter from "../routes/public.js";
import adminRouter from "../routes/admin.js";
import landingRouter from "../routes/landing.js";
import architectRouter from "../routes/architect.js";
import analyticsProxyRouter from "./analyticsProxy.js";
import { assertReservedSlugsCover } from "./reservedSlugs.js";

const app = express();

app.set("view engine", "ejs");

// Closed by default — a self-hoster running behind a TLS-terminating reverse proxy
// (nginx, Caddy, Cloudflare, etc) opts in explicitly. With this left false, req.ip and
// req.secure ignore X-Forwarded-* headers entirely, so a client can't spoof its way
// around IP-based rate limiting by setting its own X-Forwarded-For.
app.set("trust proxy", TRUST_PROXY ? 1 : false);

// CSP kept pragmatic rather than maximally strict: script-src/style-src allow
// 'unsafe-inline' because inline <script> blocks and style="" attributes are used
// throughout views/ — removing that would need a nonce threaded through every one of
// them, a larger follow-up (see TODO.md). What this still locks down: frame-ancestors
// 'none' is the actual fix for the clickjacking scenario (an /architect session framed
// by an attacker page into a CSRF-tokened delete-tenant click), plus object-src,
// base-uri, and form-action, which cost nothing to restrict and have no legitimate use
// in this app. fonts.googleapis.com/fonts.gstatic.com are allowlisted because
// views/partials/header.ejs loads Google Fonts from there.
//
// useDefaults: false — deliberately NOT relying on helmet's implicit default-directive
// merge. Every directive below is explicit on purpose: this already burned us twice
// (helmet defaults 'script-src-attr' to 'none', silently breaking the onsubmit="…"
// confirm() dialogs in architect/index.ejs; and defaults 'upgrade-insecure-requests' to
// on, which forces every same-origin http:// subresource request to https:// — fatal for
// anyone self-hosting over plain HTTP with no TLS at all, since there's nothing on the
// other end of that upgraded request). Full explicit control avoids a third surprise
// from a future helmet version changing its defaults again.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // CSP3 treats inline event-handler attributes (onsubmit="…", used for the
      // delete-tenant/reset-password confirm() dialogs in architect/index.ejs) as a
      // separate directive from scriptSrc — must be set explicitly (see note above).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // data: is for public/assets/vendor/swiper/swiper-bundle.min.css, which embeds its
      // icon font (slider arrows) as a base64 data: URI rather than a separate file —
      // self-hosted, no external request involved. Safe to allow broadly: unlike
      // script-src, a data: font can't execute code.
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      // Only meaningful (and only included) when actually behind a TLS-terminating
      // proxy — on a plain-HTTP self-hosted deployment (TRUST_PROXY=false) there is no
      // https:// endpoint for an upgraded request to land on, so forcing this would
      // break every self-hosted CSS/JS asset. See the matching TRUST_PROXY-gated hsts
      // option below.
      ...(TRUST_PROXY ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // Nothing in this app legitimately iframes itself — DENY over helmet's default
  // SAMEORIGIN, as the same-browser-only fallback for clients that don't honor the CSP
  // frame-ancestors directive above.
  frameguard: { action: "deny" },
  // Only meaningful (and only sent) when the operator has confirmed they're behind a
  // TLS-terminating proxy — forcing this unconditionally would be wrong for the
  // plain-HTTP self-hosting this app explicitly supports (see TRUST_PROXY above).
  hsts: TRUST_PROXY ? { maxAge: 15552000, includeSubDomains: true } : false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
// cookie-parser must be registered after express-session (see csrf-csrf's docs) so it
// doesn't conflict with express-session's own cookie parsing.
app.use(cookieParser());
app.use(csrfProtection);
// X-Content-Type-Options: nosniff is now set globally by helmet above (noSniff, on by
// default) — no need for the static-only setHeaders version this used to carry.
app.use(express.static("public"));

// architectRouter and (in multi-tenant mode) landingRouter are mounted at the root, ahead
// of the /:slug catch-all below — this asserts every top-level path they define is listed
// in lib/reservedSlugs.js, so a new route added to either without updating that list fails
// loudly at startup instead of silently shadowing a future tenant with the same slug.
assertReservedSlugsCover(architectRouter, "architectRouter");
app.use(architectRouter);
assertReservedSlugsCover(analyticsProxyRouter, "analyticsProxyRouter");
app.use(analyticsProxyRouter);

if (MULTI_TENANT) {
  assertReservedSlugsCover(landingRouter, "landingRouter");
  // landingRouter only defines specific paths (/, /search, /search/suggestions,
  // POST /request-repo) — it must be tried before the /:slug catch-all, otherwise
  // resolveTenant treats e.g. "search" as a candidate slug and 404s "Unknown tenant"
  // before landingRouter ever sees the request. Anything not matching those exact
  // paths falls through via next() to the /:slug chain below, unchanged.
  app.use("/", landingRouter);
  app.use("/:slug", resolveTenant, tenantLocalsMiddleware, apiRouter, formsRouter, publicRouter, adminRouter);
} else {
  app.use(resolveTenant);
  app.use(tenantLocalsMiddleware);
  app.use(apiRouter);
  app.use(formsRouter);
  app.use(publicRouter);
  app.use(adminRouter);
}

// Error-handling middleware (4 args) — must be registered after every router above so
// it catches CSRF rejections raised by any of them.
app.use(csrfErrorHandler);

// Generic catch-all, registered last so it only sees errors csrfErrorHandler passed
// through (i.e. anything that isn't a CSRF failure). Never sends err.stack/err.message to
// the client — this is what actually stops stack-trace leakage, independent of whether
// NODE_ENV is set correctly, since Express's own default handler (which this replaces)
// only hides stack traces when NODE_ENV=production.
app.use((err, req, res, next) => {
  const prefix = req.tenant ? tenantLogPrefix(req.tenant.slug) : tenantLogPrefix("unknown-tenant");
  console.error(`${prefix} Unhandled error:`, err);
  res.status(err.status || err.statusCode || 500).send("Something went wrong. Please try again.");
});

export default app;
