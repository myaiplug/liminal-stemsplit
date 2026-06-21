const PRODUCTION_SITE = 'https://liminal-stemsplit.onrender.com';
const SITE_URL = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || PRODUCTION_SITE;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Liminal StemSplit <onboarding@resend.dev>';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';

function buildWelcomeHtml(verificationCode) {
  const codeDisplay = verificationCode ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.2);border-radius:12px;margin:0 0 24px">
            <tr><td style="padding:20px 24px;text-align:center">
              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#67e8f9">Verification Code</p>
              <p style="margin:0;font-family:monospace;font-size:28px;color:#fff;letter-spacing:0.2em;font-weight:700">${verificationCode}</p>
              <p style="margin:12px 0 0;font-size:13px;color:#64748b">Enter this code in the Liminal app to verify your email.</p>
            </td></tr>
          </table>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(6,182,212,0.15);border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 36px 24px;text-align:center;background:linear-gradient(135deg,rgba(6,182,212,0.08),transparent)">
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#06b6d4;margin-bottom:12px">Liminal StemSplit</div>
          <h1 style="margin:0;font-size:26px;color:#fff;font-weight:800">Welcome to StemSplit</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 32px;line-height:1.7;font-size:15px;color:#94a3b8">
          <p style="margin:0 0 20px">Your free account is ready. Separate vocals, drums, bass, and more from any track.</p>
          ${codeDisplay}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr><td>
              <strong style="color:#22d3ee;font-size:15px">Quick Start</strong>
            </td></tr>
            <tr><td height="8"></td></tr>
            <tr><td style="padding:12px 16px;background:rgba(6,182,212,0.05);border-radius:8px;font-size:14px">
              1. Drop any WAV/MP3/FLAC into the app<br>
              2. Pick "Quick Split" for 2-stem separation<br>
              3. Solo, mute, and compare each stem<br>
              4. Upgrade to Pro for 4-6 stems + FX rack
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:12px">
            <tr><td style="padding:20px 24px">
              <strong style="color:#c084fc;font-size:15px">Complete Your Studio</strong>
              <p style="margin:4px 0 12px;font-size:14px">Producer tools built for the workflow:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
                <tr><td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:#c084fc">◆</span> <strong>ScrewAI Pro</strong> <span style="color:#a78bfa">$29</span> — The Code'ine Processor: slow, chop, screw any audio</td></tr>
                <tr><td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:#c084fc">◆</span> <strong>EZ Drag & Drop</strong> <span style="color:#a78bfa">$19</span> — Instant audio processing without menus</td></tr>
                <tr><td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:#c084fc">◆</span> <strong>NoDAW Essentials</strong> <span style="color:#a78bfa">$39</span> — Trim, convert, test, one-click FX, 10-track workstation + guide</td></tr>
                <tr><td style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:#c084fc">◆</span> <strong>17 Strain Pack</strong> <span style="color:#a78bfa">$49</span> — Additional effect chains & processing styles</td></tr>
                <tr><td style="padding:12px 0 0"><span style="color:#fbbf24;font-size:14px">★</span> <strong style="color:#fbbf24">Complete Bundle</strong> <span style="color:#fbbf24;font-size:16px;font-weight:700">$99</span> <span style="color:#64748b;font-size:12px">(save $86)</span></td></tr>
              </table>
            </td></tr>
          </table>
          <p style="text-align:center">
            <a href="${SITE_URL}/#pricing" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px">View All Products →</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:12px;color:#475569">
          <a href="https://myaiplug.com" style="color:#06b6d4;text-decoration:none">MyAiPlug</a> — AI Audio Tools for Producers<br>
          You're receiving this because you signed up at liminalstemsplit.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNotifyHtml(lead) {
  return `<p>New lead captured on Liminal StemSplit:</p>
<ul>
  <li><strong>Email:</strong> ${lead.email}</li>
  <li><strong>Source:</strong> ${lead.source}</li>
  <li><strong>Time:</strong> ${new Date(lead.time).toISOString()}</li>
</ul>`;
}

async function resendSend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { sent: false, reason: data.message || res.statusText };
  return { sent: true, id: data.id };
}

export async function sendWelcomeEmail(email, verificationCode) {
  return resendSend({
    to: email,
    subject: 'Welcome to Liminal StemSplit — Verify your email',
    html: buildWelcomeHtml(verificationCode),
  });
}

export async function notifyOwner(lead) {
  if (!NOTIFY_EMAIL) return { sent: false, reason: 'NOTIFY_EMAIL not set' };
  return resendSend({
    to: NOTIFY_EMAIL,
    subject: `New lead: ${lead.email}`,
    html: buildNotifyHtml(lead),
  });
}

export function emailStatus() {
  return {
    configured: !!process.env.RESEND_API_KEY,
    from: FROM_EMAIL,
    notify: NOTIFY_EMAIL || null,
  };
}