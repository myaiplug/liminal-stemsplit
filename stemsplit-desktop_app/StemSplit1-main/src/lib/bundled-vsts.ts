import { invoke } from '@tauri-apps/api/core';
import type { UserVstEntry } from '@/lib/user-vsts';

interface BundledVstEntry {
  id: string;
  name: string;
  path: string;
}

const FALLBACK_VSTS: UserVstEntry[] = [
  {
    id: 'reverb_degloss',
    name: 'ReVerb-DeGloss',
    path: '',
    enabled: true,
    productSlug: 'vst_reverb_degloss',
  },
];

export async function loadBundledVsts(): Promise<UserVstEntry[]> {
  try {
    const entries = await invoke<BundledVstEntry[]>('get_bundled_vst_paths');
    const usable = entries.filter((entry) => entry.path?.trim());
    if (usable.length === 0) return FALLBACK_VSTS;
    return usable.map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      enabled: true,
      productSlug: entry.id === 'reverb_degloss' ? 'vst_reverb_degloss' : undefined,
    }));
  } catch {
    return FALLBACK_VSTS;
  }
}

export async function resolveReverbDeglossPath(): Promise<string> {
  const vsts = await loadBundledVsts();
  return vsts.find((v) => v.id === 'reverb_degloss')?.path ?? '';
}