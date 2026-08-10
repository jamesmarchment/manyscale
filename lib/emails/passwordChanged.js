import { renderEmailShell, escapeHtml } from "./shell.js";

// Sent from all three password-change paths: Architect Admin's "Reset PW", a tenant's
// self-service password change, and the self-service reset-link flow — `reason` is the
// only thing that differs between call sites.
export function passwordChangedEmail({ siteOrigin, tenant, reason }) {
  const subject = "Your ManyScale password was changed";

  const text = [
    `Hi,`,
    ``,
    `The admin password for your ManyScale tenant "${tenant.name}" was just changed ${reason}.`,
    ``,
    `If this wasn't you, contact your architect administrator right away.`,
  ].join("\n");

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:0.95rem;color:#3f3f46;">The admin password for your tenant <strong>${escapeHtml(tenant.name)}</strong> was just changed ${escapeHtml(reason)}.</p>
    <p style="margin:0;font-size:0.9rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;">If this wasn't you, contact your architect administrator right away.</p>
  `;

  return { subject, text, html: renderEmailShell({ siteOrigin, heading: "Password changed", bodyHtml }) };
}
