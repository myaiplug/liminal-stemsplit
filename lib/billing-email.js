const FROM_EMAIL =
  process.env.STEMSPLIT_ONBOARDING_FROM ||
  process.env.FROM_EMAIL ||
  'Liminal StemSplit <onboarding@myaiplug.com>';
const PRODUCTION_SITE = 'https://liminal-stemsplit.onrender.com';
const SITE_URL = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || PRODUCTION_SITE;
const DOWNLOAD_URL =
  process.env.STEMSPLIT_DOWNLOAD_URL ||
  'https://github.com/myaiplug/liminal-stemsplit/releases/tag/v0.5.0';

/**
 * @param {string} email
 * @param {string} accessPassword - primary key the user pastes in Activate Pro
 * @param {{ source?: string, secondaryKey?: string|null, storeLabel?: string }} [opts]
 */
function buildActivationHtml(email, accessPassword, opts = {}) {
  const source = opts.source || 'purchase';
  const storeLabel =
    opts.storeLabel ||
    (source === 'gumroad' ? 'Gumroad' : source === 'shopify' ? 'Shopify' : source === 'stripe' ? 'Stripe' : 'your purchase');
  const secondary = opts.secondaryKey && opts.secondaryKey !== accessPassword ? opts.secondaryKey : null;
  const keyLabel =
    source === 'gumroad' && !secondary
      ? 'License key'
      : source === 'shopify'
        ? 'License key / access password'
        : 'Access password / license key';

  const product = opts.product || '';
  const isCoProducer = product === 'coproducer_pro' || (opts.productName || '').toLowerCase().includes('coproducer');
  const isDeGloss = product === 'vst_reverb_degloss' || (opts.productName || '').toLowerCase().includes('degloss');

  const brandHeader = isCoProducer ? 'NoDAW CoProducer PRO' : isDeGloss ? 'ReVerb-DeGloss VST' : 'Liminal StemSplit Pro';
  const licenseTitle = isCoProducer ? 'Your CoProducer PRO license is ready' : isDeGloss ? 'Your ReVerb-DeGloss license is ready' : 'Your Pro license is ready';

  const stepsHtml = isCoProducer
    ? `<strong style="color:#e2e8f0">Quick Start</strong><br>
       1) Launch CoProducer Desktop (or run <code style="color:#a7f3d0">START_GUI.bat</code>)<br>
       2) Use your purchase email and license key below to access all PRO features.`
    : isDeGloss
    ? `<strong style="color:#e2e8f0">Quick Start</strong><br>
       1) Load ReVerb-DeGloss VST in your DAW<br>
       2) Activate using your license key below.`
    : `<strong style="color:#e2e8f0">Install in 3 steps</strong><br>
       1) Download the <strong style="color:#a7f3d0">WORKING</strong> Windows installer from the release page<br>
       2) Double-click to install (default: D:\\Liminal\\NoDAW)<br>
       3) Open <strong style="color:#a7f3d0">Activate Pro</strong> and paste email + license key`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid rgba(16,185,129,0.2);border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 36px 20px;text-align:center">
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#34d399;margin-bottom:12px">${brandHeader}</div>
          <h1 style="margin:0;font-size:24px;color:#fff;font-weight:800">${licenseTitle}</h1>
          <p style="margin:10px 0 0;font-size:13px;color:#64748b">via ${storeLabel}</p>
        </td></tr>
        <tr><td style="padding:8px 36px 28px;line-height:1.7;font-size:15px;color:#94a3b8">
          <p style="margin:0 0 16px">Thanks for purchasing. Use the details below to activate your software.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(16,185,129,0.08);border-radius:12px">
            <tr><td style="padding:18px 20px">
              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7">Purchase email</p>
              <p style="margin:0 0 16px;font-family:monospace;color:#ecfdf5">${email}</p>
              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7">${keyLabel}</p>
              <p style="margin:0;font-family:monospace;font-size:18px;color:#fff;letter-spacing:0.04em;word-break:break-all">${accessPassword}</p>
              ${
                secondary
                  ? `<p style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7">Alternate key</p>
              <p style="margin:0;font-family:monospace;font-size:14px;color:#a7f3d0;word-break:break-all">${secondary}</p>`
                  : ''
              }
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:14px">
            ${stepsHtml}
          </p>
          <p style="margin:20px 0 0;text-align:center">
            <a href="${DOWNLOAD_URL}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;margin-right:8px">Download installer →</a>
            <a href="${SITE_URL}" style="display:inline-block;padding:12px 24px;border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px">Website →</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send Pro activation email.
 * @param {string} email
 * @param {string} accessPassword
 * @param {{ source?: string, secondaryKey?: string|null, storeLabel?: string, product?: string, productName?: string }} [opts]
 */
/** Only paid purchase sources may send Pro license emails. Free download/signup never. */
const PAID_LICENSE_SOURCES = new Set([
  'stripe',
  'gumroad',
  'shopify',
  'admin',
  'managed_pro',
]);

export async function sendProActivationEmail(email, accessPassword, opts = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };
  if (!email || !accessPassword) return { sent: false, reason: 'Missing email or access password' };

  // Hard gate: require an explicit paid source. Empty/unknown/free never send a key.
  const src = String(opts.source || '').trim().toLowerCase();
  if (!src || !PAID_LICENSE_SOURCES.has(src)) {
    return {
      sent: false,
      blocked: true,
      reason: 'Pro license email blocked — only paid purchases (Stripe/Gumroad/Shopify) receive keys',
    };
  }

  const product = opts.product || '';
  const isCoProducer = product === 'coproducer_pro' || (opts.productName || '').toLowerCase().includes('coproducer');
  const isDeGloss = product === 'vst_reverb_degloss' || (opts.productName || '').toLowerCase().includes('degloss');
  const subject = isCoProducer
    ? 'Your CoProducer PRO license'
    : isDeGloss
      ? 'Your ReVerb-DeGloss VST license'
      : 'Your Liminal StemSplit Pro license';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html: buildActivationHtml(email, accessPassword, opts),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { sent: false, reason: data.message || response.statusText };
  return { sent: true, id: data.id };
}
