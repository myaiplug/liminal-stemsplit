import { createClient } from '@libsql/client';

const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.BILLING_TURSO_URL || '';
const tursoToken = process.env.TURSO_AUTH_TOKEN || process.env.BILLING_TURSO_TOKEN || '';

let client = null;
let initialized = false;
let initPromise = null;

export function getDb() {
  if (!client) {
    if (!tursoUrl) {
      throw new Error('TURSO_DATABASE_URL or BILLING_TURSO_URL env var is required');
    }
    client = createClient({
      url: tursoUrl,
      authToken: tursoToken || undefined,
    });
  }
  return client;
}

export async function initDb() {
  if (initialized) return;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    const db = getDb();
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS licenses (
        email TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'pro',
        entitlements TEXT NOT NULL DEFAULT '[]',
        credential_hash TEXT,
        purchase_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        gumroad_license_key TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        key TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);
    
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at 
      ON webhook_events(processed_at)
    `);
    
    initialized = true;
    console.log('[Turso] Database initialized');
  })();
  
  return initPromise;
}

export async function wasWebhookProcessed(eventKey) {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT key FROM webhook_events WHERE key = ?',
    args: [eventKey],
  });
  return result.rows.length > 0;
}

export async function recordWebhookProcessed(eventKey, source, metadata = {}) {
  await initDb();
  const db = getDb();
  
  await db.execute({
    sql: `INSERT OR REPLACE INTO webhook_events (key, source, processed_at, metadata) 
          VALUES (?, ?, ?, ?)`,
    args: [eventKey, source, new Date().toISOString(), JSON.stringify(metadata)],
  });
  
  // Trim old events beyond max tracked
  const maxEvents = Number(process.env.MAX_TRACKED_WEBHOOK_EVENTS || 20000);
  await db.execute({
    sql: `DELETE FROM webhook_events WHERE key IN (
            SELECT key FROM webhook_events 
            ORDER BY processed_at DESC 
            LIMIT -1 OFFSET ?
          )`,
    args: [maxEvents],
  });
}

export async function findLicenseByEmail(email) {
  await initDb();
  const db = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  
  const result = await db.execute({
    sql: 'SELECT * FROM licenses WHERE email = ?',
    args: [normalizedEmail],
  });
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    email: row.email,
    source: row.source,
    plan: row.plan,
    entitlements: JSON.parse(row.entitlements || '[]'),
    credentialHash: row.credential_hash,
    purchaseDate: row.purchase_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    gumroadLicenseKey: row.gumroad_license_key,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

const PAID_SOURCES = new Set(['stripe', 'gumroad', 'shopify', 'admin', 'managed_pro', 'remote']);
const FREE_BLOCKED_SOURCES = new Set([
  'free',
  'download',
  'lead',
  'signup',
  'welcome',
  'onboarding',
  'trial',
]);

export async function upsertLicense({
  email,
  source,
  plan = 'pro',
  credential,
  purchaseDate,
  gumroadLicenseKey = null,
  metadata = {},
  product = metadata?.product || 'stemsplit_pro',
  sha256,
  generateAccessPassword,
  mergeEntitlements,
}) {
  await initDb();
  const db = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');

  const normalizedSource = String(source || '').trim().toLowerCase();
  // Free download / free signup must never create a Pro license record
  if (FREE_BLOCKED_SOURCES.has(normalizedSource)) {
    throw new Error(
      `Refused to issue license for free/download source "${source}". Free users do not get Pro keys.`,
    );
  }

  const now = new Date().toISOString();
  const existing = await findLicenseByEmail(normalizedEmail);
  
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
  const wantsPro = product === 'stemsplit_pro' || plan === 'pro' || !!gumroadLicenseKey;
  if (!wantsPro && existing?.plan !== 'pro') {
    throw new Error('Only Pro licenses can be issued via this path');
  }
  const resolvedPlan = wantsPro || existing?.plan === 'pro' ? 'pro' : 'free';
  
  const entitlements = mergeEntitlements(existing?.entitlements || [], product);
  const mergedMetadata = { ...(existing?.metadata || {}), ...metadata, product };

  await db.execute({
    sql: `INSERT OR REPLACE INTO licenses 
          (email, source, plan, entitlements, credential_hash, purchase_date, 
           created_at, updated_at, gumroad_license_key, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      normalizedEmail,
      source,
      resolvedPlan,
      JSON.stringify(entitlements),
      credentialHash,
      purchaseDate || existing?.purchaseDate || now,
      existing?.createdAt || now,
      now,
      gumroadLicenseKey || existing?.gumroadLicenseKey || null,
      JSON.stringify(mergedMetadata),
    ],
  });

  return {
    email: normalizedEmail,
    plan: resolvedPlan,
    credential: credentialValue,
    source,
    entitlements,
  };
}

export async function listLicenses() {
  await initDb();
  const db = getDb();
  const result = await db.execute('SELECT * FROM licenses ORDER BY created_at DESC');
  
  return result.rows.map((row) => ({
    email: row.email,
    source: row.source,
    plan: row.plan,
    purchaseDate: row.purchase_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasGumroadLicenseKey: !!row.gumroad_license_key,
  }));
}

export function isTursoConfigured() {
  return !!tursoUrl;
}
