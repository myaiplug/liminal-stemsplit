// With no signing secret configured, behaviour is exactly the legacy random-password path.
for (const k of ['LICENSE_SIGNING_SECRET', 'STRIPE_WEBHOOK_SECRET', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_API_SECRET', 'BILLING_ADMIN_TOKEN']) {
  delete process.env[k];
}
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
await import('./helpers.mjs');
const { upsertLicense, validateCredential } = await import('../lib/billing-store.js');

test('falls back to random hosted password when no secret is configured', () => {
  const saved = upsertLicense({ email: 'r@example.com', source: 'stripe' });
  assert.ok(saved.credential);
  assert.doesNotMatch(saved.credential, /^LMNL-/);
  assert.equal(validateCredential('r@example.com', saved.credential).valid, true);
  assert.equal(validateCredential('r@example.com', 'LMNL-0000-0000-0000-0000-0000').valid, false);
});
