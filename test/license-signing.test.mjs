import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLicenseCredential,
  licenseSigningStatus,
  looksLikeDerivedCredential,
  verifyDerivedCredential,
} from '../lib/license-signing.js';
import { looksLikeGumroadKey } from '../lib/gumroad-license.js';

const envA = { STRIPE_WEBHOOK_SECRET: 'whsec_a' };

test('feature is off (null) with no secrets configured', () => {
  assert.equal(deriveLicenseCredential('a@example.com', 'stemsplit_pro', {}), null);
  assert.equal(verifyDerivedCredential('a@example.com', 'LMNL-0000-0000-0000-0000-0000', {}).valid, false);
  assert.deepEqual(licenseSigningStatus({}), { enabled: false, keys: 0, dedicated: false });
});

test('deterministic, email-normalised, product-prefixed, not Gumroad-shaped', () => {
  const c1 = deriveLicenseCredential(' Buyer@Example.com ', 'stemsplit_pro', envA);
  const c2 = deriveLicenseCredential('buyer@example.com', 'stemsplit_pro', envA);
  assert.equal(c1, c2);
  assert.match(c1, /^LMNL-[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  assert.ok(looksLikeDerivedCredential(c1));
  assert.ok(!looksLikeGumroadKey(c1));
  assert.match(deriveLicenseCredential('buyer@example.com', 'screwai_pro', envA), /^SCRW-/);
  assert.equal(deriveLicenseCredential('buyer@example.com', 'unknown_product', envA), null);
});

test('verifies for the right email only; case/whitespace tolerant', () => {
  const c = deriveLicenseCredential('buyer@example.com', 'stemsplit_pro', envA);
  assert.deepEqual(verifyDerivedCredential('BUYER@example.com', ` ${c.toLowerCase()} `, envA), { valid: true, product: 'stemsplit_pro' });
  assert.equal(verifyDerivedCredential('other@example.com', c, envA).valid, false);
});

test('tampering with the product prefix or tag fails', () => {
  const c = deriveLicenseCredential('buyer@example.com', 'vst_reverb_degloss', envA);
  assert.equal(verifyDerivedCredential('buyer@example.com', c.replace(/^RVDG/, 'LMNL'), envA).valid, false);
  const flipped = c.slice(0, -1) + (c.endsWith('0') ? '1' : '0');
  assert.equal(verifyDerivedCredential('buyer@example.com', flipped, envA).valid, false);
  assert.equal(verifyDerivedCredential('buyer@example.com', 'garbage', envA).valid, false);
});

test('different secret => different credential; old ones survive adding LICENSE_SIGNING_SECRET', () => {
  const old = deriveLicenseCredential('buyer@example.com', 'stemsplit_pro', envA);
  assert.equal(verifyDerivedCredential('buyer@example.com', old, { STRIPE_WEBHOOK_SECRET: 'whsec_b' }).valid, false);
  const envWithDedicated = { ...envA, LICENSE_SIGNING_SECRET: 'dedicated' };
  const fresh = deriveLicenseCredential('buyer@example.com', 'stemsplit_pro', envWithDedicated);
  assert.notEqual(fresh, old);
  assert.equal(verifyDerivedCredential('buyer@example.com', old, envWithDedicated).valid, true);
  assert.equal(verifyDerivedCredential('buyer@example.com', fresh, envWithDedicated).valid, true);
  assert.deepEqual(licenseSigningStatus(envWithDedicated), { enabled: true, keys: 2, dedicated: true });
});
