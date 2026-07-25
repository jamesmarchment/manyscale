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

  const elapsed = Date.now() - parseInt(_t || 0, 10);
  if (elapsed < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  }

  next();
}
