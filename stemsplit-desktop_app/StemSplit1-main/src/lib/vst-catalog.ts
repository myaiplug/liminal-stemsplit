export interface VstCatalogEntry {
  id: string;
  name: string;
  productSlug: string;
  priceLabel: string;
  trialPreviews: number;
  trialApplies: number;
}

export const VST_CATALOG: VstCatalogEntry[] = [
  {
    id: 'screwai',
    name: 'ScrewAI',
    productSlug: 'vst_screwai',
    priceLabel: '$19',
    trialPreviews: 3,
    trialApplies: 2,
  },
  {
    id: 'fantune',
    name: 'FanTune',
    productSlug: 'vst_fantune',
    priceLabel: '$19',
    trialPreviews: 3,
    trialApplies: 2,
  },
  {
    id: 'timestretchx',
    name: 'Time Stretch X',
    productSlug: 'vst_timestretchx',
    priceLabel: '$24',
    trialPreviews: 3,
    trialApplies: 2,
  },
  {
    id: 'repairit',
    name: 'Repair-IT',
    productSlug: 'vst_repairit',
    priceLabel: '$24',
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