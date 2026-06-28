export const ALL_VST_ENTITLEMENTS = ['reverb_degloss'];

export const VST_PRODUCT_CATALOG = {
  vst_reverb_degloss: { id: 'reverb_degloss', name: 'ReVerb-DeGloss', priceEnv: 'STRIPE_PRICE_VST_REVERB_DEGLOSS' },
  stemsplit_pro: { id: 'pro', name: 'Creator Pro', priceEnv: 'STRIPE_PRICE_ID' },
};

export function productToEntitlement(product) {
  if (!product || product === 'stemsplit_pro') return 'all';
  const entry = VST_PRODUCT_CATALOG[product];
  return entry?.id && entry.id !== 'pro' ? entry.id : null;
}

export function resolveStripePriceId(product = 'stemsplit_pro') {
  const entry = VST_PRODUCT_CATALOG[product] || VST_PRODUCT_CATALOG.stemsplit_pro;
  const envKey = entry.priceEnv;
  const fromEnv = process.env[envKey]
    || (product === 'stemsplit_pro'
      ? process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO
      : null);
  return fromEnv || '';
}