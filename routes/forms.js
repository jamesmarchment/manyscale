import { Router } from "express";
import { transporter } from "../lib/email.js";
import { contactRateLimitOk } from "../middleware.js";

const router = Router();

router.post("/contact", async (req, res) => {
  const { name, email, subject, message, website, _t } = req.body;

  // honeypot: real users leave this blank
  if (website && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  // timing: reject submissions that arrive under 3 seconds after page render
  const elapsed = Date.now() - parseInt(_t || 0, 10);
  if (elapsed < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  // rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many messages. Please try again later." });
  }

  try {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: req.tenant.contact_recipient || process.env.SMTP_USER,
      subject: `New Contact Form Message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nSubject: ${subject}\n\nMessage:\n${message}`
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Contact form error:", err);
    res.status(500).json({ error: "Email failed to send" });
  }
});


router.post("/suggest", async (req, res) => {
  const { name, email, measure_name, citation, comments, website, _t } = req.body;

  // honeypot
  if (website && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  // timing: reject submissions under 3 seconds after modal open
  const elapsed = Date.now() - parseInt(_t || 0, 10);
  if (elapsed < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  // rate limit: reuse the same IP map as the contact form
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  }

  try {
    const body = [
      `Name:    ${name}`,
      `Email:   ${email}`,
      ``,
      `Measure: ${measure_name}`,
      ``,
      `Citation:`,
      citation,
      ...(comments ? [``, `Comments:`, comments] : []),
    ].join("\n");

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: req.tenant.contact_recipient || process.env.SMTP_USER,
      subject: `Measure Suggestion: ${measure_name}`,
      text: body,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Suggest form error:", err);
    res.status(500).json({ error: "Email failed to send" });
  }
});


export default router;
