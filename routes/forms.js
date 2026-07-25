import { Router } from "express";
import { transporter } from "../lib/email.js";
import { antiSpamGuard } from "../lib/antispam.js";

const router = Router();

router.post("/contact", antiSpamGuard, async (req, res) => {
  const { name, email, subject, message } = req.body;

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


router.post("/suggest", antiSpamGuard, async (req, res) => {
  const { name, email, measure_name, citation, comments } = req.body;

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
