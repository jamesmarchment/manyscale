import { renderEmailShell, escapeHtml } from "./shell.js";

// Sent from routes/admin.js's POST /admin/forgot-password when a tenant requests a
// self-service password reset link.
export function passwordResetRequestEmail({ siteOrigin, tenant, resetUrl, expiresInMinutes }) {
  const subject = "Reset your ManyScale admin password";

  const text = [
    `Hi,`,
    ``,
    `Someone requested a password reset for your ManyScale tenant "${tenant.name}".`,
    ``,
    `Reset your password: ${resetUrl}`,
    ``,
    `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    ``,
    `If you didn't request this, you can safely ignore this email — your password won't change.`,
  ].join("\n");

  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:0.95rem;color:#3f3f46;">Someone requested a password reset for your tenant <strong>${escapeHtml(tenant.name)}</strong>.</p>
    <p style="margin:0 0 20px;">
      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 20px;background:#18181b;color:#ffffff;border-radius:5px;text-decoration:none;font-size:0.9rem;">Reset your password</a>
    </p>
    <p style="margin:0 0 16px;font-size:0.85rem;color:#71717a;">This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
    <p style="margin:0;font-size:0.85rem;color:#71717a;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `;

  return { subject, text, html: renderEmailShell({ siteOrigin, heading: "Reset your password", bodyHtml }) };
}
