// Stripe / Shopify buyers keep Pro after the ephemeral DB is wiped (Render restart).
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_derived';
process.env.SHOPIFY_WEBHOOK_SECRET = 'shpss_test_derived';
const { createHmac } = await import('node:crypto');
const { rmSync } = await import('node:fs');
const { test, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startApp, DB_PATH } = await import('./helpers.mjs');
const { deriveLicenseCredential } = await import('../lib/license-signing.js');
const { upsertLicense } = await import('../lib/billing-store.js');

const app = await startApp({ verifyProKey: async () => ({ status: 'not_found', error: 'x' }) });
after(() => app.close());
const wipeDb = () => rmSync(DB_PATH, { force: true });

function stripeEvent(email, id, metadata = {}) {
  const raw = JSON.stringify({
    id,
    type: 'checkout.session.completed',
    data: { object: { id: `cs_${id}`, customer_details: { email }, metadata } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return { raw, headers: { 'stripe-signature': `t=${t},v1=${v1}` } };
}

function shopifyOrder(email, id, title = 'Liminal Pro') {
  const raw = JSON.stringify({ id, email, financial_status: 'paid', line_items: [{ title }] });
  const hmac = createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(raw).digest('base64');
  return { raw, headers: { 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': 'orders/paid' } };
}

const validate = (email, licenseKey) => app.post('/api/licenses/validate', { email, licenseKey });

test('/billing/health reports signing enabled', async () => {
  const res = await fetch(`${app.base}/billing/health`).then((r) => r.json());
  assert.equal(res.licenseSigning.enabled, true);
  assert.equal(res.licenseSigning.keys, 2);
});

test('Stripe buyer: issued credential is derived and survives a DB wipe', async () => {
  const { raw, headers } = stripeEvent('Stripe.Buyer@example.com', 'evt_1');
  const r = await app.post('/webhooks/stripe', null, { raw, headers });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const expected = deriveLicenseCredential('stripe.buyer@example.com', 'stemsplit_pro');
  assert.match(expected, /^LMNL-/);
  assert.equal((await validate('stripe.buyer@example.com', expected)).body.valid, true);

  wipeDb();
  const after = await validate('stripe.buyer@example.com', expected);
  assert.equal(after.body.valid, true);
  assert.equal(after.body.plan, 'pro');
  assert.equal(after.body.source, 'derived_credential');
  const wrongEmail = await validate('someone@example.com', expected);
  assert.equal(wrongEmail.body.valid, false);
});

test('Shopify buyer: derived credential survives a DB wipe', async () => {
  const { raw, headers } = shopifyOrder('shop.buyer@example.com', 5001);
  const r = await app.post('/webhooks/shopify', null, { raw, headers });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  wipeDb();
  const v = await validate('shop.buyer@example.com', deriveLicenseCredential('shop.buyer@example.com', 'stemsplit_pro'));
  assert.equal(v.body.valid, true);
  assert.equal(v.body.plan, 'pro');
});

test('VST-only product credential validates as VST, not Pro', async () => {
  wipeDb();
  const c = deriveLicenseCredential('vst@example.com', 'vst_reverb_degloss');
  const v = await validate('vst@example.com', c);
  assert.equal(v.body.valid, true);
  assert.equal(v.body.plan, 'vst');
  assert.deepEqual(v.body.entitlements, ['reverb_degloss']);
});

test('explicit / legacy credentials still validate from the DB and are not overwritten', async () => {
  upsertLicense({ email: 'legacy@example.com', source: 'stripe', credential: 'legacy-pass-1' });
  // A later purchase without a credential must not invalidate the stored one.
  const saved = upsertLicense({ email: 'legacy@example.com', source: 'stripe', product: 'stemsplit_pro' });
  assert.match(saved.credential, /^LMNL-/);
  assert.equal((await validate('legacy@example.com', 'legacy-pass-1')).body.valid, true);
  assert.equal((await validate('legacy@example.com', saved.credential)).body.valid, true);
  assert.equal((await validate('legacy@example.com', 'wrong')).body.recognized, true);
  assert.equal((await validate('legacy@example.com', 'wrong')).body.valid, false);
});

test('free/untrusted sources still cannot get credentials', () => {
  assert.throws(() => upsertLicense({ email: 'free@example.com', source: 'free' }), /Refused/);
  assert.throws(() => upsertLicense({ email: 'x@example.com', source: 'mystery' }), /untrusted source/);
});

test('unsigned Stripe/Shopify webhooks are still rejected', async () => {
  assert.equal((await app.post('/webhooks/stripe', {})).status, 401);
  assert.equal((await app.post('/webhooks/shopify', { financial_status: 'paid' })).status, 401);
});
