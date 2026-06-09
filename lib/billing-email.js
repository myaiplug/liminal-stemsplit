const FROM_EMAIL =
  process.env.STEMSPLIT_ONBOARDING_FROM ||
  process.env.FROM_EMAIL ||
  'StemSplit <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'http://localhost:4001';

function buildActivationHtml(email, accessPassword) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(16,185,129,0.2);border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 36px 20px;text-align:center">
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#34d399;margin-bottom:12px">StemSplit Pro</div>
          <h1 style="margin:0;font-size:24px;color:#fff;font-weight:800">Your Pro access is ready</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 28px;line-height:1.7;font-size:15px;color:#94a3b8">
          <p style="margin:0 0 16px">Thanks for purchasing StemSplit Pro. Use the details below to activate inside the desktop app.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(16,185,129,0.08);border-radius:12px">
            <tr><td style="padding:18px 20px">
              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7">Purchase email</p>
              <p style="margin:0 0 16px;font-family:monospace;color:#ecfdf5">${email}</p>
              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7">Access password</p>
              <p style="margin:0;font-family:monospace;font-size:18px;color:#fff;letter-spacing:0.04em">${accessPassword}</p>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:14px">Open StemSplit → <strong style="color:#a7f3d0">Activate Pro</strong> → paste your email and access password.</p>
          <p style="margin:20px 0 0;text-align:center">
            <a href="${SITE_URL}/#pricing" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px">Open pricing page →</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendProActivationEmail(email, accessPassword) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };
  if (!email || !accessPassword) return { sent: false, reason: 'Missing email or access password' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Your StemSplit Pro access password',
      html: buildActivationHtml(email, accessPassword),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { sent: false, reason: data.message || response.statusText };
  return { sent: true, id: data.id };
}