import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { checkoutConfigStatus, createCheckoutSession } from './stripe-checkout.js';
import {
  assessBillingReadiness,
  deliverActivationEmailAfterPurchase,
  dispatchActivationEmailForEmail,
  getActivationEmailQueueSummary,
  processPendingActivationEmails,
  startActivationEmailWorker,
} from './activation-email-delivery.js';
import { sendVerificationEmail } from './email.js';
import {
  hashPayload,
  listLicensesSafe,
  recordWebhookProcessed,
  safeHexEqual,
  lookupEntitlements,
  upsertLicense,
  validateCredential,
  wasWebhookProcessed,
} from './billing-store.js';

const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const gumroadWebhookSecret = process.env.GUMROAD_WEBHOOK_SECRET || '';
const shopifyWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || '';
const billingAdminToken = process.env.BILLING_ADMIN_TOKEN || '';
const stripeSignatureToleranceSec = Number(process.env.STRIPE_SIGNATURE_TOLERANCE_SEC || 300);
const siteUrl = process.env.SITE_URL || 'https://liminal-stemsplit.onrender.com';

/** Prefer store license key when present so customers activate with what they expect. */
function credentialForActivationEmail(saved, { gumroadLicenseKey = null } = {}) {
  if (gumroadLicenseKey) {
    return {
      primary: gumroadLicenseKey,
      secondary: saved.credential && saved.credential !== gumroadLicenseKey ? saved.credential : null,
      source: 'gumroad',
    };
  }
  return {
    primary: saved.credential,
    secondary: null,
    source: saved.source || 'stripe',
  };
}

function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!shopifyWebhookSecret) {
    return { ok: false, error: 'SHOPIFY_WEBHOOK_SECRET (or SHOPIFY_API_SECRET) not configured' };
  }
  if (!hmacHeader) {
    return { ok: false, error: 'Missing X-Shopify-Hmac-Sha256 header' };
  }
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

function detectShopifyProduct(order) {
  const items = order?.line_items || [];
  if (!items.length) return { isMatch: true, product: 'stemsplit_pro', productName: 'Creator Pro' };

  for (const item of items) {
    const hay = `${item.title || ''} ${item.name || ''} ${item.sku || ''}`.toLowerCase();
    if (hay.includes('coproducer')) {
      return { isMatch: true, product: 'coproducer_pro', productName: item.title || 'CoProducer PRO' };
    }
    if (hay.includes('degloss') || hay.includes('reverb')) {
      return { isMatch: true, product: 'vst_reverb_degloss', productName: item.title || 'ReVerb-DeGloss' };
    }
    if (hay.includes('stemsplit') || hay.includes('liminal') || hay.includes('pro') || hay.includes('stem')) {
      return { isMatch: true, product: 'stemsplit_pro', productName: item.title || 'Liminal StemSplit Pro' };
    }
  }

  const needle = (process.env.SHOPIFY_PRODUCT_NEEDLE || 'stemsplit|liminal|pro|coproducer|degloss').toLowerCase();
  const patterns = needle.split('|').map((p) => p.trim()).filter(Boolean);
  const matchAny = items.some((item) => {
    const hay = `${item.title || ''} ${item.name || ''} ${item.sku || ''}`.toLowerCase();
    return patterns.some((p) => hay.includes(p));
  });

  if (matchAny) {
    return { isMatch: true, product: 'stemsplit_pro', productName: items[0]?.title || 'Creator Pro' };
  }

  return { isMatch: false, product: null, productName: null };
}

function isStemSplitShopifyProduct(order) {
  return detectShopifyProduct(order).isMatch;
}

function isAdminAuthorized(req) {
  if (!billingAdminToken) return false;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return token === billingAdminToken;
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
  if (!Number.isFinite(tsNum)) return { ok: false, error: 'Invalid Stripe signature timestamp' };
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

export function createBillingRouter() {
  const router = Router();

  router.get('/billing/health', (req, res) => {
    const readiness = assessBillingReadiness();
    const queue = getActivationEmailQueueSummary();
    res.json({
      ok: readiness.ready,
      service: 'billing',
      checkout: checkoutConfigStatus(),
      email: { configured: readiness.emailConfigured },
      readiness,
      activationEmailQueue: queue,
    });
  });

  // Anonymous usage ping — desktop app sends minimal data for tracking
  router.post('/api/ping', (req, res) => {
    const { event, version } = req.body || {};
    const ts = new Date().toISOString();
    const entry = { ts, event: event || 'unknown', version: version || '?', ip: req.ip };
    // Log to stdout (Render captures this to its log system)
    console.log(`[ping] ${ts} | ${entry.event} | v${entry.version} | ${entry.ip}`);
    res.json({ ok: true });
  });

  // Desktop app calls this after free signup to deliver the verification code email
  router.post('/api/onboarding', async (req, res) => {
    const { email, username, verificationCode } = req.body || {};
    if (!email || !username) {
      return res.status(400).json({ sent: false, reason: 'Missing email or username' });
    }
    if (!verificationCode) {
      return res.status(400).json({ sent: false, reason: 'Missing verification code' });
    }
    const result = await sendVerificationEmail(email, username, verificationCode);
    res.json(result);
  });

  router.post('/api/onboarding/resend', async (req, res) => {
    const { email, username, verificationCode } = req.body || {};
    if (!email) {
      return res.status(400).json({ sent: false, reason: 'Missing email' });
    }
    if (!verificationCode) {
      return res.status(400).json({ sent: false, reason: 'Missing verification code' });
    }
    const result = await sendVerificationEmail(email, username || '', verificationCode);
    res.json(result);
  });

  router.get('/api/checkout/status', (req, res) => {
    res.json({ ok: true, checkout: checkoutConfigStatus() });
  });

  router.post('/api/checkout', async (req, res) => {
    const result = await createCheckoutSession({
      email: req.body?.email || '',
      product: req.body?.product || 'stemsplit_pro',
      successUrl: req.body?.successUrl || `${siteUrl}/?checkout=success`,
      cancelUrl: req.body?.cancelUrl || `${siteUrl}/#pricing`,
    });
    if (!result.ok) return res.status(503).json({ ok: false, error: result.error });
    res.json({
      ok: true,
      url: result.url,
      mode: result.mode,
      sessionId: result.sessionId || null,
      product: result.product || req.body?.product || 'stemsplit_pro',
    });
  });

  router.post('/api/entitlements/lookup', (req, res) => {
    const { email } = req.body || {};
    res.json(lookupEntitlements(email));
  });

  router.post('/api/licenses/validate', (req, res) => {
    const { email, licenseKey } = req.body || {};
    res.json(validateCredential(email, licenseKey));
  });

  router.post('/webhooks/stripe', async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const sigCheck = verifyStripeSignature(rawBody, req.headers['stripe-signature']);
    if (!sigCheck.ok) {
      return res.status(401).json({ ok: false, error: sigCheck.error || 'Invalid Stripe signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8') || '{}');
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
    }

    if (event.type !== 'checkout.session.completed') {
      return res.json({ ok: true, ignored: true });
    }

    const stripeEventKey = event.id
      ? `stripe:${event.id}`
      : `stripe:raw:${hashPayload(rawBody.toString('utf8'))}`;
    if (wasWebhookProcessed(stripeEventKey)) {
      return res.json({ ok: true, duplicate: true });
    }

    const session = event.data?.object || {};
    const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
    const product = session.metadata?.product || 'stemsplit_pro';
    const plan = session.metadata?.plan || (product === 'stemsplit_pro' ? 'pro' : 'vst');
    const credential = session.metadata?.access_password || '';

    try {
      const saved = upsertLicense({
        email,
        source: 'stripe',
        plan,
        product,
        credential,
        purchaseDate: new Date().toISOString(),
        metadata: { sessionId: session.id || null, product },
      });

      recordWebhookProcessed(stripeEventKey, 'stripe', {
        eventId: event.id || null,
        sessionId: session.id || null,
        email: email || null,
      });

      const keys = credentialForActivationEmail(saved);
      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: keys.primary,
        source: 'stripe',
        eventKey: stripeEventKey,
        emailOpts: { source: 'stripe', secondaryKey: keys.secondary },
      });
      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
        readiness: emailResult.readiness || null,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  router.post('/webhooks/gumroad', async (req, res) => {
    const secret = req.query.secret || req.headers['x-gumroad-secret'];
    if (gumroadWebhookSecret && secret !== gumroadWebhookSecret) {
      return res.status(401).json({ ok: false, error: 'Invalid Gumroad webhook secret' });
    }

    const body = req.body || {};
    // Gumroad pings may send refund/cancellation — only issue licenses for sales
    const refunded = body.refunded === 'true' || body.refunded === true || body.chargebacked === 'true';
    if (refunded) {
      return res.json({ ok: true, ignored: true, reason: 'refund_or_chargeback' });
    }

    const email = body.email || body.purchase_email || body['purchase[email]'];
    const gumroadLicenseKey = body.license_key || body['purchase[license_key]'] || null;
    // Hosted password if provided; otherwise generate. Email prefers Gumroad license_key.
    const credential = body.access_password || null;
    const gumroadSaleId = body.sale_id || body['sale[id]'] || body.order_id || null;
    const gumroadEventKey = gumroadSaleId
      ? `gumroad:sale:${gumroadSaleId}`
      : `gumroad:raw:${hashPayload(JSON.stringify(body))}`;

    if (wasWebhookProcessed(gumroadEventKey)) {
      return res.json({ ok: true, duplicate: true });
    }

    try {
      const saved = upsertLicense({
        email,
        source: 'gumroad',
        plan: body.plan || 'pro',
        product: 'stemsplit_pro',
        // Prefer storing gumroad key as activatable credential when present
        credential: credential || gumroadLicenseKey || undefined,
        purchaseDate: body.sale_timestamp || new Date().toISOString(),
        gumroadLicenseKey,
        metadata: {
          saleId: gumroadSaleId,
          productName: body.product_name || body['product[name]'] || null,
          productPermalink: body.product_permalink || null,
        },
      });

      recordWebhookProcessed(gumroadEventKey, 'gumroad', {
        saleId: gumroadSaleId,
        email: email || null,
      });

      const keys = credentialForActivationEmail(saved, { gumroadLicenseKey });
      if (!keys.primary) {
        throw new Error('No activatable credential produced for Gumroad sale');
      }

      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: keys.primary,
        source: 'gumroad',
        eventKey: gumroadEventKey,
        emailOpts: { source: 'gumroad', secondaryKey: keys.secondary, storeLabel: 'Gumroad' },
      });
      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
        readiness: emailResult.readiness || null,
        emailedKeyType: gumroadLicenseKey ? 'gumroad_license_key' : 'hosted_password',
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  /**
   * Shopify — auto-issue Pro license on paid orders.
   * Configure in Shopify Admin → Settings → Notifications → Webhooks:
   *   Event: Order payment  (or orders/paid)
   *   URL:   https://YOUR-HOST/webhooks/shopify
   *   Format: JSON
   * Env: SHOPIFY_WEBHOOK_SECRET = Admin API client secret used for HMAC
   */
  router.post('/webhooks/shopify', async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

    // When secret is set, require valid HMAC. When unset (dev), accept but warn.
    if (shopifyWebhookSecret) {
      const hmac = req.headers['x-shopify-hmac-sha256'];
      const check = verifyShopifyHmac(rawBody, hmac);
      if (!check.ok) {
        return res.status(401).json({ ok: false, error: check.error });
      }
    }

    let order;
    try {
      order = Buffer.isBuffer(req.body)
        ? JSON.parse(rawBody.toString('utf8') || '{}')
        : req.body || {};
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
    }

    const topic = String(req.headers['x-shopify-topic'] || '');
    // Accept orders/paid, orders/create (if financial_status paid), order payments
    const financial = String(order.financial_status || '').toLowerCase();
    const paid =
      topic.includes('paid') ||
      financial === 'paid' ||
      financial === 'partially_paid' ||
      !!order.closed_at;

    if (!paid && topic && !topic.includes('paid')) {
      return res.json({ ok: true, ignored: true, reason: `topic_or_status_not_paid:${topic || financial}` });
    }

    const detected = detectShopifyProduct(order);
    if (!detected.isMatch) {
      return res.json({ ok: true, ignored: true, reason: 'no_matching_line_item' });
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
      : `shopify:raw:${hashPayload(rawBody.toString('utf8'))}`;

    if (wasWebhookProcessed(shopifyEventKey)) {
      return res.json({ ok: true, duplicate: true });
    }

    try {
      const saved = upsertLicense({
        email,
        source: 'shopify',
        plan: 'pro',
        product: detected.product,
        credential: undefined, // generate hosted password
        purchaseDate: order.processed_at || order.created_at || new Date().toISOString(),
        metadata: {
          orderId,
          orderName: order.name || null,
          shopDomain: req.headers['x-shopify-shop-domain'] || null,
          productName: detected.productName,
          lineItems: (order.line_items || []).map((i) => i.title || i.name).filter(Boolean),
        },
      });

      recordWebhookProcessed(shopifyEventKey, 'shopify', {
        orderId,
        email: email || null,
        product: detected.product,
      });

      if (!saved.credential) {
        throw new Error('Shopify order saved but no credential generated');
      }

      const emailResult = await deliverActivationEmailAfterPurchase({
        email: saved.email,
        credential: saved.credential,
        source: 'shopify',
        eventKey: shopifyEventKey,
        emailOpts: {
          source: 'shopify',
          storeLabel: 'Shopify',
          product: detected.product,
          productName: detected.productName,
        },
      });

      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source, product: detected.product },
        emailSent: emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason,
        readiness: emailResult.readiness || null,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  router.post('/api/activation-emails/dispatch', async (req, res) => {
    const { email } = req.body || {};
    const result = await dispatchActivationEmailForEmail(email);
    res.json({
      ok: result.sent || !!result.queued,
      sent: result.sent,
      queued: !!result.queued,
      reason: result.reason || null,
    });
  });

  router.post('/api/activation-emails/process', async (req, res) => {
    if (!isAdminAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const results = await processPendingActivationEmails(20);
    res.json({ ok: true, processed: results.length, results });
  });

  router.post('/api/licenses/issue', async (req, res) => {
    if (!isAdminAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
      const body = req.body || {};
      // Admin may only issue paid Pro credentials — never free-tier "licenses"
      const source = String(body.source || 'admin').toLowerCase();
      const plan = 'pro';
      const product = body.product || 'stemsplit_pro';
      if (plan !== 'pro' && product !== 'stemsplit_pro') {
        return res.status(400).json({ ok: false, error: 'Only Pro licenses may be issued' });
      }
      const saved = upsertLicense({
        ...body,
        source: source === 'free' || source === 'download' ? 'admin' : source,
        plan: 'pro',
        product: 'stemsplit_pro',
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
      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: !!emailResult.sent,
        emailQueued: !!emailResult.queued,
        emailError: emailResult.sent ? null : emailResult.reason || null,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  router.get('/api/licenses/admin/list', (req, res) => {
    if (!isAdminAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    res.json({ ok: true, licenses: listLicensesSafe() });
  });

  startActivationEmailWorker();
  return router;
}