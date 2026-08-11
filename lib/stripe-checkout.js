import { isProProduct, resolveStripePriceId, VST_PRODUCT_CATALOG } from './vst-products.js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const paymentLinkUrl =
  process.env.STRIPE_PAYMENT_LINK_URL ||
  process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL ||
  '';
const PRODUCTION_SITE = 'https://liminal-stemsplit.onrender.com';
const defaultSuccessUrl = process.env.SITE_URL || PRODUCTION_SITE;
const defaultCancelUrl = process.env.SITE_URL || PRODUCTION_SITE;

function appendEmailToUrl(url, email) {
  if (!email) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}prefilled_email=${encodeURIComponent(email)}`;
}

export function checkoutConfigStatus() {
  const proPriceId = resolveStripePriceId('stemsplit_pro');
  const dynamicReady = !!(stripeSecretKey && proPriceId);
  const staticReady = !!paymentLinkUrl;
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
    vstProducts,
  };
}

export async function createCheckoutSession({
  email = '',
  product = 'stemsplit_pro',
  successUrl = `${defaultSuccessUrl}/?checkout=success`,
  cancelUrl = `${defaultCancelUrl}/#pricing`,
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
    if (!paymentLinkUrl) {
      return {
        ok: false,
        error: `Stripe price is not configured for ${product}.`,
      };
    }
    return {
      ok: true,
      mode: 'payment_link',
      url: appendEmailToUrl(paymentLinkUrl, email),
      product,
    };
  }

  const plan = isProProduct(product) ? 'pro' : 'vst';
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
      Authorization: `Bearer ${stripeSecretKey}`,
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

export async function createVstCheckoutSession({ product, ...options }) {
  return createCheckoutSession({ ...options, product });
}