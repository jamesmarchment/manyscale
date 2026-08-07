import { doubleCsrf } from "csrf-csrf";
import { SESSION_SECRET } from "../config.js";

// __Host- prefixed cookies (csrf-csrf's default cookieName) require `secure: true` and
// an HTTPS connection, which breaks local/plain-HTTP self-hosting — use a plain name
// instead and tie `secure` to the same TRUST_PROXY signal used for the session cookie
// (a self-hoster behind a TLS-terminating reverse proxy sets TRUST_PROXY=true).
const secureCookie = process.env.TRUST_PROXY === "true";

export const { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => SESSION_SECRET,
  // Bound to the session id so a token only validates for the session that requested
  // it. Note: express-session with saveUninitialized:false won't persist a session (or
  // keep a stable id) until something is written to it — every GET route that calls
  // generateCsrfToken() before the user is logged in (i.e. the login pages) must touch
  // req.session first so the id is stable by the time the form is submitted.
  getSessionIdentifier: (req) => req.session.id,
  cookieName: "__csrf",
  cookieOptions: { sameSite: "lax", secure: secureCookie, httpOnly: true },
  // Default only reads the x-csrf-token header. Every admin/architect form in this app
  // submits the token as a hidden field in a normal urlencoded POST body, so the body
  // must be checked too — the two fetch()-based multipart uploads send it via the
  // header instead, since they can't add a form field to a FormData upload.
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"] || req.body?._csrf,
});

// Public, anonymous, no-session POST endpoints — each already has its own defense
// (antiSpamGuard's rate limit + honeypot timing for the three form submissions;
// analytics/event is fired by third-party JS, not a form, so it can't carry a token
// at all) and there's no privileged session for a forged cross-site POST to ride on.
// Matched by path suffix since routes/forms.js's routes are mounted under a variable
// /:slug prefix in multi-tenant mode.
const CSRF_EXEMPT_SUFFIXES = ["/contact", "/suggest", "/request-repo", "/analytics/event"];

export function csrfProtection(req, res, next) {
  if (CSRF_EXEMPT_SUFFIXES.some((suffix) => req.path.endsWith(suffix))) return next();
  return doubleCsrfProtection(req, res, next);
}

// Mirrors requireAdmin's JSON-vs-redirect branching (middleware.js) so the two
// fetch()-based upload endpoints get a JSON error instead of an HTML error page. This
// is a shared safety net for both the /admin and /architect surfaces, so it doesn't
// know which flash key to set — it just sends the browser back to referring page
// (Referer), which re-renders the form with a fresh token, rather than trying to guess
// the right admin-vs-architect redirect target.
export function csrfErrorHandler(err, req, res, next) {
  if (err !== invalidCsrfTokenError) return next(err);
  if (req.headers.accept?.includes("application/json")) {
    return res.status(403).json({ error: "Session expired or invalid — please reload the page and try again." });
  }
  res.redirect(req.get("Referer") || "/");
}
