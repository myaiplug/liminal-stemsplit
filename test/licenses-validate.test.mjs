import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PRO_ID, DEMO_ID, PRO_KEY, fakeGumroad, startApp } from './helpers.mjs';
import { verifyLiminalProKey } from '../lib/gumroad-license.js';
import { upsertLicense } from '../lib/billing-store.js';

const purchases = {
  [`${PRO_ID}|${PRO_KEY}`]: { email: 'buyer@example.com', sale_timestamp: '2026-10-07T12:00:00Z' },
  [`${DEMO_ID}|DEMO1111-DEMO2222-DEMO3333-DEMO4444`]: { email: 'free@example.com' },
};
let gumroadMode = null;
const app = await startApp({
  verifyProKey: (email, key) =>
    verifyLiminalProKey(email, key, { env: {}, fetchImpl: fakeGumroad(purchases, { failWith: gumroadMode }).fetchImpl }),
});
after(() => app.close());

test('LiminalPro buyer unknown to the hosted DB activates via Gumroad fallback', async () => {
  const r = await app.post('/api/licenses/validate', { email: 'Buyer@example.com', licenseKey: PRO_KEY });
  assert.equal(r.status, 200);
  assert.equal(r.body.valid, true);
  assert.equal(r.body.recognized, true);
  assert.equal(r.body.plan, 'pro');
  assert.equal(r.body.email, 'buyer@example.com');
  assert.equal(r.body.purchase_date, '2026-10-07T12:00:00Z');
});

test('free-demo key does not grant Pro', async () => {
  const r = await app.post('/api/licenses/validate', {
    email: 'free@example.com',
    licenseKey: 'DEMO1111-DEMO2222-DEMO3333-DEMO4444',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.valid, false);
  assert.equal(r.body.recognized, false);
});

test('wrong email for a real Pro key => recognized + invalid (app stops, shows error)', async () => {
  const r = await app.post('/api/licenses/validate', { email: 'thief@example.com', licenseKey: PRO_KEY });
  assert.equal(r.body.valid, false);
  assert.equal(r.body.recognized, true);
  assert.match(r.body.error, /Email does not match/);
});

test('unknown email + random key keeps legacy response', async () => {
  const r = await app.post('/api/licenses/validate', { email: 'nobody@example.com', licenseKey: 'not-a-key' });
  assert.deepEqual(r.body, { recognized: false, valid: false, error: 'No hosted license found for this email' });
});

test('hosted DB credentials still work exactly as before', async () => {
  upsertLicense({ email: 'stripe@example.com', source: 'stripe', plan: 'pro', credential: 'hosted-pass-123' });
  const ok = await app.post('/api/licenses/validate', { email: 'stripe@example.com', licenseKey: 'hosted-pass-123' });
  assert.equal(ok.body.valid, true);
  const bad = await app.post('/api/licenses/validate', { email: 'stripe@example.com', licenseKey: 'wrong' });
  assert.equal(bad.body.valid, false);
  assert.equal(bad.body.recognized, true);
});

test('Gumroad outage => 503 so installed apps keep cached access instead of revoking', async () => {
  gumroadMode = 'network';
  try {
    const r = await app.post('/api/licenses/validate', { email: 'buyer@example.com', licenseKey: PRO_KEY });
    assert.equal(r.status, 503);
    assert.equal(r.body.valid, false);
  } finally {
    gumroadMode = null;
  }
});
