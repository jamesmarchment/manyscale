import { renderEmailShell, escapeHtml } from "./shell.js";

// Sent once, from routes/architect.js's POST /architect/tenants, right after a new
// tenant is provisioned.
export function tenantOnboardingEmail({ siteOrigin, tenant, adminUrl, adminPassword, multiTenantNote }) {
  const subject = "Your ManyScale tenant is ready";

  const loginLine = adminUrl
    ? `Admin panel: ${adminUrl}\nPassword: ${adminPassword}`
    : multiTenantNote;

  const text = [
    `Hi,`,
    ``,
    `Your ManyScale tenant "${tenant.name}" (slug: ${tenant.slug}) has been created.`,
    ``,
    loginLine,
    ``,
    `Getting started:`,
    `- Log in and review Site Content (tagline, hero text, custom homepage section).`,
    `- Pick Colors for the bubble chart, construct tags, and your landing page card.`,
    `- Add Team members with photos and bios.`,
    `- Submit or import measures — Airtable syncs automatically once connected.`,
    ``,
    `Questions? Reply to this email or reach out at ${tenant.contact_recipient}.`,
  ].join("\n");

  const loginHtml = adminUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border:1px solid #e4e4e7;border-radius:6px;">
        <tr><td style="padding:10px 14px;font-size:0.85rem;color:#52525b;border-bottom:1px solid #f1f1f1;">Admin panel</td>
            <td style="padding:10px 14px;font-size:0.85rem;"><a href="${escapeHtml(adminUrl)}" style="color:#18181b;">${escapeHtml(adminUrl)}</a></td></tr>
        <tr><td style="padding:10px 14px;font-size:0.85rem;color:#52525b;">Password</td>
            <td style="padding:10px 14px;font-size:0.85rem;"><code style="background:#f4f4f5;padding:2px 6px;border-radius:3px;">${escapeHtml(adminPassword)}</code></td></tr>
      </table>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:10px 20px;background:#18181b;color:#ffffff;border-radius:5px;text-decoration:none;font-size:0.9rem;">Log in to your admin panel</a>
      </p>`
    : `<p style="margin:0 0 20px;font-size:0.9rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;">${escapeHtml(multiTenantNote)}</p>`;

  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:0.95rem;color:#3f3f46;">Your ManyScale tenant <strong>${escapeHtml(tenant.name)}</strong> (slug: <code style="background:#f4f4f5;padding:2px 6px;border-radius:3px;">${escapeHtml(tenant.slug)}</code>) has been created.</p>
    ${loginHtml}
    <h2 style="margin:0 0 10px;font-size:0.95rem;color:#18181b;">Getting started</h2>
    <ol style="margin:0 0 20px;padding-left:1.2rem;font-size:0.9rem;color:#3f3f46;line-height:1.6;">
      <li>Log in and review <strong>Site Content</strong> (tagline, hero text, custom homepage section).</li>
      <li>Pick <strong>Colors</strong> for the bubble chart, construct tags, and your landing page card.</li>
      <li>Add <strong>Team</strong> members with photos and bios.</li>
      <li>Submit or import measures — Airtable syncs automatically once connected.</li>
    </ol>
    <p style="margin:0;font-size:0.85rem;color:#71717a;">Questions? Reply to this email or reach out at ${escapeHtml(tenant.contact_recipient)}.</p>
  `;

  return { subject, text, html: renderEmailShell({ siteOrigin, heading: "Welcome to ManyScale", bodyHtml }) };
}
