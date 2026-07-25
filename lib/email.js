import nodemailer from "nodemailer";

// Host/port/secure are configurable from the Architect Admin panel (see
// routes/architect.js POST /architect/settings/email), which writes SMTP_HOST /
// SMTP_PORT / SMTP_SECURE into .env. The transporter is built once at startup, so
// changes take effect on the next server restart.
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.manyscale.org",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});
