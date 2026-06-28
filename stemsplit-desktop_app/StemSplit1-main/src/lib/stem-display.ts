import type { StemInfo } from './tauri-bridge';

export const DRUM_MICRO_STEMS = new Set([
  'kick', 'snare', 'toms', 'hh', 'ride', 'crash', 'cymbals', 'overheads',
]);

export const VOCAL_MICRO_STEMS = new Set(['lead', 'back', 'backing', 'adlibs']);

export const STEM_DISPLAY_ORDER = [
  'vocals', 'lead', 'back', 'backing', 'adlibs',
  'drums', 'kick', 'snare', 'toms', 'hh', 'ride', 'crash', 'cymbals', 'overheads',
  'bass', 'guitar', 'piano', 'other', 'instrumental',
];

export function sortStemEntries(stems: Record<string, StemInfo>): [string, StemInfo][] {
  return Object.entries(stems).sort(([a], [b]) => {
    const ai = STEM_DISPLAY_ORDER.indexOf(a);
    const bi = STEM_DISPLAY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/** Replace a parent stem (e.g. drums) with its micro-stem children in the player list. */
export function expandResplitIntoStems(
  current: Record<string, StemInfo>,
  parentStem: string,
  subStems: Record<string, StemInfo>,
): Record<string, StemInfo> {
  const next = { ...current };
  delete next[parentStem];
  for (const [name, info] of Object.entries(subStems)) {
    next[name] = info;
  }
  return next;
}

export function isMicroStem(name: string): boolean {
  return DRUM_MICRO_STEMS.has(name) || VOCAL_MICRO_STEMS.has(name);
}