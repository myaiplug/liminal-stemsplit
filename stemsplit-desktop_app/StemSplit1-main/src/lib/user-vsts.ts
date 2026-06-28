export interface UserVstEntry {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  productSlug?: string;
}

/** v1 preloaded VST — path resolved at runtime via get_bundled_vst_paths. */
export const USER_VSTS: UserVstEntry[] = [
  {
    id: 'reverb_degloss',
    name: 'ReVerb-DeGloss',
    path: '',
    enabled: true,
    productSlug: 'vst_reverb_degloss',
  },
];