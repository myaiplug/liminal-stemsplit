export interface VstCatalogEntry {
  id: string;
  name: string;
  productSlug: string;
  priceLabel: string;
  trialPreviews: number;
  trialApplies: number;
}

/** v1 ships with ReVerb-DeGloss only. */
export const VST_CATALOG: VstCatalogEntry[] = [
  {
    id: 'reverb_degloss',
    name: 'ReVerb-DeGloss',
    productSlug: 'vst_reverb_degloss',
    priceLabel: '$19',
    trialPreviews: 3,
    trialApplies: 2,
  },
];

export const VST_CATALOG_BY_ID = Object.fromEntries(
  VST_CATALOG.map((entry) => [entry.id, entry])
) as Record<string, VstCatalogEntry>;

export const ALL_VST_PLUGIN_IDS = VST_CATALOG.map((entry) => entry.id);

export function getVstCatalogEntry(pluginId: string): VstCatalogEntry | undefined {
  return VST_CATALOG_BY_ID[pluginId];
}