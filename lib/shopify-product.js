// Maps a Shopify order's line items to a Liminal product. Pure (reads SHOPIFY_PRODUCT_NEEDLE at call time only).

// Products sold on the same store that must NEVER grant a Liminal/ScrewAI/etc. entitlement.
// HalfScrew has its own license service (halfscrew-license). "HALFSREW" is the typo'd SKU actually used in Shopify.
const EXCLUDED_ITEM_PATTERN = /half[\s_-]*scr?ew/i;

const itemHaystack = (item) => `${item.title || ''} ${item.name || ''} ${item.sku || ''}`.toLowerCase();
export const isExcludedItem = (item) => EXCLUDED_ITEM_PATTERN.test(itemHaystack(item));

// "screw" counts only as ScrewAI or as a standalone word ("Screw Pro", "SCREW-PRO"), never inside another word (HalfScrew, Corkscrew).
const SCREWAI_PATTERN = /(^|[^a-z])screw(ai)?($|[^a-z])|screwai/;

export function detectShopifyProduct(order) {
  const allItems = order?.line_items || [];
  if (!allItems.length) return { isMatch: true, product: 'stemsplit_pro', productName: 'Creator Pro' };
  const items = allItems.filter((item) => !isExcludedItem(item));

  for (const item of items) {
    const hay = itemHaystack(item);
    if (SCREWAI_PATTERN.test(hay)) {
      return { isMatch: true, product: 'screwai_pro', productName: item.title || 'ScrewAI PRO' };
    }
    if (hay.includes('coproducer')) {
      return { isMatch: true, product: 'coproducer_pro', productName: item.title || 'CoProducer PRO' };
    }
    if (hay.includes('degloss') || hay.includes('reverb')) {
      return { isMatch: true, product: 'vst_reverb_degloss', productName: item.title || 'ReVerb-DeGloss' };
    }
    if (hay.includes('stemsplit') || hay.includes('liminal') || hay.includes('pro') || hay.includes('stem')) {
      return { isMatch: true, product: 'stemsplit_pro', productName: item.title || 'Liminal StemSplit Pro' };
    }
  }

  const needle = (process.env.SHOPIFY_PRODUCT_NEEDLE || 'stemsplit|liminal|pro|coproducer|degloss|screwai|screw').toLowerCase();
  const patterns = needle.split('|').map((p) => p.trim()).filter(Boolean);
  const matchAny = items.some((item) => {
    const hay = itemHaystack(item);
    return patterns.some((p) => hay.includes(p));
  });

  if (matchAny) {
    return { isMatch: true, product: 'stemsplit_pro', productName: items[0]?.title || 'Creator Pro' };
  }

  return { isMatch: false, product: null, productName: null };
}
