/**
 * Stateless hosted credentials ("derived licenses").
 *
 * The hosted license DB (data/licenses.json) lives on Render's ephemeral disk
 * and is wiped on every restart/redeploy, which silently revoked Stripe/Shopify
 * buyers at the desktop app's 7-day re-check. Hosted credentials are now an
 * HMAC of (email, product) under a server secret, so /api/licenses/validate can
 * verify them with no stored state.
 *
 * Key material (first configured one signs new credentials; ALL configured ones
 * are accepted when verifying, so adding LICENSE_SIGNING_SECRET later does not
 * break credentials issued earlier):
 *   LICENSE_SIGNING_SECRET (dedicated, recommended)
 *   STRIPE_WEBHOOK_SECRET, SHOPIFY_WEBHOOK_SECRET, SHOPIFY_API_SECRET, BILLING_ADMIN_TOKEN
 * Each is domain-separated via HMAC(secret, LABEL), so the raw secret is never
 * used directly. Anyone holding one of these secrets could already mint a
 * license (forge that webhook / call the admin issue endpoint), so this grants
 * no new capability. Rotating every listed secret invalidates derived credentials.
 * With none configured the feature is off and random passwords are used as before.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const KEY_ENV_VARS = [
  'LICENSE_SIGNING_SECRET',
  'STRIPE_WEBHOOK_SECRET',
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_API_SECRET',
  'BILLING_ADMIN_TOKEN',
];
const LABEL = 'liminal-hosted-license-v1';

export const PRODUCT_CODES = {
  stemsplit_pro: 'LMNL',
  screwai_pro: 'SCRW',
  coproducer_pro: 'COPR',
  vst_reverb_degloss: 'RVDG',
};
const CODE_TO_PRODUCT = Object.fromEntries(Object.entries(PRODUCT_CODES).map(([p, c]) => [c, p]));
// e.g. LMNL-1A2B-3C4D-5E6F-7A8B-9C0D  (80-bit HMAC tag)
const CREDENTIAL_PATTERN = /^([A-Z]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})$/;

function derivedKeys(env) {
  const seen = new Set();
  const keys = [];
  for (const name of KEY_ENV_VARS) {
    const value = String(env[name] || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    keys.push(createHmac('sha256', value).update(LABEL).digest());
  }
  return keys;
}

export function licenseSigningStatus(env = process.env) {
  const count = derivedKeys(env).length;
  return { enabled: count > 0, keys: count, dedicated: !!String(env.LICENSE_SIGNING_SECRET || '').trim() };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function tag(key, email, product) {
  return createHmac('sha256', key).update(`${normalizeEmail(email)}\n${product}`).digest('hex').slice(0, 20).toUpperCase();
}

function format(code, hex) {
  return `${code}-${hex.match(/.{4}/g).join('-')}`;
}

/** Returns a deterministic credential for (email, product), or null if signing is unavailable. */
export function deriveLicenseCredential(email, product = 'stemsplit_pro', env = process.env) {
  const code = PRODUCT_CODES[product];
  const normalized = normalizeEmail(email);
  if (!code || !normalized) return null;
  const [key] = derivedKeys(env);
  if (!key) return null;
  return format(code, tag(key, normalized, product));
}

export function looksLikeDerivedCredential(credential) {
  return CREDENTIAL_PATTERN.test(String(credential || '').trim().toUpperCase());
}

/** Verify a derived credential. Returns { valid: true, product } or { valid: false }. */
export function verifyDerivedCredential(email, credential, env = process.env) {
  const normalized = normalizeEmail(email);
  const match = CREDENTIAL_PATTERN.exec(String(credential || '').trim().toUpperCase());
  if (!normalized || !match) return { valid: false };
  const product = CODE_TO_PRODUCT[match[1]];
  if (!product) return { valid: false };
  const given = Buffer.from(match.slice(2).join(''), 'utf8');
  for (const key of derivedKeys(env)) {
    const expected = Buffer.from(tag(key, normalized, product), 'utf8');
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return { valid: true, product };
    }
  }
  return { valid: false };
}
