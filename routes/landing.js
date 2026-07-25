import express from "express";
import { transporter } from "../lib/email.js";
import { antiSpamGuard } from "../lib/antispam.js";
import { getTenantSummaries, getNetworkLanguages, searchNetwork, getNetworkSuggestions } from "../lib/network.js";

const router = express.Router();

// This router only ever mounts at root in multi-tenant mode (see server.js) — there's
// no req.tenant here, so the locals tenantLocalsMiddleware would normally set have to
// be filled in explicitly for partials/header, nav, and footer to render correctly.
router.use((req, res, next) => {
  res.locals.basePath = "";
  res.locals.siteName = "ManyScale";
  next();
});

router.get("/", (req, res) => {
  res.render("landing", {
    tenants: getTenantSummaries(),
    languages: getNetworkLanguages(),
  });
});

router.get("/search", (req, res) => {
  const rawQuery = (req.query.query || "").replace(/[\r\n]+/g, " ").trim();
  const lang = (req.query.lang || "").trim();
  const query = rawQuery.toLowerCase();

  const results = (query || lang) ? searchNetwork({ query, lang }) : [];

  res.render("network-search", { query: rawQuery, lang, results });
});

router.get("/search/suggestions", (req, res) => {
  const query = (req.query.query || "").trim();
  res.json({ suggestions: getNetworkSuggestions(query) });
});

router.post("/request-repo", antiSpamGuard, async (req, res) => {
  const { name, email, message } = req.body;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NETWORK_CONTACT_EMAIL || process.env.SMTP_USER,
      subject: `New Repo Request from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Request-repo form error:", err);
    res.status(500).json({ error: "Email failed to send" });
  }
});

export default router;
