const PRODUCTION_SITE = 'https://liminal-stemsplit.onrender.com';
const SITE_URL = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || PRODUCTION_SITE;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Liminal StemSplit <onboarding@myaiplug.com>';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const AFFILIATE_SPLICE = process.env.AFFILIATE_SPLICE || '';
const AFFILIATE_LOOPCLOUD = process.env.AFFILIATE_LOOPCLOUD || '';
const AFFILIATE_DISTROKID = process.env.AFFILIATE_DISTROKID || '';
const AFFILIATE_PLUGINBOUTIQUE = process.env.AFFILIATE_PLUGINBOUTIQUE || '';
const AFFILIATE_SKILLSHARE = process.env.AFFILIATE_SKILLSHARE || '';
const hasAffiliates = AFFILIATE_SPLICE || AFFILIATE_LOOPCLOUD || AFFILIATE_DISTROKID || AFFILIATE_PLUGINBOUTIQUE || AFFILIATE_SKILLSHARE;

function buildAffiliateSection() {
  if (!hasAffiliates) return '';
  const links = [];
  if (AFFILIATE_SPLICE) links.push(`<a href="${AFFILIATE_SPLICE}" style="color:#22d3ee">Splice Sounds</a> — royalty-free samples & loops`);
  if (AFFILIATE_LOOPCLOUD) links.push(`<a href="${AFFILIATE_LOOPCLOUD}" style="color:#22d3ee">Loopcloud</a> — cloud-based sample library`);
  if (AFFILIATE_DISTROKID) links.push(`<a href="${AFFILIATE_DISTROKID}" style="color:#22d3ee">DistroKid</a> — distribute your music to Spotify/Apple`);
  if (AFFILIATE_PLUGINBOUTIQUE) links.push(`<a href="${AFFILIATE_PLUGINBOUTIQUE}" style="color:#22d3ee">Plugin Boutique</a> — VSTs, DAWs, soundware deals`);
  if (AFFILIATE_SKILLSHARE) links.push(`<a href="${AFFILIATE_SKILLSHARE}" style="color:#22d3ee">Skillshare</a> — production & mixing courses`);
  return `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:rgba(34,211,238,0.04);border:1px solid rgba(34,211,238,0.1);border-radius:12px">
            <tr><td style="padding:16px 20px">
              <strong style="color:#22d3ee;font-size:14px">Producer Essentials</strong>
              <p style="margin:4px 0 8px;font-size:13px;color:#64748b">Tools we use and recommend:</p>
              ${links.map(l => `<div style="padding:4px 0;font-size:13px">◆ ${l}</div>`).join('')}
            </td></tr>
          </table>`;
}

function buildVerificationHtml(username, verificationCode) {
  const greeting = username ? `Hi ${username},` : 'Hi,';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(6,182,212,0.2);border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 36px 12px;text-align:center">
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#06b6d4;margin-bottom:12px">Liminal StemSplit</div>
          <h1 style="margin:0;font-size:24px;color:#fff;font-weight:800">Verify your email</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 32px;line-height:1.7;font-size:15px;color:#94a3b8;text-align:center">
          <p style="margin:0 0 20px">${greeting} enter this 6-digit code in the desktop app to finish creating your <strong style="color:#e2e8f0">free account</strong>.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);border-radius:12px;margin:0 0 20px">
            <tr><td style="padding:24px;text-align:center">
              <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#67e8f9">Email verification code (not a Pro license)</p>
              <p style="margin:0;font-family:monospace;font-size:36px;color:#fff;letter-spacing:0.28em;font-weight:700">${verificationCode}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 12px;font-size:13px;color:#64748b">Free tier: Spleeter splits only. <strong style="color:#94a3b8">No Pro license key is included with free download or free signup.</strong></p>
          <p style="margin:0;font-size:13px;color:#64748b">A Pro license key is emailed only after you buy Pro (Gumroad, Shopify, or Stripe).</p>
        </td></tr>
        <tr><td style="padding:16px 36px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:12px;color:#475569">
          If you didn't sign up, you can ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
          <h1 style="margin:0;font-size:26px;color:#fff;font-weight:800">Welcome to StemSplit</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 32px;line-height:1.7;font-size:15px;color:#94a3b8">
          <p style="margin:0 0 20px">Thanks for signing up. Separate vocals, drums, bass, and more from any track.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15);border-radius:12px">
            <tr><td style="padding:14px 18px;font-size:13px;color:#94a3b8">
              <strong style="color:#e2e8f0">Free download = no license key.</strong><br>
              You do not need (and will not receive) a Pro license key unless you purchase Pro. Free mode works after install with Spleeter.
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr><td>
              <strong style="color:#22d3ee;font-size:15px">Quick Start</strong>
            </td></tr>
            <tr><td height="8"></td></tr>
            <tr><td style="padding:12px 16px;background:rgba(6,182,212,0.05);border-radius:8px;font-size:14px">
              1. Drop any WAV/MP3/FLAC into the app<br>
              2. Use the Free / Quick job for Spleeter splits<br>
              3. Solo, mute, and compare each stem<br>
              4. Buy Pro only if you want all engines, peels, FX, and WAV
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
          ${buildAffiliateSection()}
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

/** Website lead capture — marketing welcome, no verification code. */
export async function sendWelcomeEmail(email) {
  return resendSend({
    to: email,
    subject: 'Welcome to Liminal StemSplit',
    html: buildWelcomeHtml(),
  });
}

/** Desktop app signup — verification code only, no marketing clutter. */
export async function sendVerificationEmail(email, username, verificationCode) {
  const code = String(verificationCode || '').trim();
  if (!code) return { sent: false, reason: 'Missing verification code' };
  return resendSend({
    to: email,
    subject: `Your Liminal StemSplit verification code: ${code}`,
    html: buildVerificationHtml(username, code),
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