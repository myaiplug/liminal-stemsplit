import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SHOPIFY_WEBHOOK_SECRET = 'shopify-test-secret';
delete process.env.SHOPIFY_PRODUCT_NEEDLE;
const { detectShopifyProduct } = await import('../lib/shopify-product.js');
const { startApp } = await import('./helpers.mjs');
const { lookupEntitlements } = await import('../lib/billing-store.js');

const order = (...items) => ({ id: 1, line_items: items });

test('HalfScrew products never match, in any spelling (incl. the "HALFSREW" SKU typo)', () => {
  for (const item of [
    { title: 'HalfScrew Unlimited', sku: 'HALFSREW-UNLIMITED' },
    { title: 'HalfScrew™' },
    { title: 'Half Screw Pro' },
    { title: 'x', sku: 'halfscrew-pro' },
    { name: 'HALF-SCREW - Pro license' },
  ]) {
    assert.deepEqual(detectShopifyProduct(order(item)), { isMatch: false, product: null, productName: null }, JSON.stringify(item));
  }
});

test('real ScrewAI Pro orders still match screwai_pro', () => {
  for (const item of [
    { title: 'ScrewAI Pro', sku: 'SCREWAI-PRO' },
    { title: 'ScrewAI PRO (Code\u2019ine Processor)' },
    { title: 'Screw Pro' },
    { title: 'x', sku: 'SCREW-PRO' },
    { title: 'screwai' },
  ]) {
    const d = detectShopifyProduct(order(item));
    assert.equal(d.isMatch, true, JSON.stringify(item));
    assert.equal(d.product, 'screwai_pro', JSON.stringify(item));
  }
});

test('"screw" inside another word no longer means ScrewAI', () => {
  assert.notEqual(detectShopifyProduct(order({ title: 'Corkscrew Sample Pack' })).product, 'screwai_pro');
});

test('mixed cart: the HalfScrew line is skipped and the ScrewAI line still wins', () => {
  const d = detectShopifyProduct(order({ title: 'HalfScrew Unlimited', sku: 'HALFSREW-UNLIMITED' }, { title: 'ScrewAI Pro' }));
  assert.equal(d.product, 'screwai_pro');
  assert.equal(d.productName, 'ScrewAI Pro');
});

test('other products are unchanged', () => {
  assert.equal(detectShopifyProduct(order({ title: 'CoProducer PRO' })).product, 'coproducer_pro');
  assert.equal(detectShopifyProduct(order({ title: 'ReVerb-DeGloss' })).product, 'vst_reverb_degloss');
  assert.equal(detectShopifyProduct(order({ title: 'Liminal StemSplit Pro' })).product, 'stemsplit_pro');
  assert.equal(detectShopifyProduct(order({ title: 'Unrelated sticker' })).isMatch, false);
});

test('a HalfScrew-only order is not rescued by a custom SHOPIFY_PRODUCT_NEEDLE', () => {
  process.env.SHOPIFY_PRODUCT_NEEDLE = 'screw|unlimited';
  try {
    assert.equal(detectShopifyProduct(order({ title: 'HalfScrew Unlimited' })).isMatch, false);
  } finally {
    delete process.env.SHOPIFY_PRODUCT_NEEDLE;
  }
});

test('webhook end-to-end: signed paid HalfScrew order is ignored and issues no license', async () => {
  const app = await startApp({});
  try {
    const raw = JSON.stringify({ id: 777001, email: 'halfscrew-buyer@example.com', financial_status: 'paid', line_items: [{ title: 'HalfScrew Unlimited', sku: 'HALFSREW-UNLIMITED' }] });
    const hmac = createHmac('sha256', 'shopify-test-secret').update(raw).digest('base64');
    const r = await app.post('/webhooks/shopify', null, { raw, headers: { 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': 'orders/paid' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ignored, true);
    assert.equal(r.body.reason, 'no_matching_line_item');
    assert.equal(lookupEntitlements('halfscrew-buyer@example.com')?.entitlements?.length || 0, 0);
  } finally {
    await app.close();
  }
});
