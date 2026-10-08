// With GUMROAD_WEBHOOK_SECRET configured, behaviour is unchanged (secret is the auth).
process.env.KEEP_GUMROAD_SECRET = '1';
process.env.GUMROAD_WEBHOOK_SECRET = 'test-secret';
const { test, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startApp, DEMO_ID } = await import('./helpers.mjs');
const { validateCredential } = await import('../lib/billing-store.js');

const app = await startApp({
  gumroadVerify: async () => {
    throw new Error('must not be called when a secret is configured');
  },
});
after(() => app.close());

test('wrong secret => 401', async () => {
  const r = await app.post('/webhooks/gumroad?secret=nope', { email: 'a@example.com', price: '2900' }, { form: true });
  assert.equal(r.status, 401);
});

test('correct secret + paid sale => license issued without Gumroad round-trip', async () => {
  const r = await app.post(
    '/webhooks/gumroad?secret=test-secret',
    { email: 'signed@example.com', license_key: 'SIGN1111-SIGN2222-SIGN3333-SIGN4444', product_name: 'Liminal Pro', price: '2900', sale_id: 's9' },
    { form: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(validateCredential('signed@example.com', 'SIGN1111-SIGN2222-SIGN3333-SIGN4444').valid, true);
});

test('correct secret + free demo ping => ignored', async () => {
  const r = await app.post('/webhooks/gumroad?secret=test-secret', { email: 'f@example.com', product_id: DEMO_ID, price: '0' }, { form: true });
  assert.equal(r.body.reason, 'free_product');
});
