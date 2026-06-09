import './load-env.mjs';
import { resolveStripePriceId, VST_PRODUCT_CATALOG } from './vst-products.mjs';

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function paymentLinkUrl() {
  return process.env.STRIPE_PAYMENT_LINK_URL || process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL || '';
}

function defaultSuccessUrl() {
  return process.env.CHECKOUT_SUCCESS_URL || process.env.SITE_URL || 'http://localhost:4001';
}

function defaultCancelUrl() {
  return process.env.CHECKOUT_CANCEL_URL || process.env.SITE_URL || 'http://localhost:4001';
}

function appendEmailToUrl(url, email) {
  if (!email) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}prefilled_email=${encodeURIComponent(email)}`;
}

export function checkoutConfigStatus() {
  const proPriceId = resolveStripePriceId('stemsplit_pro');
  const dynamicReady = !!(stripeSecretKey() && proPriceId);
  const staticReady = !!paymentLinkUrl();
  const vstProducts = Object.keys(VST_PRODUCT_CATALOG)
    .filter((slug) => slug.startsWith('vst_'))
    .map((slug) => ({
      product: slug,
      priceConfigured: !!resolveStripePriceId(slug),
    }));

  return {
    dynamicReady,
    staticReady,
    ready: dynamicReady || staticReady,
    priceId: proPriceId || null,
    paymentLink: paymentLinkUrl() || null,
    vstProducts,
  };
}

export async function createCheckoutSession({
  email = '',
  product = 'stemsplit_pro',
  successUrl = `${defaultSuccessUrl()}/?checkout=success`,
  cancelUrl = `${defaultCancelUrl()}/#pricing`,
} = {}) {
  const status = checkoutConfigStatus();
  if (!status.ready) {
    return {
      ok: false,
      error:
        'Stripe is not configured. Set STRIPE_SECRET_KEY + STRIPE_PRICE_ID, or STRIPE_PAYMENT_LINK_URL.',
    };
  }

  const priceId = resolveStripePriceId(product);
  if (!status.dynamicReady || !priceId) {
    if (!paymentLinkUrl()) {
      return {
        ok: false,
        error: `Stripe price is not configured for ${product}.`,
      };
    }
    return {
      ok: true,
      mode: 'payment_link',
      url: appendEmailToUrl(paymentLinkUrl(), email),
      product,
    };
  }

  const plan = product === 'stemsplit_pro' ? 'pro' : 'vst';
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('metadata[plan]', plan);
  params.append('metadata[product]', product);
  if (email) params.append('customer_email', email);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error?.message || 'Stripe checkout session failed',
    };
  }

  return {
    ok: true,
    mode: 'checkout_session',
    url: payload.url,
    sessionId: payload.id,
    product,
  };
}

export async function createProCheckoutSession(options = {}) {
  return createCheckoutSession({ ...options, product: 'stemsplit_pro' });
}