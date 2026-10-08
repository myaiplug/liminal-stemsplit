import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must run before lib/billing-store.js is imported (it reads env at import time).
const dir = mkdtempSync(join(tmpdir(), 'liminal-billing-test-'));
process.env.BILLING_DB_PATH = join(dir, 'licenses.json');
process.env.ACTIVATION_EMAIL_QUEUE_PATH = join(dir, 'activation-email-queue.json');
delete process.env.RESEND_API_KEY;
delete process.env.GMAIL_APP_PASSWORD;
// Email is unconfigured in tests; make the activation-email path give up fast.
process.env.ACTIVATION_EMAIL_WEBHOOK_WAIT_MS = '1';
process.env.ACTIVATION_EMAIL_WARMUP_TIMEOUT_MS = '1';
process.env.ACTIVATION_EMAIL_MIN_WARMUP_MS = '0';
process.env.ACTIVATION_EMAIL_SEND_ATTEMPTS = '1';
if (!process.env.KEEP_GUMROAD_SECRET) delete process.env.GUMROAD_WEBHOOK_SECRET;

export const DB_PATH = process.env.BILLING_DB_PATH;

export const PRO_ID = 'Ojszufj7YAruxdm7ZnwJzQ==';
export const DEMO_ID = 'rQTVqaHxdUm5urq5oJKQhw==';
export const PRO_KEY = 'AAAA1111-BBBB2222-CCCC3333-DDDD4444';

/**
 * Fake Gumroad /v2/licenses/verify. `licenses` maps `${productId}|${key}` -> purchase.
 * Records calls so tests can assert which product ids were consulted.
 */
export function fakeGumroad(licenses = {}, { failWith = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const params = new URLSearchParams(String(init.body));
    const productId = params.get('product_id');
    const key = params.get('license_key');
    calls.push({ url, productId, key, increment: params.get('increment_uses_count') });
    if (failWith === 'network') throw new Error('ECONNRESET');
    if (failWith === '502') return { status: 502, json: async () => ({}) };
    const purchase = licenses[`${productId}|${key}`];
    if (!purchase) {
      return {
        status: 404,
        json: async () => ({ success: false, message: 'That license does not exist for the provided product.' }),
      };
    }
    return { status: 200, json: async () => ({ success: true, uses: 0, purchase: { product_id: productId, ...purchase } }) };
  };
  return { fetchImpl, calls };
}

export async function startApp(routerOptions) {
  const express = (await import('express')).default;
  const { createBillingRouter } = await import('../lib/billing-routes.js');
  const app = express();
  // Mirror server.js: Stripe + Shopify need the raw body for signature checks.
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use('/webhooks/shopify', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(createBillingRouter({ startWorker: false, ...routerOptions }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
    post: async (path, body, { form = false, headers = {}, raw = null } = {}) => {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
        body: raw ?? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)),
      });
      return { status: res.status, body: await res.json() };
    },
  };
}
