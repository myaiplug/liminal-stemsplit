export interface UserVstEntry {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  productSlug?: string;
}

/**
 * Preloaded VST3 plugins on this machine.
 * Run scripts/discover_vsts.ps1 to rescan C:/ and D:/ and refresh this list.
 */
export const USER_VSTS: UserVstEntry[] = [
  {
    id: 'timestretchx',
    name: 'Time Stretch X',
    path: 'D:\\VST\\Time Stretch X.vst3',
    enabled: true,
    productSlug: 'vst_timestretchx',
  },
  {
    id: 'repairit',
    name: 'Repair-IT',
    path: 'D:\\VST\\Repair-IT.vst3',
    enabled: true,
    productSlug: 'vst_repairit',
  },
  {
    id: 'fantune',
    name: 'FanTune',
    path: 'D:\\VST\\FanTune.vst3',
    enabled: true,
    productSlug: 'vst_fantune',
  },
  {
    id: 'screwai',
    name: 'ScrewAI',
    path: 'D:\\VST\\ScrewAI.vst3',
    enabled: true,
    productSlug: 'vst_screwai',
  },
];