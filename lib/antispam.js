import { contactRateLimitOk } from "../middleware.js";

// Shared honeypot + timing-token + IP rate-limit guard for public-facing forms
// (contact, suggest-a-measure, request-a-repo). Bots that fill the hidden
// "website" field get a fake success so they don't retry; humans can't submit
// faster than the `_t` timing token allows.
export function antiSpamGuard(req, res, next) {
  const { website, _t } = req.body;

  if (website && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  // Missing/non-numeric _t must fail closed (reject), not fall through as "plenty of
  // time elapsed" — parseInt(undefined) is NaN, and Date.now() - NaN is also NaN, which
  // is not < 3000, so omitting the field entirely used to bypass this check outright.
  const submittedAt = parseInt(_t, 10);
  if (!_t || Number.isNaN(submittedAt) || Date.now() - submittedAt < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  // req.ip resolves correctly based on Express's `trust proxy` setting (see
  // app.set("trust proxy", ...) in lib/app.js) — reading X-Forwarded-For directly here
  // let any client set their own rate-limit key by spoofing the header.
  const ip = req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  }

  next();
}
