import './load-env.mjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
// timingSafeEqual used for Shopify HMAC
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { URL } from 'node:url';
import { checkoutConfigStatus, createCheckoutSession } from './stripe-checkout.mjs';
import { ALL_VST_ENTITLEMENTS, productToEntitlement } from './vst-products.mjs';
import {
  assessBillingReadiness,
  deliverActivationEmailAfterPurchase,
  dispatchActivationEmailForEmail,
  getActivationEmailQueueSummary,
  processPendingActivationEmails,
  startActivationEmailWorker,
} from './activation-email-delivery.mjs';
import {
  initDb,
  wasWebhookProcessed,
  recordWebhookProcessed,
  findLicenseByEmail,
  upsertLicense,
  listLicenses,
  isTursoConfigured,
} from './db-turso.mjs';

const port = Number(process.env.PORT || 8787);
const billingRootDir = dirname(fileURLToPath(import.meta.url));
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const gumroadWebhookSecret = process.env.GUMROAD_WEBHOOK_SECRET || '';
const shopifyWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || '';
const billingAdminToken = process.env.BILLING_ADMIN_TOKEN || '';
const stripeSignatureToleranceSec = Number(process.env.STRIPE_SIGNATURE_TOLERANCE_SEC || 300);

function credentialForEmail(saved, gumroadLicenseKey = null) {
  if (gumroadLicenseKey) {
    return {
      primary: gumroadLicenseKey,
      secondary: saved.credential && saved.credential !== gumroadLicenseKey ? saved.credential : null,
      source: 'gumroad',
    };
  }
  return { primary: saved.credential, secondary: null, source: saved.source || 'stripe' };
}

function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!shopifyWebhookSecret) {
    return { ok: false, error: 'SHOPIFY_WEBHOOK_SECRET not configured' };
  }
  if (!hmacHeader) return { ok: false, error: 'Missing X-Shopify-Hmac-Sha256' };
  const digest = createHmac('sha256', shopifyWebhookSecret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(String(hmacHeader), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: 'Shopify HMAC mismatch' };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'Shopify HMAC check failed' };
  }
}

function isStemSplitShopifyProduct(order) {
  const items = order?.line_items || [];
  if (!items.length) return true;
  const needle = (process.env.SHOPIFY_PRODUCT_NEEDLE || 'stemsplit|liminal|pro').toLowerCase();
  const patterns = needle.split('|').map((p) => p.trim()).filter(Boolean);
  return items.some((item) => {
    const hay = `${item.title || ''} ${item.name || ''} ${item.sku || ''}`.toLowerCase();
    return patterns.some((p) => hay.includes(p));
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function tryParseJson(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return null;
  }
}

function isAdminAuthorized(req) {
  if (!billingAdminToken) return false;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return token === billingAdminToken;
}

function sha256(value) {
  return createHmac('sha256', 'stemsplit-billing').update(value).digest('hex');
}

function generateAccessPassword() {
  return randomBytes(12).toString('base64url');
}

function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!stripeWebhookSecret || !signatureHeader) {
    return { ok: false, error: 'Missing Stripe signing configuration or signature header' };
  }

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    return { ok: false, error: 'Missing Stripe timestamp or v1 signature' };
  }

  const tsNum = Number(timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, error: 'Invalid Stripe signature timestamp' };
  }
  if (Math.abs(nowSec - tsNum) > stripeSignatureToleranceSec) {
    return { ok: false, error: 'Stripe signature timestamp outside tolerance window' };
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', stripeWebhookSecret).update(signedPayload).digest('hex');
  if (!safeHexEqual(expected, signature)) {
    return { ok: false, error: 'Stripe signature mismatch' };
  }

  return { ok: true, error: null };
}

function mergeEntitlements(existing = [], product) {
  const entitlement = productToEntitlement(product);
  if (entitlement === 'all') return [...ALL_VST_ENTITLEMENTS];
  if (!entitlement) return [...existing];
  return existing.includes(entitlement) ? [...existing] : [...existing, entitlement];
}

async function upsertLicenseLocal({
  email,
  source,
  plan = 'pro',
  credential,
  purchaseDate,
  gumroadLicenseKey = null,
  metadata = {},
  product = metadata?.product || 'stemsplit_pro',
}) {
  return upsertLicense({
    email,
    source,
    plan,
    credential,
    purchaseDate,
    gumroadLicenseKey,
    metadata,
    product,
    sha256,
    generateAccessPassword,
    mergeEntitlements,
  });
}

async function lookupEntitlements(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required', email: null, pro: false, entitlements: [] };
  }

  const record = await findLicenseByEmail(normalizedEmail);
  if (!record) {
    return { ok: true, email: normalizedEmail, pro: false, entitlements: [] };
  }

  const pro = record.plan === 'pro';
  const entitlements = pro ? [...ALL_VST_ENTITLEMENTS] : [...(record.entitlements || [])];
  return { ok: true, email: normalizedEmail, pro, entitlements };
}

async function validateCredential(email, licenseKey) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const record = await findLicenseByEmail(normalizedEmail);
  if (!record) {
    return { recognized: false, valid: false, error: 'No hosted license found for this email' };
  }

  const hashed = sha256(`${normalizedEmail}::${licenseKey}`);
  const licenseMatch = record.gumroadLicenseKey && record.gumroadLicenseKey === licenseKey;
  const credentialMatch = hashed === record.credentialHash;

  if (!licenseMatch && !credentialMatch) {
    return { recognized: true, valid: false, error: 'Hosted access credential is invalid' };
  }

  const pro = record.plan === 'pro';
  const entitlements = pro ? [...ALL_VST_ENTITLEMENTS] : [...(record.entitlements || [])];

  return {
    recognized: true,
    valid: true,
    email: record.email,
    purchase_date: record.purchaseDate,
    plan: record.plan,
    features: pro ? ['all'] : entitlements.map((id) => `vst:${id}`),
    entitlements,
    error: null,
  };
}

async function listLicensesSafe() {
  return listLicenses();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const readiness = await assessBillingReadiness();
    const queue = getActivationEmailQueueSummary();
    return sendJson(res, 200, {
      ok: readiness.ready,
      service: 'billing-webhooks',
      checkout: checkoutConfigStatus(),
      email: { configured: readiness.emailConfigured },
      readiness,
      activationEmailQueue: queue,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/checkout/status') {
    return sendJson(res, 200, { ok: true, checkout: checkoutConfigStatus() });
  }

  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody) || {};
    const result = await createCheckoutSession({
      email: body.email || '',
      product: body.product || 'stemsplit_pro',
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });
    if (!result.ok) {
      return sendJson(res, 503, { ok: false, error: result.error });
    }
    return sendJson(res, 200, {
      ok: true,
      url: result.url,
      mode: result.mode,
      sessionId: result.sessionId || null,
      product: result.product || body.product || 'stemsplit_pro',
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/entitlements/lookup') {
    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody) || {};
    return sendJson(res, 200, await lookupEntitlements(body.email));
  }

  if (req.method === 'POST' && url.pathname === '/api/licenses/validate') {
    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody);
    if (!body) return sendJson(res, 400, { recognized: false, valid: false, error: 'Invalid JSON payload' });
    return sendJson(res, 200, await validateCredential(body.email, body.licenseKey));
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
    const rawBody = await readBody(req);
    const sigCheck = verifyStripeSignature(rawBody, req.headers['stripe-signature']);
    if (!sigCheck.ok) {
      return sendJson(res, 401, { ok: false, error: sigCheck.error || 'Invalid Stripe signature' });
    }

    const event = tryParseJson(rawBody);
    if (!event) return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
    if (event.type !== 'checkout.session.completed') {
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    const stripeEventKey = event.id
      ? `stripe:${event.id}`
      : `stripe:raw:${sha256(rawBody.toString('utf8'))}`;
    if (await wasWebhookProcessed(stripeEventKey)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    const session = event.data?.object || {};
    const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
    const product = session.metadata?.product || 'stemsplit_pro';
    const plan = session.metadata?.plan || (product === 'stemsplit_pro' ? 'pro' : 'vst');
    const credential = session.metadata?.access_password || '';
    try {
      const saved = await upsertLicenseLocal({
        email,
        source: 'stripe',
        plan,
        product,
        credential,
        purchaseDate: new Date().toISOString(),
        metadata: { sessionId: session.id || null, product },
      });

      await recordWebhookProcessed(stripeEventKey, 'stripe', {
        eventId: event.id || null,
        sessionId: session.id || null,
        email: email || null,
      });

      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: saved.credential,
        source: 'stripe',
        eventKey: stripeEventKey,
      });

      return sendJson(res, 200, {
        ok: true,
        saved: {
          email: saved.email,
          plan: saved.plan,
          source: saved.source,
        },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
        readiness: emailResult.readiness || null,
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/gumroad') {
    const secret = url.searchParams.get('secret') || req.headers['x-gumroad-secret'];
    if (gumroadWebhookSecret && secret !== gumroadWebhookSecret) {
      return sendJson(res, 401, { ok: false, error: 'Invalid Gumroad webhook secret' });
    }

    const rawBody = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    const body = contentType.includes('application/json')
      ? tryParseJson(rawBody)
      : Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
    if (!body) return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });

    const refunded = body.refunded === 'true' || body.refunded === true || body.chargebacked === 'true';
    if (refunded) {
      return sendJson(res, 200, { ok: true, ignored: true, reason: 'refund_or_chargeback' });
    }

    const email = body.email || body.purchase_email || body['purchase[email]'];
    const gumroadLicenseKey = body.license_key || body['purchase[license_key]'] || null;
    const credential = body.access_password || gumroadLicenseKey || null;
    const gumroadSaleId = body.sale_id || body['sale[id]'] || body.order_id || null;
    const gumroadEventKey = gumroadSaleId
      ? `gumroad:sale:${gumroadSaleId}`
      : `gumroad:raw:${sha256(rawBody.toString('utf8'))}`;
    if (await wasWebhookProcessed(gumroadEventKey)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    try {
      const saved = await upsertLicenseLocal({
        email,
        source: 'gumroad',
        plan: body.plan || 'pro',
        product: 'stemsplit_pro',
        credential,
        purchaseDate: body.sale_timestamp || new Date().toISOString(),
        gumroadLicenseKey,
        metadata: {
          saleId: gumroadSaleId,
          productName: body.product_name || body['product[name]'] || null,
        },
      });

      await recordWebhookProcessed(gumroadEventKey, 'gumroad', {
        saleId: gumroadSaleId,
        email: email || null,
      });

      const keys = credentialForEmail(saved, gumroadLicenseKey);
      if (!keys.primary) {
        throw new Error('No activatable credential for Gumroad sale');
      }

      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: keys.primary,
        source: 'gumroad',
        eventKey: gumroadEventKey,
        emailOpts: { source: 'gumroad', secondaryKey: keys.secondary, storeLabel: 'Gumroad' },
      });

      return sendJson(res, 200, {
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
        emailedKeyType: gumroadLicenseKey ? 'gumroad_license_key' : 'hosted_password',
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/shopify') {
    const rawBody = await readBody(req);
    if (shopifyWebhookSecret) {
      const check = verifyShopifyHmac(rawBody, req.headers['x-shopify-hmac-sha256']);
      if (!check.ok) return sendJson(res, 401, { ok: false, error: check.error });
    }

    const order = tryParseJson(rawBody);
    if (!order) return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });

    const topic = String(req.headers['x-shopify-topic'] || '');
    const financial = String(order.financial_status || '').toLowerCase();
    const paid =
      topic.includes('paid') ||
      financial === 'paid' ||
      financial === 'partially_paid' ||
      !!order.closed_at;
    if (!paid && topic && !topic.includes('paid')) {
      return sendJson(res, 200, {
        ok: true,
        ignored: true,
        reason: `topic_or_status_not_paid:${topic || financial}`,
      });
    }
    if (!isStemSplitShopifyProduct(order)) {
      return sendJson(res, 200, { ok: true, ignored: true, reason: 'no_matching_line_item' });
    }

    const email =
      order.email ||
      order.contact_email ||
      order.customer?.email ||
      order.billing_address?.email ||
      null;
    const orderId = order.id || order.order_number || order.name || null;
    const shopifyEventKey = orderId
      ? `shopify:order:${orderId}`
      : `shopify:raw:${sha256(rawBody.toString('utf8'))}`;
    if (await wasWebhookProcessed(shopifyEventKey)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    try {
      const saved = await upsertLicenseLocal({
        email,
        source: 'shopify',
        plan: 'pro',
        product: 'stemsplit_pro',
        credential: null,
        purchaseDate: order.processed_at || order.created_at || new Date().toISOString(),
        metadata: {
          orderId,
          orderName: order.name || null,
          shopDomain: req.headers['x-shopify-shop-domain'] || null,
        },
      });

      await recordWebhookProcessed(shopifyEventKey, 'shopify', {
        orderId,
        email: email || null,
      });

      if (!saved.credential) {
        throw new Error('Shopify order saved but no credential generated');
      }

      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: saved.credential,
        source: 'shopify',
        eventKey: shopifyEventKey,
        emailOpts: { source: 'shopify', storeLabel: 'Shopify' },
      });

      return sendJson(res, 200, {
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/activation-emails/dispatch') {
    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody) || {};
    const result = await dispatchActivationEmailForEmail(body.email);
    return sendJson(res, 200, {
      ok: result.sent || !!result.queued,
      sent: result.sent,
      queued: !!result.queued,
      reason: result.reason || null,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/activation-emails/process') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }
    const results = await processPendingActivationEmails(20);
    return sendJson(res, 200, { ok: true, processed: results.length, results });
  }

  if (req.method === 'POST' && url.pathname === '/api/licenses/issue') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }

    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody);
    if (!body) return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
    try {
      // Admin may only issue paid Pro credentials — never free-tier "licenses"
      const rawSource = String(body.source || 'admin').toLowerCase();
      const source =
        rawSource === 'free' || rawSource === 'download' || rawSource === 'signup'
          ? 'admin'
          : rawSource || 'admin';
      const saved = await upsertLicenseLocal({
        ...body,
        source,
        plan: 'pro',
        product: body.product || 'stemsplit_pro',
      });
      const sendEmail = body.sendEmail !== false;
      let emailResult = { sent: false, queued: false, reason: 'not_requested' };
      if (sendEmail && saved.credential) {
        emailResult = await deliverActivationEmailAfterPurchase({
          email: saved.email,
          credential: saved.credential,
          source: 'admin',
          eventKey: `admin:issue:${saved.email}:${Date.now()}`,
          emailOpts: { source: 'admin', storeLabel: 'Support' },
        });
      }
      return sendJson(res, 200, {
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: !!emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason || null,
      });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/licenses/admin/list') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }
    return sendJson(res, 200, { ok: true, licenses: await listLicensesSafe() });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(port, async () => {
  if (isTursoConfigured()) {
    try {
      await initDb();
    } catch (err) {
      console.error(`WARNING: Turso DB init failed: ${err.message}`);
    }
  } else {
    console.warn('WARNING: TURSO_DATABASE_URL not set. DB operations will fail until configured.');
  }
  startActivationEmailWorker();
  const checkout = checkoutConfigStatus();
  console.log(`StemSplit billing service listening on http://localhost:${port}`);
  console.log(`DB: ${isTursoConfigured() ? 'Turso (persistent cloud)' : 'NOT CONFIGURED — set TURSO_DATABASE_URL'}`);
  console.log(
    `Checkout: ${
      checkout.ready
        ? checkout.dynamicReady
          ? 'Stripe Checkout Sessions'
          : 'Stripe Payment Link'
        : 'NOT CONFIGURED'
    }`
  );
  if (!process.env.RESEND_API_KEY) {
    console.warn('WARNING: RESEND_API_KEY is not set. Activation emails will not be sent.');
  }
  if (!billingAdminToken) {
    console.warn('WARNING: BILLING_ADMIN_TOKEN is not set. Admin endpoints are disabled.');
  }
});
