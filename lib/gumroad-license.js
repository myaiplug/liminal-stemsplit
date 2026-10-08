/**
 * Stateless Gumroad license verification for Liminal Pro.
 *
 * Why: desktop v0.5.0 verifies keys against the FREE demo product id
 * (rQTVqaHxdUm5urq5oJKQhw==), so real Liminal Pro keys (product
 * Ojszufj7YAruxdm7ZnwJzQ==) only work if this server already knows them.
 * The server's JSON DB lives on Render's ephemeral disk, so it forgets
 * Gumroad sales on every restart/redeploy. Verifying against Gumroad here
 * lets already-installed apps activate (and re-verify) without a new release.
 */

export const DEFAULT_PRO_PRODUCT_IDS = ['Ojszufj7YAruxdm7ZnwJzQ==']; // nodaw.gumroad.com/l/LiminalPro
export const DEFAULT_FREE_PRODUCT_IDS = ['rQTVqaHxdUm5urq5oJKQhw==']; // nodaw.gumroad.com/l/Liminal (free demo)

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
// Gumroad keys look like XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX.
const GUMROAD_KEY_PATTERN = /^[A-Za-z0-9]{8}(?:-[A-Za-z0-9]{8}){3}$/;

function parseIdList(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return [...fallback];
  return String(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function proProductIds(env = process.env) {
  return parseIdList(env.GUMROAD_PRO_PRODUCT_IDS, DEFAULT_PRO_PRODUCT_IDS);
}

export function freeProductIds(env = process.env) {
  return parseIdList(env.GUMROAD_FREE_PRODUCT_IDS, DEFAULT_FREE_PRODUCT_IDS);
}

export function looksLikeGumroadKey(licenseKey) {
  return GUMROAD_KEY_PATTERN.test(String(licenseKey || '').trim());
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Low-level: ask Gumroad whether `licenseKey` belongs to `productId`.
 * Never increments the uses count.
 * @returns {Promise<{ ok: true, found: boolean, purchase: object|null, message: string|null }
 *                 | { ok: false, error: string }>}  ok:false = transient (network / 5xx / bad JSON)
 */
export async function gumroadVerifyLicense({ productId, licenseKey, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  const body = new URLSearchParams({
    product_id: productId,
    license_key: String(licenseKey || '').trim(),
    increment_uses_count: 'false',
  });

  let response;
  try {
    response = await fetchImpl(GUMROAD_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    return { ok: false, error: `Gumroad unreachable: ${error?.message || error}` };
  }

  if (response.status >= 500) {
    return { ok: false, error: `Gumroad returned status ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: 'Gumroad returned invalid JSON' };
  }

  if (payload?.success && payload.purchase) {
    return { ok: true, found: true, purchase: payload.purchase, message: null };
  }
  // 404 {"success":false,"message":"That license does not exist for the provided product."}
  return { ok: true, found: false, purchase: null, message: payload?.message || 'License not found' };
}

/** Purchase is usable for Pro: not refunded / charged back / in an open dispute, and product matches. */
export function purchaseIsActive(purchase, allowedProductIds) {
  if (!purchase) return { active: false, reason: 'No purchase' };
  if (truthy(purchase.refunded)) return { active: false, reason: 'This license has been refunded' };
  if (truthy(purchase.chargebacked)) return { active: false, reason: 'This license has been chargebacked' };
  if (truthy(purchase.disputed) && !truthy(purchase.dispute_won)) {
    return { active: false, reason: 'This purchase is disputed' };
  }
  if (purchase.product_id && allowedProductIds && !allowedProductIds.includes(purchase.product_id)) {
    return { active: false, reason: 'License belongs to a different product' };
  }
  return { active: true, reason: null };
}

/**
 * Verify an (email, licenseKey) pair against the Liminal Pro Gumroad product(s).
 * Free-demo product ids are never consulted, so demo keys can never grant Pro here.
 *
 * @returns {Promise<
 *   { status: 'valid', email: string, purchaseDate: string|null, productId: string }
 * | { status: 'rejected', error: string }       // key exists for Pro but refunded / disputed / wrong email
 * | { status: 'not_found', error: string }      // Gumroad has no such Pro key
 * | { status: 'skipped', error: string }        // not a Gumroad-shaped key / no email
 * | { status: 'unavailable', error: string }>}  // transient: Gumroad down
 */
export async function verifyLiminalProKey(email, licenseKey, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const key = String(licenseKey || '').trim();
  if (!normalizedEmail) return { status: 'skipped', error: 'Email is required' };
  if (!looksLikeGumroadKey(key)) return { status: 'skipped', error: 'Not a Gumroad license key' };

  const ids = proProductIds(env);
  let transientError = null;
  let definitiveError = null;

  for (const productId of ids) {
    const result = await gumroadVerifyLicense({ productId, licenseKey: key, fetchImpl });
    if (!result.ok) {
      transientError = result.error;
      continue;
    }
    if (!result.found) continue;

    const state = purchaseIsActive(result.purchase, ids);
    if (!state.active) {
      definitiveError = state.reason;
      continue;
    }

    const purchaseEmail = String(result.purchase.email || '').trim().toLowerCase();
    if (!purchaseEmail || purchaseEmail !== normalizedEmail) {
      definitiveError = 'Email does not match purchase email. Please use the email you used to purchase on Gumroad.';
      continue;
    }

    return {
      status: 'valid',
      email: purchaseEmail,
      purchaseDate: result.purchase.sale_timestamp || result.purchase.created_at || null,
      productId,
    };
  }

  if (definitiveError) return { status: 'rejected', error: definitiveError };
  if (transientError) return { status: 'unavailable', error: transientError };
  return { status: 'not_found', error: 'License not found for Liminal Pro' };
}
