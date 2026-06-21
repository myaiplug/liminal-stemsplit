import { createHmac, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { checkoutConfigStatus, createCheckoutSession } from './stripe-checkout.js';
import { sendProActivationEmail } from './billing-email.js';
import { sendWelcomeEmail } from './email.js';
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
const billingAdminToken = process.env.BILLING_ADMIN_TOKEN || '';
const stripeSignatureToleranceSec = Number(process.env.STRIPE_SIGNATURE_TOLERANCE_SEC || 300);
const siteUrl = process.env.SITE_URL || 'https://liminal-stemsplit.onrender.com';

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
    res.json({
      ok: true,
      service: 'billing',
      checkout: checkoutConfigStatus(),
      email: { configured: !!process.env.RESEND_API_KEY },
    });
  });

  // Desktop app calls this after free signup to deliver the welcome email
  router.post('/api/onboarding', async (req, res) => {
    const { email, username, verificationCode } = req.body || {};
    if (!email || !username) {
      return res.status(400).json({ sent: false, reason: 'Missing email or username' });
    }
    const result = await sendWelcomeEmail(email, verificationCode || null);
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

      const emailResult = await sendProActivationEmail(saved.email, saved.credential);
      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailError: emailResult.sent ? null : emailResult.reason,
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
    const email = body.email || body.purchase_email || body['purchase[email]'];
    const gumroadLicenseKey = body.license_key || body['purchase[license_key]'] || null;
    const credential = body.access_password || '';
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
        credential: credential || randomUUID(),
        purchaseDate: body.sale_timestamp || new Date().toISOString(),
        gumroadLicenseKey,
        metadata: { saleId: body.sale_id || null },
      });

      recordWebhookProcessed(gumroadEventKey, 'gumroad', {
        saleId: gumroadSaleId,
        email: email || null,
      });

      const emailResult = await sendProActivationEmail(saved.email, saved.credential);
      res.json({
        ok: true,
        saved: { email: saved.email, plan: saved.plan, source: saved.source },
        emailSent: emailResult.sent,
        emailError: emailResult.sent ? null : emailResult.reason,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error) });
    }
  });

  router.post('/api/licenses/issue', (req, res) => {
    if (!isAdminAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
      const saved = upsertLicense(req.body || {});
      res.json({ ok: true, saved });
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

  return router;
}