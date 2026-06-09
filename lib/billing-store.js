import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(process.env.BILLING_DB_PATH || resolve(rootDir, '../data/licenses.json'));
const maxTrackedWebhookEvents = Number(process.env.MAX_TRACKED_WEBHOOK_EVENTS || 20000);

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

export function upsertLicense({
  email,
  source,
  plan = 'pro',
  credential,
  purchaseDate,
  gumroadLicenseKey = null,
  metadata = {},
}) {
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

  return { email: normalizedEmail, plan, credential: credentialValue, source };
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