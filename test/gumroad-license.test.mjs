import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ID, PRO_ID, PRO_KEY, fakeGumroad } from './helpers.mjs';
import { looksLikeGumroadKey, proProductIds, verifyLiminalProKey } from '../lib/gumroad-license.js';

const buyer = { email: 'Buyer@Example.com', sale_timestamp: '2026-10-07T12:00:00Z', refunded: false, chargebacked: false };

test('defaults to the LiminalPro product id only (never the free demo)', () => {
  assert.deepEqual(proProductIds({}), [PRO_ID]);
  assert.ok(!proProductIds({}).includes(DEMO_ID));
  assert.deepEqual(proProductIds({ GUMROAD_PRO_PRODUCT_IDS: ' a==, b== ' }), ['a==', 'b==']);
});

test('key shape check', () => {
  assert.ok(looksLikeGumroadKey(PRO_KEY));
  assert.ok(looksLikeGumroadKey(` ${PRO_KEY} `));
  assert.ok(!looksLikeGumroadKey('Zx9_hosted-password'));
  assert.ok(!looksLikeGumroadKey(''));
});

test('valid LiminalPro key + matching email (case-insensitive) => valid', async () => {
  const g = fakeGumroad({ [`${PRO_ID}|${PRO_KEY}`]: buyer });
  const r = await verifyLiminalProKey(' buyer@example.COM ', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl });
  assert.equal(r.status, 'valid');
  assert.equal(r.email, 'buyer@example.com');
  assert.equal(r.purchaseDate, '2026-10-07T12:00:00Z');
  assert.equal(g.calls.length, 1);
  assert.equal(g.calls[0].productId, PRO_ID);
  assert.equal(g.calls[0].increment, 'false');
});

test('free-demo key is never accepted (demo product is not consulted)', async () => {
  const g = fakeGumroad({ [`${DEMO_ID}|${PRO_KEY}`]: buyer });
  const r = await verifyLiminalProKey('buyer@example.com', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl });
  assert.equal(r.status, 'not_found');
  assert.ok(g.calls.every((c) => c.productId !== DEMO_ID));
});

test('email mismatch => rejected', async () => {
  const g = fakeGumroad({ [`${PRO_ID}|${PRO_KEY}`]: buyer });
  const r = await verifyLiminalProKey('someone-else@example.com', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl });
  assert.equal(r.status, 'rejected');
  assert.match(r.error, /Email does not match/);
});

for (const [field, extra] of [
  ['refunded', { refunded: true }],
  ['chargebacked', { chargebacked: 'true' }],
  ['disputed', { disputed: true, dispute_won: false }],
]) {
  test(`${field} purchase => rejected`, async () => {
    const g = fakeGumroad({ [`${PRO_ID}|${PRO_KEY}`]: { ...buyer, ...extra } });
    const r = await verifyLiminalProKey('buyer@example.com', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl });
    assert.equal(r.status, 'rejected');
  });
}

test('non-Gumroad-shaped key or missing email skips the network call', async () => {
  const g = fakeGumroad({});
  assert.equal((await verifyLiminalProKey('buyer@example.com', 'hosted-pass', { env: {}, fetchImpl: g.fetchImpl })).status, 'skipped');
  assert.equal((await verifyLiminalProKey('', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl })).status, 'skipped');
  assert.equal(g.calls.length, 0);
});

test('network error / 5xx => unavailable (transient)', async () => {
  for (const failWith of ['network', '502']) {
    const g = fakeGumroad({}, { failWith });
    const r = await verifyLiminalProKey('buyer@example.com', PRO_KEY, { env: {}, fetchImpl: g.fetchImpl });
    assert.equal(r.status, 'unavailable', failWith);
  }
});
