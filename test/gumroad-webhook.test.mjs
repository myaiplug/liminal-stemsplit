// Production today: GUMROAD_WEBHOOK_SECRET is NOT set (unsigned pings were accepted).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PRO_ID, DEMO_ID, PRO_KEY, fakeGumroad, startApp } from './helpers.mjs';
import { gumroadVerifyLicense } from '../lib/gumroad-license.js';
import { validateCredential } from '../lib/billing-store.js';

const purchases = {
  [`${PRO_ID}|${PRO_KEY}`]: { email: 'buyer@example.com', sale_id: 'sale_123', sale_timestamp: '2026-10-07T12:00:00Z' },
};
const app = await startApp({
  verifyProKey: async () => ({ status: 'not_found', error: 'x' }), // isolate webhook behaviour
  gumroadVerify: (args) => gumroadVerifyLicense({ ...args, fetchImpl: fakeGumroad(purchases).fetchImpl }),
});
after(() => app.close());

test('forged unsigned ping with a made-up key is rejected and creates no license', async () => {
  const r = await app.post(
    '/webhooks/gumroad',
    { email: 'attacker@example.com', license_key: 'FAKE1111-FAKE2222-FAKE3333-FAKE4444', product_id: PRO_ID, price: '2900', sale_id: 'x1' },
    { form: true },
  );
  assert.equal(r.status, 401);
  assert.equal(validateCredential('attacker@example.com', 'FAKE1111-FAKE2222-FAKE3333-FAKE4444').recognized, false);
});

test('forged unsigned ping without license_key is rejected', async () => {
  const r = await app.post('/webhooks/gumroad', { email: 'attacker2@example.com', product_name: 'Liminal Pro', price: '2900' }, { form: true });
  assert.equal(r.status, 401);
  assert.equal(validateCredential('attacker2@example.com', 'anything').recognized, false);
});

test('real key replayed with another email is rejected', async () => {
  const r = await app.post(
    '/webhooks/gumroad',
    { email: 'attacker@example.com', license_key: PRO_KEY, product_id: PRO_ID, price: '2900', sale_id: 'sale_123' },
    { form: true },
  );
  assert.equal(r.status, 401);
});

test('free demo ping (product id or $0) never mints Pro', async () => {
  for (const body of [
    { email: 'free1@example.com', product_id: DEMO_ID, price: '500', product_name: 'Liminal - AI Stem Splitter (Free Demo)' },
    { email: 'free2@example.com', product_id: 'otherFreeId==', price: '0', product_name: 'ScrewAI Desktop' },
  ]) {
    const r = await app.post('/webhooks/gumroad', body, { form: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.ignored, true);
    assert.equal(r.body.reason, 'free_product');
    assert.equal(validateCredential(body.email, 'x').recognized, false);
  }
});

test('genuine unsigned LiminalPro sale ping (Gumroad-confirmed) still issues the license', async () => {
  const r = await app.post(
    '/webhooks/gumroad',
    {
      email: 'Buyer@example.com',
      license_key: PRO_KEY,
      product_id: PRO_ID,
      product_name: 'Liminal Pro - Unlimited AI Stem Separation',
      price: '2900',
      sale_id: 'sale_123',
      refunded: 'false',
    },
    { form: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.saved.plan, 'pro');
  const v = validateCredential('buyer@example.com', PRO_KEY);
  assert.equal(v.valid, true);
});
