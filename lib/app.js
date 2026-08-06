import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { MULTI_TENANT } from "../config.js";
import { sessionMiddleware, tenantLocalsMiddleware, resolveTenant } from "../middleware.js";
import { doubleCsrfProtection, csrfErrorHandler } from "./csrf.js";
import apiRouter from "../routes/api.js";
import formsRouter from "../routes/forms.js";
import publicRouter from "../routes/public.js";
import adminRouter from "../routes/admin.js";
import landingRouter from "../routes/landing.js";
import architectRouter from "../routes/architect.js";
import { assertReservedSlugsCover } from "./reservedSlugs.js";

const app = express();

app.set("view engine", "ejs");

// Closed by default — a self-hoster running behind a TLS-terminating reverse proxy
// (nginx, Caddy, Cloudflare, etc) opts in explicitly. With this left false, req.ip and
// req.secure ignore X-Forwarded-* headers entirely, so a client can't spoof its way
// around IP-based rate limiting by setting its own X-Forwarded-For.
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
// cookie-parser must be registered after express-session (see csrf-csrf's docs) so it
// doesn't conflict with express-session's own cookie parsing.
app.use(cookieParser());
app.use(doubleCsrfProtection);
app.use(express.static("public", {
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
}));

// architectRouter and (in multi-tenant mode) landingRouter are mounted at the root, ahead
// of the /:slug catch-all below — this asserts every top-level path they define is listed
// in lib/reservedSlugs.js, so a new route added to either without updating that list fails
// loudly at startup instead of silently shadowing a future tenant with the same slug.
assertReservedSlugsCover(architectRouter, "architectRouter");
app.use(architectRouter);

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

export default app;
