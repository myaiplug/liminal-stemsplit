import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 8787);
const dbPath = resolve(process.env.BILLING_DB_PATH || './billing-service/data/licenses.json');
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const gumroadWebhookSecret = process.env.GUMROAD_WEBHOOK_SECRET || '';
const billingAdminToken = process.env.BILLING_ADMIN_TOKEN || '';
const maxTrackedWebhookEvents = Number(process.env.MAX_TRACKED_WEBHOOK_EVENTS || 20000);
const stripeSignatureToleranceSec = Number(process.env.STRIPE_SIGNATURE_TOLERANCE_SEC || 300);

function ensureDb() {
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, JSON.stringify({ licenses: [], webhookEvents: [] }, null, 2));
  }
}

function loadDb() {
  ensureDb();
  const parsed = JSON.parse(readFileSync(dbPath, 'utf8'));
  if (!Array.isArray(parsed.licenses)) parsed.licenses = [];
  if (!Array.isArray(parsed.webhookEvents)) parsed.webhookEvents = [];
  return parsed;
}

function saveDb(db) {
  ensureDb();
  if (!Array.isArray(db.licenses)) db.licenses = [];
  if (!Array.isArray(db.webhookEvents)) db.webhookEvents = [];
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function trimWebhookEvents(db) {
  if (!Array.isArray(db.webhookEvents)) db.webhookEvents = [];
  if (db.webhookEvents.length <= maxTrackedWebhookEvents) return;

  db.webhookEvents.sort((a, b) => {
    const at = Date.parse(a.processedAt || 0);
    const bt = Date.parse(b.processedAt || 0);
    return at - bt;
  });
  db.webhookEvents = db.webhookEvents.slice(db.webhookEvents.length - maxTrackedWebhookEvents);
}

function wasWebhookProcessed(eventKey) {
  const db = loadDb();
  return db.webhookEvents.some((entry) => entry?.key === eventKey);
}

function recordWebhookProcessed(eventKey, source, metadata = {}) {
  const db = loadDb();
  if (db.webhookEvents.some((entry) => entry?.key === eventKey)) {
    return;
  }

  db.webhookEvents.push({
    key: eventKey,
    source,
    processedAt: new Date().toISOString(),
    metadata,
  });
  trimWebhookEvents(db);
  saveDb(db);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
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

function upsertLicense({ email, source, plan = 'pro', credential, purchaseDate, gumroadLicenseKey = null, metadata = {} }) {
  const db = loadDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');

  const now = new Date().toISOString();
  const credentialValue = credential || generateAccessPassword();
  const record = {
    email: normalizedEmail,
    source,
    plan,
    credentialHash: sha256(`${normalizedEmail}::${credentialValue}`),
    purchaseDate: purchaseDate || now,
    createdAt: now,
    updatedAt: now,
    gumroadLicenseKey,
    metadata,
  };

  const existingIndex = db.licenses.findIndex((entry) => entry.email === normalizedEmail);
  if (existingIndex >= 0) {
    db.licenses[existingIndex] = {
      ...db.licenses[existingIndex],
      ...record,
      createdAt: db.licenses[existingIndex].createdAt || now,
    };
  } else {
    db.licenses.push(record);
  }
  saveDb(db);

  return {
    email: normalizedEmail,
    plan,
    credential: credentialValue,
    source,
  };
}

function validateCredential(email, licenseKey) {
  const db = loadDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const record = db.licenses.find((entry) => entry.email === normalizedEmail);
  if (!record) {
    return { recognized: false, valid: false, error: 'No hosted license found for this email' };
  }

  const hashed = sha256(`${normalizedEmail}::${licenseKey}`);
  const licenseMatch = record.gumroadLicenseKey && record.gumroadLicenseKey === licenseKey;
  const credentialMatch = hashed === record.credentialHash;

  if (!licenseMatch && !credentialMatch) {
    return { recognized: true, valid: false, error: 'Hosted access credential is invalid' };
  }

  return {
    recognized: true,
    valid: true,
    email: record.email,
    purchase_date: record.purchaseDate,
    plan: record.plan,
    features: ['all'],
    error: null,
  };
}

function listLicensesSafe() {
  const db = loadDb();
  return db.licenses.map((entry) => ({
    email: entry.email,
    source: entry.source,
    plan: entry.plan,
    purchaseDate: entry.purchaseDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    hasGumroadLicenseKey: !!entry.gumroadLicenseKey,
  }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'billing-webhooks' });
  }

  if (req.method === 'POST' && url.pathname === '/api/licenses/validate') {
    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody);
    if (!body) return sendJson(res, 400, { recognized: false, valid: false, error: 'Invalid JSON payload' });
    return sendJson(res, 200, validateCredential(body.email, body.licenseKey));
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
    if (wasWebhookProcessed(stripeEventKey)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    const session = event.data?.object || {};
    const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
    const plan = session.metadata?.plan || 'pro';
    const credential = session.metadata?.access_password || '';
    try {
      const saved = upsertLicense({
        email,
        source: 'stripe',
        plan,
        credential,
        purchaseDate: new Date().toISOString(),
        metadata: { sessionId: session.id || null },
      });

      recordWebhookProcessed(stripeEventKey, 'stripe', {
        eventId: event.id || null,
        sessionId: session.id || null,
        email: email || null,
      });

      return sendJson(res, 200, { ok: true, saved });
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

    const email = body.email || body.purchase_email || body['purchase[email]'];
    const gumroadLicenseKey = body.license_key || body['purchase[license_key]'] || null;
    const credential = body.access_password || '';
    const gumroadSaleId = body.sale_id || body['sale[id]'] || body.order_id || null;
    const gumroadEventKey = gumroadSaleId
      ? `gumroad:sale:${gumroadSaleId}`
      : `gumroad:raw:${sha256(rawBody.toString('utf8'))}`;
    if (wasWebhookProcessed(gumroadEventKey)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    try {
      const saved = upsertLicense({
        email,
        source: 'gumroad',
        plan: body.plan || 'pro',
        credential,
        purchaseDate: body.sale_timestamp || new Date().toISOString(),
        gumroadLicenseKey,
        metadata: { saleId: body.sale_id || null },
      });

      recordWebhookProcessed(gumroadEventKey, 'gumroad', {
        saleId: gumroadSaleId,
        email: email || null,
      });

      return sendJson(res, 200, { ok: true, saved });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/licenses/issue') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }

    const rawBody = await readBody(req);
    const body = tryParseJson(rawBody);
    if (!body) return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
    try {
      const saved = upsertLicense(body);
      return sendJson(res, 200, { ok: true, saved });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/licenses/admin/list') {
    if (!isAdminAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }
    return sendJson(res, 200, { ok: true, licenses: listLicensesSafe() });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(port, () => {
  ensureDb();
  console.log(`StemSplit billing webhook service listening on http://localhost:${port}`);
  console.log(`DB: ${dbPath}`);
  if (!billingAdminToken) {
    console.warn('WARNING: BILLING_ADMIN_TOKEN is not set. Admin endpoints are disabled.');
  }
});
