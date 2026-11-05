/**
 * Bridges the Python model catalog (model_catalog.py) to the picker's static catalog.
 * Models downloaded from the library live in the user registry JSON; this mirrors the installed
 * ones into `model-catalog.ts` so the ModelPicker can list and select them.
 */

import type { CatalogModel } from './tauri-bridge';
import { SeparationEngine, SeparationModel, setDynamicModels } from './model-catalog';

const ENGINE_MAP: Record<string, SeparationEngine> = {
  roformer: 'roformer',
  vr: 'vr',
  mdx_net: 'mdx',
  mdx: 'mdx',
  karaoke: 'karaoke',
  demucs: 'demucs',
};

const ACCENT: Record<SeparationEngine, [string, string]> = {
  roformer: ['#f472b6', 'rgba(244,114,182,0.35)'],
  vr: ['#fb923c', 'rgba(251,146,60,0.35)'],
  mdx: ['#a78bfa', 'rgba(167,139,250,0.35)'],
  karaoke: ['#34d399', 'rgba(52,211,153,0.35)'],
  demucs: ['#22d3ee', 'rgba(34,211,238,0.35)'],
  spleeter: ['#94a3b8', 'rgba(148,163,184,0.35)'],
  drumsep: ['#facc15', 'rgba(250,204,21,0.35)'],
  ensemble: ['#38bdf8', 'rgba(56,189,248,0.35)'],
  postfx: ['#2dd4bf', 'rgba(45,212,191,0.35)'],
  instrument: ['#c084fc', 'rgba(192,132,252,0.35)'],
};

/** Stem counts a catalog entry can produce (the backend only needs a sane default for 2-stem models). */
export function stemCountsFor(stems: string[]): number[] {
  const n = stems.length;
  if (n >= 2 && n <= 7) return [n];
  return [2];
}

export function catalogToSeparationModel(m: CatalogModel): SeparationModel {
  const engine = ENGINE_MAP[m.engine ?? ''] ?? 'mdx';
  const [accent, glow] = ACCENT[engine];
  const size = m.size_mb ? `${Math.round(m.size_mb)} MB` : 'size unknown';
  const vram = m.vram_gb ? `~${m.vram_gb} GB VRAM` : 'VRAM unknown';
  return {
    id: m.variant_id || m.id,
    engine,
    category: 'specialty',
    name: m.name,
    tagline: `Library • ${m.family ?? engine} • ${size}`,
    description:
      m.description ||
      `Downloaded from the model library (${m.source}). ${m.stems.length ? `Stems: ${m.stems.join(', ')}. ` : ''}${vram}.`,
    filename: m.filename,
    stems: stemCountsFor(m.stems),
    tier: 'specialty',
    accent,
    glow,
    glyph: '⬇',
    tags: ['library', m.family?.toLowerCase() ?? engine, vram],
    recommendedFor: m.stems.length ? m.stems.slice(0, 4) : ['custom model'],
    speed: (m.vram_gb ?? 3) > 4 ? 'slow' : 'balanced',
    quality: Math.max(50, Math.min(95, Math.round((m.sdr ?? 10) * 6))),
    dynamic: true,
    sizeMb: m.size_mb ?? null,
    vramGb: m.vram_gb ?? null,
  };
}

/** Load installed library models and expose them to the picker. Safe to call outside Tauri. */
export async function syncInstalledModels(): Promise<number> {
  try {
    const { isTauriRuntime } = await import('./tauri-runtime');
    if (!isTauriRuntime()) return 0;
    const { catalogList } = await import('./tauri-bridge');
    const listing = await catalogList({ installedOnly: true });
    const models = listing.models.filter((m) => m.installed).map(catalogToSeparationModel);
    setDynamicModels(models);
    return models.length;
  } catch (err) {
    console.warn('[model-library] could not load installed models', err);
    return 0;
  }
}

export function formatSize(mb?: number | null, estimated?: boolean): string {
  if (!mb) return '—';
  const text = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  return estimated ? `~${text}` : text;
}
