import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_VST_ENTITLEMENTS, productToEntitlement } from './vst-products.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(process.env.BILLING_DB_PATH || resolve(rootDir, '../data/licenses.json'));
const maxTrackedWebhookEvents = Number(process.env.MAX_TRACKED_WEBHOOK_EVENTS || 20000);

function ensureDb() {
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, JSON.stringify({ licenses: [], webhookEvents: [] }, null, 2));
  }
}

export function loadDb() {
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
  db.webhookEvents.sort((a, b) => Date.parse(a.processedAt || 0) - Date.parse(b.processedAt || 0));
  db.webhookEvents = db.webhookEvents.slice(db.webhookEvents.length - maxTrackedWebhookEvents);
}

export function wasWebhookProcessed(eventKey) {
  const db = loadDb();
  return db.webhookEvents.some((entry) => entry?.key === eventKey);
}

export function recordWebhookProcessed(eventKey, source, metadata = {}) {
  const db = loadDb();
  if (db.webhookEvents.some((entry) => entry?.key === eventKey)) return;
  db.webhookEvents.push({ key: eventKey, source, processedAt: new Date().toISOString(), metadata });
  trimWebhookEvents(db);
  saveDb(db);
}

function sha256(value) {
  return createHmac('sha256', 'stemsplit-billing').update(value).digest('hex');
}

function generateAccessPassword() {
  return randomBytes(12).toString('base64url');
}

function mergeEntitlements(existing = [], product) {
  const entitlement = productToEntitlement(product);
  if (entitlement === 'all') return [...ALL_VST_ENTITLEMENTS];
  if (!entitlement) return [...existing];
  return existing.includes(entitlement) ? [...existing] : [...existing, entitlement];
}

const PAID_SOURCES = new Set(['stripe', 'gumroad', 'shopify', 'admin', 'managed_pro', 'remote']);

export function upsertLicense({
  email,
  source,
  plan = 'pro',
  credential,
  purchaseDate,
  gumroadLicenseKey = null,
  metadata = {},
  product = metadata?.product || 'stemsplit_pro',
}) {
  const db = loadDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');

  const normalizedSource = String(source || '').trim().toLowerCase();
  // Free download / free signup must never create a Pro license record
  if (['free', 'download', 'lead', 'signup', 'welcome', 'onboarding', 'trial'].includes(normalizedSource)) {
    throw new Error(
      `Refused to issue license for free/download source "${source}". Free users do not get Pro keys.`,
    );
  }

  const now = new Date().toISOString();
  const existingIndex = db.licenses.findIndex((entry) => entry.email === normalizedEmail);
  const existing = existingIndex >= 0 ? db.licenses[existingIndex] : null;
  let credentialValue = credential || null;
  let credentialHash = existing?.credentialHash;
  if (credentialValue) {
    credentialHash = sha256(`${normalizedEmail}::${credentialValue}`);
  } else if (!credentialHash) {
    // Only auto-generate credentials for known paid/admin sources
    if (!PAID_SOURCES.has(normalizedSource) && !gumroadLicenseKey) {
      throw new Error(`Cannot generate Pro credential for untrusted source "${source}"`);
    }
    credentialValue = gumroadLicenseKey || generateAccessPassword();
    credentialHash = sha256(`${normalizedEmail}::${credentialValue}`);
  }
  // Paid product always Pro; never elevate free without a paid product/plan
  const wantsPro = product === 'stemsplit_pro' || product === 'screwai_pro' || plan === 'pro' || !!gumroadLicenseKey;
  if (!wantsPro && existing?.plan !== 'pro') {
    throw new Error('Only Pro licenses can be issued via this path');
  }
  const resolvedPlan = wantsPro || existing?.plan === 'pro' ? 'pro' : 'free';
  const entitlements = mergeEntitlements(existing?.entitlements || [], product);

  const record = {
    email: normalizedEmail,
    source,
    plan: resolvedPlan,
    entitlements,
    credentialHash,
    purchaseDate: purchaseDate || existing?.purchaseDate || now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    gumroadLicenseKey: gumroadLicenseKey || existing?.gumroadLicenseKey || null,
    metadata: { ...(existing?.metadata || {}), ...metadata, product },
  };

  if (existingIndex >= 0) {
    db.licenses[existingIndex] = record;
  } else {
    db.licenses.push(record);
  }
  saveDb(db);

  return { email: normalizedEmail, plan: resolvedPlan, credential: credentialValue, source, entitlements };
}

export function lookupEntitlements(email) {
  const db = loadDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required', email: null, pro: false, entitlements: [] };
  }

  const record = db.licenses.find((entry) => entry.email === normalizedEmail);
  if (!record) {
    return { ok: true, email: normalizedEmail, pro: false, entitlements: [] };
  }

  const pro = record.plan === 'pro';
  const entitlements = pro ? [...ALL_VST_ENTITLEMENTS] : [...(record.entitlements || [])];
  return { ok: true, email: normalizedEmail, pro, entitlements };
}

export function validateCredential(email, licenseKey) {
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

export function listLicensesSafe() {
  const db = loadDb();
  return db.licenses.map((entry) => ({
    email: entry.email,
    source: entry.source,
    plan: entry.plan,
    purchaseDate: entry.purchaseDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    hasGumroadLicenseKey: !!entry.gumroadLicenseKey,
    entitlements: entry.entitlements || [],
  }));
}

export function hashPayload(value) {
  return sha256(value);
}

export function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}