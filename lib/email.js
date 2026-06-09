const SITE_URL = process.env.SITE_URL || 'http://localhost:4001';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Liminal StemSplit <onboarding@resend.dev>';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';

function buildWelcomeHtml() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(6,182,212,0.15);border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 36px 24px;text-align:center;background:linear-gradient(135deg,rgba(6,182,212,0.08),transparent)">
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#06b6d4;margin-bottom:12px">Liminal StemSplit</div>
          <h1 style="margin:0;font-size:26px;color:#fff;font-weight:800">Your Free Stem Separation Guide</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 32px;line-height:1.7;font-size:15px;color:#94a3b8">
          <p style="margin:0 0 20px">Thanks for signing up. Here's a quick producer's guide to getting the most out of stem separation:</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:14px 16px;background:rgba(6,182,212,0.06);border-radius:10px;margin-bottom:10px">
              <strong style="color:#22d3ee">1. Start with a clean mix</strong><br>
              <span style="font-size:14px">WAV or FLAC at 44.1kHz+ gives the best results. Avoid heavily compressed MP3s when possible.</span>
            </td></tr>
            <tr><td height="10"></td></tr>
            <tr><td style="padding:14px 16px;background:rgba(6,182,212,0.06);border-radius:10px">
              <strong style="color:#22d3ee">2. Isolate what you need</strong><br>
              <span style="font-size:14px">Solo vocals for remixes, pull drums for sampling, or mute the vocal stem to create an instant instrumental.</span>
            </td></tr>
            <tr><td height="10"></td></tr>
            <tr><td style="padding:14px 16px;background:rgba(6,182,212,0.06);border-radius:10px">
              <strong style="color:#22d3ee">3. Try the live demo</strong><br>
              <span style="font-size:14px">Hear real AI-separated stems on our interactive player — solo, mute, and compare each part.</span>
            </td></tr>
          </table>
          <p style="margin:28px 0 24px;text-align:center">
            <a href="${SITE_URL}/#demo" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px">Try the Live Demo →</a>
          </p>
          <p style="margin:0;font-size:13px;color:#64748b;text-align:center">
            Want unlimited tracks, batch processing, and 6-stem export?<br>
            <a href="${SITE_URL}/#pricing" style="color:#06b6d4">Liminal Pro — $49 one-time →</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:12px;color:#475569">
          Liminal StemSplit by <a href="https://myaiplug.com" style="color:#06b6d4;text-decoration:none">MyAiPlug</a><br>
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

export async function sendWelcomeEmail(email) {
  return resendSend({
    to: email,
    subject: 'Your free stem separation guide — Liminal StemSplit',
    html: buildWelcomeHtml(),
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