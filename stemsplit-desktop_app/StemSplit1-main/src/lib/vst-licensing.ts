'use client';

import {
  checkVstAccess,
  getVstEntitlementsStatus,
  syncVstEntitlementsFromServer,
  type VstAccessResult,
  type VstEntitlementsStatus,
} from '@/lib/tauri-bridge';
import { getVstCatalogEntry } from '@/lib/vst-catalog';
import { pollEntitlementsUntilOwned } from '@/lib/commerce';

export async function refreshVstEntitlements(email?: string): Promise<VstEntitlementsStatus> {
  if (email?.trim()) {
    try {
      return await syncVstEntitlementsFromServer(email.trim());
    } catch {
      // Fall back to local counters if sync fails.
    }
  }
  return getVstEntitlementsStatus();
}

export async function ensureVstAccess(
  pluginId: string,
  action: 'preview' | 'apply'
): Promise<VstAccessResult> {
  return checkVstAccess(pluginId, action);
}

export function getPluginStatus(
  status: VstEntitlementsStatus | null,
  pluginId: string
) {
  return status?.plugins.find((entry) => entry.plugin_id === pluginId) || null;
}

export async function unlockVstAfterCheckout(email: string, pluginId: string) {
  const lookup = await pollEntitlementsUntilOwned(email, pluginId);
  if (!lookup.ok) {
    return lookup;
  }
  await syncVstEntitlementsFromServer(email);
  return lookup;
}

export function getVstUpgradeCopy(pluginId: string) {
  const catalog = getVstCatalogEntry(pluginId);
  return {
    name: catalog?.name || pluginId,
    priceLabel: catalog?.priceLabel || '$19',
    productSlug: catalog?.productSlug || `vst_${pluginId}`,
    trialPreviews: catalog?.trialPreviews || 3,
    trialApplies: catalog?.trialApplies || 2,
  };
}