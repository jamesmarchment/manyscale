// Shared HTML wrapper for every outbound email — logo header + heading + body + footer.
// Inline style="" attributes throughout (not a <style> block): email clients strip or
// mangle <style> blocks unpredictably, especially Outlook desktop, so structural styling
// has to live directly on each element. Uses fixed ManyScale network branding rather than
// per-tenant colors — these are operational/security emails, where a consistent,
// recognizable sender identity matters more than tenant branding.

// Unlike EJS's `<%= %>`, plain template literals don't auto-escape — every dynamic value
// (tenant name/slug, passwords, URLs) interpolated into an email's HTML must be passed
// through this first. Without it, a value containing "&"/"<"/">"/quotes (a strong password
// is a very plausible way to hit this, no malice required) renders broken, or — for
// tenant.name/tenant.slug, only settable by an already-trusted Architect Admin — could
// inject markup into the recipient's inbox.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailShell({ siteOrigin, heading, bodyHtml }) {
  const logoUrl = `${siteOrigin}/assets/img/manyscale_logo_rev_sm.png`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#18181b;padding:20px 32px;">
              <img src="${logoUrl}" alt="ManyScale" height="28" style="display:block;height:28px;width:auto;">
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:1.25rem;color:#18181b;">${heading}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#fafafa;border-top:1px solid #f1f1f1;">
              <p style="margin:0;font-size:0.78rem;color:#71717a;">This is an automated message from ManyScale, a network of repositories for self-report measures.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
