'use client';

import { open } from '@tauri-apps/plugin-shell';

const PRO_PRICE_LABEL = '$49';
const PRODUCTION_SITE = 'https://liminal-stemsplit.onrender.com';
const DEFAULT_PRICING_URL =
  process.env.NEXT_PUBLIC_PRICING_PAGE_URL || `${PRODUCTION_SITE}/#pricing`;
const DEFAULT_CHECKOUT_API =
  process.env.NEXT_PUBLIC_CHECKOUT_API_URL || `${PRODUCTION_SITE}/api/checkout`;
const DEFAULT_ENTITLEMENTS_API =
  process.env.NEXT_PUBLIC_ENTITLEMENTS_API_URL || `${PRODUCTION_SITE}/api/entitlements/lookup`;
const STATIC_CHECKOUT_URL = process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL || '';

import { isTauriRuntime } from '@/lib/tauri-runtime';

export function getProPriceLabel() {
  return PRO_PRICE_LABEL;
}

export function getPricingPageUrl() {
  return DEFAULT_PRICING_URL;
}

export function getCheckoutApiUrl() {
  return DEFAULT_CHECKOUT_API;
}

export function getEntitlementsApiUrl() {
  return DEFAULT_ENTITLEMENTS_API;
}

async function openExternalUrl(url: string) {
  if (isTauriRuntime()) {
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPricingPage() {
  await openExternalUrl(getPricingPageUrl());
}

export interface EntitlementsLookupResult {
  ok: boolean;
  email?: string | null;
  pro?: boolean;
  entitlements?: string[];
  error?: string;
}

export async function lookupEntitlements(email: string): Promise<EntitlementsLookupResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return { ok: false, error: 'Email is required.' };
  }

  try {
    const response = await fetch(getEntitlementsApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmedEmail }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: payload?.error || 'Entitlements lookup failed.' };
    }
    return payload as EntitlementsLookupResult;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to lookup entitlements.',
    };
  }
}

export async function pollEntitlementsUntilOwned(
  email: string,
  pluginId: string,
  options?: { attempts?: number; intervalMs?: number }
): Promise<EntitlementsLookupResult> {
  const attempts = options?.attempts ?? 45;
  const intervalMs = options?.intervalMs ?? 2000;

  for (let i = 0; i < attempts; i += 1) {
    const result = await lookupEntitlements(email);
    if (result.ok && (result.pro || result.entitlements?.includes(pluginId))) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    ok: false,
    error: 'Payment not detected yet. Try Refresh Unlock in a few seconds.',
  };
}

async function startCheckout(email: string, product: string) {
  const trimmedEmail = email.trim();

  try {
    const response = await fetch(getCheckoutApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: trimmedEmail || undefined,
        product,
        successUrl: `${getPricingPageUrl().split('#')[0]}?checkout=success&vst=${encodeURIComponent(product)}`,
        cancelUrl: getPricingPageUrl(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.url) {
      await openExternalUrl(payload.url);
      return {
        ok: true as const,
        url: payload.url as string,
        mode: payload.mode as string | undefined,
        product,
      };
    }

    if (STATIC_CHECKOUT_URL) {
      const fallbackUrl = trimmedEmail
        ? `${STATIC_CHECKOUT_URL}?prefilled_email=${encodeURIComponent(trimmedEmail)}`
        : STATIC_CHECKOUT_URL;
      await openExternalUrl(fallbackUrl);
      return { ok: true as const, url: fallbackUrl, mode: 'payment_link_fallback', product };
    }

    return {
      ok: false as const,
      error: payload?.error || 'Checkout is not configured yet.',
    };
  } catch (error) {
    if (STATIC_CHECKOUT_URL) {
      const fallbackUrl = trimmedEmail
        ? `${STATIC_CHECKOUT_URL}?prefilled_email=${encodeURIComponent(trimmedEmail)}`
        : STATIC_CHECKOUT_URL;
      await openExternalUrl(fallbackUrl);
      return { ok: true as const, url: fallbackUrl, mode: 'payment_link_fallback', product };
    }

    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Unable to start checkout.',
    };
  }
}

export async function startVstCheckout(productSlug: string, email = '') {
  return startCheckout(email, productSlug);
}

export async function startProCheckout(email = '') {
  const trimmedEmail = email.trim();

  return startCheckout(trimmedEmail, 'stemsplit_pro');
}