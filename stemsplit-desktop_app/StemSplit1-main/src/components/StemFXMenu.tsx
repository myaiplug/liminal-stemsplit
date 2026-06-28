// src/components/StemFXMenu.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { loadBundledVsts } from '@/lib/bundled-vsts';
import VstUpgradeModal from '@/components/VstUpgradeModal';
import { useLicense } from '@/contexts/LicenseContext';
import { getFreeUserSession, type VstEntitlementsStatus } from '@/lib/tauri-bridge';
import { ensureVstAccess, getPluginStatus, refreshVstEntitlements } from '@/lib/vst-licensing';
import { ALL_VST_PLUGIN_IDS } from '@/lib/vst-catalog';
import { 
  Activity,
  Gauge, 
  Sliders, 
  Flame, 
  Box, 
  MoveHorizontal, 
  Mic2, 
  Zap, 
  Waves, 
  Sparkles,
  Play,
  RotateCcw,
  Square,
  Repeat,
  Layers,
  Maximize2,
  Volume2,
  Filter,
  Wind,
  MoveVertical
} from 'lucide-react';

// --- Types ---

export interface FXParam {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  type?: 'slider' | 'toggle' | 'knob'; 
}

export interface FXModule {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'dynamics' | 'eq' | 'spatial' | 'creative' | 'restoration';
  params: FXParam[];
  enabled: boolean;
}

export interface VSTPlugin {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  productSlug?: string;
  state?: string;
}

interface StemFXMenuProps {
  stemType: string;
  stemFilePath: string;
  isOpen: boolean;
  onClose: () => void;
  onApply?: (newPath: string) => void;
  isFreeMode?: boolean;
}

// --- Constants & Presets ---

const ALL_FX_MODULES: Record<string, FXModule> = {
  gate: {
    id: 'gate',
    name: 'Pro Gate',
    description: 'Remove background noise & bleed',
    icon: <Activity className="w-3.5 h-3.5 text-emerald-400 stroke-[1.25]" />,
    category: 'dynamics',
    enabled: false,
    params: [
      { id: 'threshold', label: 'Thresh', value: -40, min: -80, max: 0, step: 1, unit: 'dB' },
      { id: 'ratio', label: 'Ratio', value: 4, min: 1, max: 100, step: 0.1, unit: ':1' },
      { id: 'attack', label: 'Attack', value: 2, min: 0.1, max: 100, step: 0.1, unit: 'ms' },
      { id: 'release', label: 'Release', value: 100, min: 10, max: 1000, step: 10, unit: 'ms' },
    ]
  },
  dereverb: {
    id: 'dereverb',
    name: 'De-Reverb',
    description: 'Tighten tails & reduce room sound',
    icon: <Wind className="w-3.5 h-3.5 text-slate-400 stroke-[1.25]" />,
    category: 'restoration',
    enabled: false,
    params: [
      { id: 'threshold', label: 'Thresh', value: -30, min: -60, max: 0, step: 1, unit: 'dB' },
      { id: 'amount', label: 'Amount', value: 40, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'release', label: 'Release', value: 200, min: 50, max: 500, step: 10, unit: 'ms' },
    ]
  },
  deesser: {
    id: 'deesser',
    name: 'De-Esser',
    description: 'Tame harsh sibilance',
    icon: <Filter className="w-3.5 h-3.5 text-pink-400 stroke-[1.25]" />,
    category: 'restoration',
    enabled: false,
    params: [
      { id: 'threshold', label: 'Thresh', value: -20, min: -50, max: 0, step: 1, unit: 'dB' },
      { id: 'frequency', label: 'Freq', value: 7000, min: 3000, max: 10000, step: 100, unit: 'Hz' },
    ]
  },
  compressor: {
    id: 'compressor',
    name: 'Studio Comp',
    description: 'Glue & dynamics control',
    icon: <Gauge className="w-3.5 h-3.5 text-blue-400 stroke-[1.25]" />,
    category: 'dynamics',
    enabled: false,
    params: [
      { id: 'threshold', label: 'Thresh', value: -20, min: -60, max: 0, step: 1, unit: 'dB' },
      { id: 'ratio', label: 'Ratio', value: 2.5, min: 1, max: 20, step: 0.5, unit: ':1' },
      { id: 'makeup', label: 'Gain', value: 0, min: 0, max: 24, step: 0.5, unit: 'dB' },
      { id: 'mix', label: 'Mix', value: 100, min: 0, max: 100, step: 1, unit: '%' },
    ]
  },
  eq: {
    id: 'eq',
    name: '3-Band EQ',
    description: 'Tonal shaping',
    icon: <Sliders className="w-3.5 h-3.5 text-yellow-400 stroke-[1.25]" />,
    category: 'eq',
    enabled: false,
    params: [
      { id: 'low', label: 'Low', value: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
      { id: 'mid', label: 'Mid', value: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
      { id: 'high', label: 'High', value: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
      { id: 'freq_mid', label: 'Mid Freq', value: 1000, min: 200, max: 5000, step: 100, unit: 'Hz' },
    ]
  },
  saturation: {
    id: 'saturation',
    name: 'Analog Warmth',
    description: 'Tube/Tape saturation',
    icon: <Flame className="w-3.5 h-3.5 text-orange-400 stroke-[1.25]" />,
    category: 'creative',
    enabled: false,
    params: [
      { id: 'drive', label: 'Drive', value: 20, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'mix', label: 'Mix', value: 50, min: 0, max: 100, step: 1, unit: '%' },
    ]
  },
  reverb: {
    id: 'reverb',
    name: 'Space Designer',
    description: 'Algorithmic Reverb',
    icon: <Box className="w-3.5 h-3.5 text-purple-400 stroke-[1.25]" />,
    category: 'spatial',
    enabled: false,
    params: [
      { id: 'room_size', label: 'Size', value: 50, min: 1, max: 100, step: 1, unit: '%' },
      { id: 'damping', label: 'Damp', value: 40, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'width', label: 'Width', value: 100, min: 0, max: 200, step: 5, unit: '%' },
      { id: 'wet', label: 'Mix', value: 20, min: 0, max: 100, step: 1, unit: '%' },
    ]
  },
  delay: {
    id: 'delay',
    name: 'Tape Delay',
    description: 'Classic Echo & Repeats',
    icon: <Repeat className="w-3.5 h-3.5 text-cyan-400 stroke-[1.25]" />,
    category: 'spatial',
    enabled: false,
    params: [
      { id: 'time', label: 'Time', value: 250, min: 10, max: 2000, step: 10, unit: 'ms' },
      { id: 'feedback', label: 'Fdbk', value: 30, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'mix', label: 'Mix', value: 30, min: 0, max: 100, step: 1, unit: '%' },
    ]
  },
  chorus: {
    id: 'chorus',
    name: 'Stereo Chorus',
    description: 'Width & Modulation',
    icon: <Layers className="w-3.5 h-3.5 text-indigo-400 stroke-[1.25]" />,
    category: 'creative',
    enabled: false,
    params: [
      { id: 'rate', label: 'Rate', value: 1.0, min: 0.1, max: 10.0, step: 0.1, unit: 'Hz' },
      { id: 'depth', label: 'Depth', value: 0.25, min: 0, max: 1.0, step: 0.01, unit: '' },
      { id: 'mix', label: 'Mix', value: 50, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'delay', label: 'Delay', value: 7.0, min: 1, max: 20, step: 0.5, unit: 'ms' }, 
      { id: 'feedback', label: 'Fdbk', value: 0.0, min: 0, max: 0.9, step: 0.05, unit: '' }
    ]
  },
  loudness: {
    id: 'loudness',
    name: 'Pro Maximizer',
    description: 'Transparent Limiting',
    icon: <Maximize2 className="w-3.5 h-3.5 text-red-400 stroke-[1.25]" />,
    category: 'dynamics',
    enabled: false,
    params: [
      { id: 'gain', label: 'Input', value: 0, min: 0, max: 24, step: 0.5, unit: 'dB' },
      { id: 'ceiling', label: 'Ceiling', value: -0.1, min: -6.0, max: 0.0, step: 0.1, unit: 'dB' },
    ]
  },
  'stereo-width': {
    id: 'stereo-width',
    name: 'Stereo Widener',
    description: 'Imager & Spreader',
    icon: <MoveHorizontal className="w-3.5 h-3.5 text-pink-400 stroke-[1.25]" />,
    category: 'spatial',
    enabled: false,
    params: [
      { id: 'width', label: 'Width', value: 100, min: 0, max: 300, step: 5, unit: '%' },
    ]
  },
  filter: {
    id: 'filter',
    name: 'DJ Filter',
    description: 'High/Low Pass Sweep',
    icon: <Filter className="w-3.5 h-3.5 text-yellow-500 stroke-[1.25]" />,
    category: 'eq',
    enabled: false,
    params: [
      { id: 'hp', label: 'Hi-Pass', value: 20, min: 20, max: 5000, step: 10, unit: 'Hz' },
      { id: 'lp', label: 'Lo-Pass', value: 20000, min: 200, max: 20000, step: 100, unit: 'Hz' }
    ]
  },
  phaser: {
    id: 'phaser',
    name: 'Jet Phaser',
    description: 'Sweeping Phase',
    icon: <Wind className="w-3.5 h-3.5 text-cyan-500 stroke-[1.25]" />,
    category: 'creative',
    enabled: false,
    params: [
      { id: 'rate', label: 'Rate', value: 0.5, min: 0.1, max: 10, step: 0.1, unit: 'Hz' },
      { id: 'depth', label: 'Depth', value: 0.5, min: 0, max: 1, step: 0.1, unit: '' },
      { id: 'feedback', label: 'Fdbk', value: 0.5, min: 0, max: 0.9, step: 0.1, unit: '' },
      { id: 'mix', label: 'Mix', value: 0.5, min: 0, max: 1, step: 0.1, unit: '' }
    ]
  },
  pitch: {
    id: 'pitch',
    name: 'Pitch Shifter',
    description: 'Transpose Semitones',
    icon: <MoveVertical className="w-3.5 h-3.5 text-purple-500 stroke-[1.25]" />,
    category: 'creative',
    enabled: false,
    params: [
      { id: 'semitones', label: 'Shift', value: 0, min: -12, max: 12, step: 1, unit: 'st' }
    ]
  }
};

const DRUMS_FX_CHAIN = ['gate', 'dereverb', 'eq', 'filter', 'compressor', 'saturation', 'phaser', 'chorus', 'loudness', 'reverb'];

const STEM_FX_CHAINS: Record<string, string[]> = {
  vocals: ['pitch', 'gate', 'deesser', 'dereverb', 'filter', 'eq', 'compressor', 'saturation', 'delay', 'reverb', 'loudness', 'stereo-width'],
  drums: DRUMS_FX_CHAIN,
  kick: DRUMS_FX_CHAIN,
  snare: DRUMS_FX_CHAIN,
  toms: DRUMS_FX_CHAIN,
  hh: DRUMS_FX_CHAIN,
  ride: DRUMS_FX_CHAIN,
  crash: DRUMS_FX_CHAIN,
  cymbals: DRUMS_FX_CHAIN,
  overheads: DRUMS_FX_CHAIN,
  bass: ['gate', 'dereverb', 'compressor', 'eq', 'filter', 'saturation', 'chorus', 'loudness', 'stereo-width'],
  other: ['pitch', 'dereverb', 'filter', 'phaser', 'eq', 'compressor', 'saturation', 'chorus', 'delay', 'reverb', 'stereo-width', 'loudness'],
  piano: ['dereverb', 'eq', 'filter', 'compressor', 'reverb', 'delay', 'stereo-width', 'loudness'],
  guitar: ['gate', 'dereverb', 'pitch', 'eq', 'filter', 'compressor', 'saturation', 'phaser', 'chorus', 'delay', 'reverb', 'loudness'],
  lead: ['pitch', 'gate', 'deesser', 'dereverb', 'filter', 'eq', 'compressor', 'saturation', 'delay', 'reverb', 'loudness', 'stereo-width'],
  back: ['pitch', 'gate', 'deesser', 'dereverb', 'filter', 'eq', 'compressor', 'saturation', 'delay', 'reverb', 'loudness', 'stereo-width'],
  backing: ['pitch', 'gate', 'deesser', 'dereverb', 'filter', 'eq', 'compressor', 'saturation', 'delay', 'reverb', 'loudness', 'stereo-width'],
};

function resolveFxChainKey(stemType: string): string {
  const lower = stemType.toLowerCase();
  if (STEM_FX_CHAINS[lower]) return lower;
  const match = Object.keys(STEM_FX_CHAINS).find((k) => lower.includes(k));
  return match || 'other';
}

const STEM_PRESETS: Record<string, { id: string; label: string; icon: React.ReactNode; fx: any }[]> = {
    vocals: [
        { 
            id: 'voc_lead', 
            label: 'Lead Vocal', 
            icon: <Mic2 className="w-3.5 h-3.5 text-blue-300" />, 
            fx: { 
                gate: { enabled: true, threshold: -45.0, ratio: 4.0 }, 
                compressor: { enabled: true, threshold: -24.0, ratio: 3.0, makeup: 4.0 },
                eq: { enabled: true, high: 2.0, mid: -1.0, width: 1.0 }, 
                reverb: { enabled: true, mix: 15.0, room_size: 40.0 }, 
                delay: { enabled: true, time: 250, feedback: 20, mix: 15 }
            } 
        },
        { 
            id: 'voc_telephone', 
            label: 'Telephone', 
            icon: <Activity className="w-3.5 h-3.5 text-green-300" />, 
            fx: { 
                filter: { enabled: true, hp: 400.0, lp: 3500.0 },
                saturation: { enabled: true, drive: 40.0, mix: 100.0 }
            } 
        },
        { 
            id: 'voc_chipmunk', 
            label: 'High Pitch', 
            icon: <MoveVertical className="w-3.5 h-3.5 text-purple-300" />, 
            fx: { 
                pitch: { enabled: true, semitones: 12 },
            } 
        },
        { 
            id: 'voc_loud', 
            label: 'Loudness', 
            icon: <Maximize2 className="w-3.5 h-3.5 text-red-300" />, 
            fx: { 
                compressor: { enabled: true, threshold: -20, ratio: 4, makeup: 6 },
                loudness: { enabled: true, gain: 3.0, ceiling: -0.1 }
            } 
        },
    ],
    drums: [
        { 
            id: 'drum_kick', 
            label: 'Kick Boost', 
            icon: <Zap className="w-3.5 h-3.5 text-yellow-300" />, 
            fx: { 
                eq: { enabled: true, low: 6.0, mid: -3.0, high: 1.0, freq: 250 },
                compressor: { enabled: true, threshold: -18, ratio: 4, attack: 30 }
            } 
        },
        { 
            id: 'drum_phaser', 
            label: 'Jet Overhead', 
            icon: <Wind className="w-3.5 h-3.5 text-cyan-300" />, 
            fx: { 
                phaser: { enabled: true, rate: 0.2, depth: 0.7, feedback: 0.5, mix: 40 },
                compressor: { enabled: true, threshold: -20, ratio: 4 }
            } 
        },
        { 
            id: 'drum_crush', 
            label: 'Crushed', 
            icon: <Flame className="w-3.5 h-3.5 text-orange-300" />, 
            fx: { 
                saturation: { enabled: true, drive: 60.0, mix: 80.0 },
                compressor: { enabled: true, threshold: -30.0, ratio: 8.0, makeup: 4.0 },
                filter: { enabled: true, lp: 8000 }
            } 
        },
        {
            id: 'drum_wide',
            label: 'Wide Kit',
            icon: <Layers className="w-3.5 h-3.5 text-purple-300" />,
            fx: {
                chorus: { enabled: true, rate: 0.5, depth: 0.3, mix: 40 },
                reverb: { enabled: true, mix: 20, width: 150 }
            }
        }
    ],
    bass: [
        { 
            id: 'bass_sub', 
            label: 'Sub Enhance', 
            icon: <Waves className="w-3.5 h-3.5 text-indigo-300" />, 
            fx: { 
                eq: { enabled: true, low: 6, mid: -2, high: -6 },
                compressor: { enabled: true, threshold: -15, ratio: 4, release: 200 }
            } 
        },
        { 
            id: 'bass_fuzz', 
            label: 'Fuzz Bass', 
            icon: <Flame className="w-3.5 h-3.5 text-orange-500" />, 
            fx: { 
                saturation: { enabled: true, drive: 60, mix: 70 },
                eq: { enabled: true, mid: 4, freq_mid: 800 },
                chorus: { enabled: true, rate: 0.4, depth: 0.3, mix: 30 }
            } 
        },
        {
            id: 'bass_phaser',
            label: 'Synth Phase',
            icon: <Wind className="w-3.5 h-3.5 text-cyan-500" />,
            fx: {
                phaser: { enabled: true, rate: 0.6, depth: 0.8, feedback: 0.6, mix: 50 },
                compressor: { enabled: true, threshold: -20, ratio: 4 }
            }
        },
        {
            id: 'bass_tight',
            label: 'Tight & Clean',
            icon: <Activity className="w-3.5 h-3.5 text-emerald-300" />,
            fx: {
                gate: { enabled: true, threshold: -30, release: 50 },
                compressor: { enabled: true, threshold: -20, ratio: 6, attack: 5 }
            }
        }
    ],
    other: [
        { 
            id: 'inst_wide', 
            label: 'Wide Stereo', 
            icon: <MoveHorizontal className="w-3.5 h-3.5 text-pink-300" />, 
            fx: { 
                'stereo-width': { enabled: true, width: 140 },
                eq: { enabled: true, high: 3 }
            } 
        },
        {
            id: 'inst_pitch',
            label: 'Octave Down',
            icon: <MoveVertical className="w-3.5 h-3.5 text-purple-300" />,
            fx: {
                pitch: { enabled: true, semitones: -12 }
            }
        },
        { 
            id: 'inst_bright', 
            label: 'Shimmer', 
            icon: <Sparkles className="w-3.5 h-3.5 text-cyan-300" />, 
            fx: { 
                eq: { enabled: true, high: 5, mid: -1 },
                reverb: { enabled: true, room_size: 90, mix: 20, damping: 0 },
                phaser: { enabled: true, rate: 0.1, depth: 0.3, mix: 20 }
            } 
        }
    ]
};

// Fallback for types not explicitly listed
STEM_PRESETS['instrumental'] = STEM_PRESETS['other'];
STEM_PRESETS['piano'] = STEM_PRESETS['other'];
STEM_PRESETS['guitar'] = STEM_PRESETS['other'];
STEM_PRESETS['kick'] = STEM_PRESETS['drums'];
STEM_PRESETS['snare'] = STEM_PRESETS['drums'];
STEM_PRESETS['toms'] = STEM_PRESETS['drums'];
STEM_PRESETS['hh'] = STEM_PRESETS['drums'];
STEM_PRESETS['ride'] = STEM_PRESETS['drums'];
STEM_PRESETS['crash'] = STEM_PRESETS['drums'];
STEM_PRESETS['cymbals'] = STEM_PRESETS['drums'];
STEM_PRESETS['overheads'] = STEM_PRESETS['drums'];

const QUICK_PRESETS = STEM_PRESETS['vocals']; // Default to avoid errors if used directly somewhere
const FREE_PREVIEW_SECONDS = 5;

// --- Subcomponents ---

const FXKnob: React.FC<{ value: number; min: number; max: number; onChange: (v: number) => void; label: string; unit: string }> = ({ value, min, max, onChange, label, unit }) => {
    // Basic knob implementation or just a simpler vertical slider integration
    // For simplicity in this iteration, reusing a vertical-ish slider logic 
    // but styled as a compact control
    return (
        <div className="flex flex-col items-center gap-1 min-w-[3rem]">
            <input 
                type="range" min={min} max={max} step={(max-min)/100} value={value} 
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
             <div className="text-[10px] text-slate-400 font-mono text-center">
                {label}<br/>
                <span className="text-slate-200">{value}{unit}</span>
             </div>
        </div>
    )
}

// --- Main Component ---

const StemFXMenu: React.FC<StemFXMenuProps> = ({ stemType, stemFilePath, isOpen, onClose, onApply, isFreeMode = false }) => {
    const { isPro } = useLicense();
    const [activeTab, setActiveTab] = useState<'daw' | 'presets' | 'vst'>('daw');
    const [fxPage, setFxPage] = useState(0); // 0 = first 4, 1 = next 4
    
    // Initialize module list based on stem type
    const [activeModules, setActiveModules] = useState<FXModule[]>(() => {
        // Find which chain to use (default to 'other')
        const chainKey = resolveFxChainKey(stemType);
        const chainIds = STEM_FX_CHAINS[chainKey];
        
        // Map IDs to fresh module instances
        return chainIds.map(id => {
            const template = ALL_FX_MODULES[id];
            if (!template) return null;
            return {
                ...template,
                params: template.params.map(p => ({ ...p }))
            };
        }).filter(Boolean) as FXModule[];
    });

    const [catalogVsts, setCatalogVsts] = useState<VSTPlugin[]>([]);
    const [loadedVSTs, setLoadedVSTs] = useState<VSTPlugin[]>([]);
    const [vstLoadIndex, setVstLoadIndex] = useState(0);
    const [vstLoading, setVstLoading] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [previewingVstId, setPreviewingVstId] = useState<string | null>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [livePreview, setLivePreview] = useState(false);
    const [vstEntitlements, setVstEntitlements] = useState<VstEntitlementsStatus | null>(null);
    const [upgradePluginId, setUpgradePluginId] = useState<string | null>(null);

    const refreshEntitlements = useCallback(async () => {
        const session = await getFreeUserSession();
        const email = session.success ? session.profile?.email : undefined;
        const status = await refreshVstEntitlements(email);
        setVstEntitlements(status);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        refreshEntitlements();
    }, [isOpen, refreshEntitlements, isPro]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        loadBundledVsts().then((entries) => {
            if (cancelled) return;
            setCatalogVsts(
                entries
                    .filter((entry) => entry.path?.trim())
                    .map((entry) => ({
                        id: entry.id,
                        name: entry.name,
                        path: entry.path,
                        enabled: entry.enabled ?? true,
                        productSlug: entry.productSlug,
                    }))
            );
            setVstLoadIndex(0);
            setLoadedVSTs([]);
        });
        return () => { cancelled = true; };
    }, [isOpen]);

    // Load catalog VSTs one at a time to avoid host crashes
    useEffect(() => {
        if (!isOpen || activeTab !== 'vst') return;
        if (vstLoadIndex >= catalogVsts.length) return;

        let cancelled = false;
        setVstLoading(true);

        const timer = setTimeout(() => {
            if (cancelled) return;
            const next = catalogVsts[vstLoadIndex];
            setLoadedVSTs((prev) => {
                if (prev.some((v) => v.id === next.id)) return prev;
                return [...prev, { ...next, enabled: next.enabled ?? true }];
            });
            setVstLoadIndex((i) => i + 1);
            setVstLoading(false);
        }, vstLoadIndex === 0 ? 120 : 380);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isOpen, activeTab, vstLoadIndex, catalogVsts]);
    
    // Preview Management
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const liveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const freePreviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingPreviewRef = useRef<number>(0); // Track request sequence
    const previewPlaybackGenRef = useRef(0); // Invalidates in-flight play() promises
    const isApplyingRef = useRef(false);
    const prevLivePreviewRef = useRef(false);
    const allAudioInstancesRef = useRef<Set<HTMLAudioElement>>(new Set()); // Track ALL audio instances

    const stopAudioElement = useCallback((audio: HTMLAudioElement) => {
        try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        } catch {
            // pause() during pending play() throws AbortError — expected when switching previews
        }
    }, []);

    // Helper function to stop and cleanup all audio instances
    const cleanupAllAudio = useCallback(() => {
        previewPlaybackGenRef.current += 1;
        if (freePreviewTimeoutRef.current) {
            clearTimeout(freePreviewTimeoutRef.current);
            freePreviewTimeoutRef.current = null;
        }
        allAudioInstancesRef.current.forEach((audio) => stopAudioElement(audio));
        allAudioInstancesRef.current.clear();
        previewAudioRef.current = null;
    }, [stopAudioElement]);

    const waitForPreviewReady = useCallback((audio: HTMLAudioElement) => {
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            const onReady = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error('Preview audio failed to load'));
            };
            const cleanup = () => {
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('loadeddata', onReady);
                audio.removeEventListener('error', onError);
            };
            audio.addEventListener('canplay', onReady);
            audio.addEventListener('loadeddata', onReady);
            audio.addEventListener('error', onError);
        });
    }, []);

    const playPreviewAudio = useCallback(async (
        outputPath: string,
        requestId: number,
        options: {
            resumeTime: number;
            isFreeFxPreview: boolean;
            previewStartSeconds?: number;
        },
    ) => {
        if (pendingPreviewRef.current !== requestId) return false;

        const playbackGen = previewPlaybackGenRef.current;
        const audio = new Audio(`${convertFileSrc(outputPath)}?t=${Date.now()}`);
        allAudioInstancesRef.current.add(audio);
        audio.volume = 0.8;
        audio.loop = !options.isFreeFxPreview && livePreview;

        try {
            await waitForPreviewReady(audio);
        } catch (err) {
            allAudioInstancesRef.current.delete(audio);
            stopAudioElement(audio);
            console.error('Preview load failed:', err);
            setStatusMsg('Playback Failed');
            return false;
        }

        if (
            pendingPreviewRef.current !== requestId
            || previewPlaybackGenRef.current !== playbackGen
        ) {
            allAudioInstancesRef.current.delete(audio);
            stopAudioElement(audio);
            return false;
        }

        if (options.resumeTime >= 0) {
            if (!Number.isFinite(audio.duration) || options.resumeTime < audio.duration) {
                audio.currentTime = options.resumeTime;
            } else {
                audio.currentTime = 0;
            }
        }

        if (options.isFreeFxPreview) {
            audio.loop = false;
        }

        previewAudioRef.current = audio;

        try {
            await audio.play();
        } catch (err: unknown) {
            allAudioInstancesRef.current.delete(audio);
            if (previewAudioRef.current === audio) previewAudioRef.current = null;
            const error = err as { name?: string };
            if (error?.name === 'AbortError') return false;
            console.error('Playback failed:', err);
            setStatusMsg('Playback Failed');
            return false;
        }

        if (
            pendingPreviewRef.current !== requestId
            || previewPlaybackGenRef.current !== playbackGen
        ) {
            stopAudioElement(audio);
            allAudioInstancesRef.current.delete(audio);
            if (previewAudioRef.current === audio) previewAudioRef.current = null;
            return false;
        }

        if (options.isFreeFxPreview) {
            const startHint = typeof options.previewStartSeconds === 'number'
                ? ` from ${options.previewStartSeconds.toFixed(1)}s`
                : '';
            setStatusMsg(`Playing ${FREE_PREVIEW_SECONDS}s Pro FX taste${startHint}…`);
            if (freePreviewTimeoutRef.current) clearTimeout(freePreviewTimeoutRef.current);
            freePreviewTimeoutRef.current = setTimeout(() => {
                stopAudioElement(audio);
                allAudioInstancesRef.current.delete(audio);
                if (previewAudioRef.current === audio) previewAudioRef.current = null;
                setStatusMsg('Preview ended — upgrade for full FX');
            }, FREE_PREVIEW_SECONDS * 1000);
        } else {
            setStatusMsg('Playing Preview...');
        }

        audio.onended = () => {
            if (freePreviewTimeoutRef.current) {
                clearTimeout(freePreviewTimeoutRef.current);
                freePreviewTimeoutRef.current = null;
            }
            if (!livePreview) {
                setStatusMsg(options.isFreeFxPreview ? 'Preview ended — upgrade for full FX' : 'Preview Ended.');
            }
            allAudioInstancesRef.current.delete(audio);
            if (previewAudioRef.current === audio) previewAudioRef.current = null;
        };
        audio.onerror = () => {
            allAudioInstancesRef.current.delete(audio);
            if (previewAudioRef.current === audio) previewAudioRef.current = null;
        };

        return true;
    }, [livePreview, stopAudioElement, waitForPreviewReady]);

    // Clean up audio on unmount and when window closes
    useEffect(() => {
        // Handle app/window close
        const handleBeforeUnload = () => {
            cleanupAllAudio();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            cleanupAllAudio();
            if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
            if (freePreviewTimeoutRef.current) clearTimeout(freePreviewTimeoutRef.current);
        };
    }, [cleanupAllAudio]);

    // Refresh modules when stemType changes (but only if menu is open or about to open)
    useEffect(() => {
        const chainKey = resolveFxChainKey(stemType);
        const chainIds = STEM_FX_CHAINS[chainKey];
        
        const newModules = chainIds.map(id => {
            const template = ALL_FX_MODULES[id];
            if (!template) return null;
            return {
                ...template,
                params: template.params.map(p => ({ ...p }))
            };
        }).filter(Boolean) as FXModule[];
        
        setActiveModules(newModules);
    }, [stemType]);

    // PRO VERSION: Real-time VST Preview & State Capture
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        const setup = async () => {
             unlisten = await listen('vst-state-update', (event) => {
                 const state = event.payload as string;
                 setLoadedVSTs(prev => prev.map(v => {
                      if (v.id === previewingVstId) {
                          return { ...v, state };
                      }
                      return v;
                 }));
             });
        };
        if (previewingVstId) setup();
        return () => { if (unlisten) unlisten(); };
    }, [previewingVstId]);

    const isCatalogVst = (vstId: string) => ALL_VST_PLUGIN_IDS.includes(vstId);

    const handlePreviewVST = async (vst: VSTPlugin) => {
        if (!isPro && !isCatalogVst(vst.id)) {
            setStatusMsg('Custom VST plugins require Pro or a plugin purchase.');
            return;
        }

        if (!isPro && isCatalogVst(vst.id)) {
            const access = await ensureVstAccess(vst.id, 'preview');
            if (!access.allowed) {
                setUpgradePluginId(vst.id);
                setStatusMsg(access.reason || 'Trial preview limit reached.');
                return;
            }
        }

        // Stop current preview if active
        if (previewingVstId === vst.id) {
            setStatusMsg("Stopping VST...");
            try {
                await invoke('stop_vst_plugin');
            } catch(e) {
                console.error("Failed to stop:", e);
            }
            setPreviewingVstId(null);
            return;
        }

        if (previewingVstId) return;
        
        setPreviewingVstId(vst.id);
        setStatusMsg(`Opening ${vst.name}...`);
        try {
            await invoke('preview_vst_plugin', {
                pluginId: vst.id,
                vstPath: vst.path,
                audioPath: stemFilePath,
            });
            setStatusMsg('VST Closed.');
            await refreshEntitlements();
        } catch(e) {
            console.error(e); 
            const message = typeof e === 'string' ? e : (e as Error)?.message || 'Preview Ended';
            if (!isPro && message.toLowerCase().includes('trial')) {
                setUpgradePluginId(vst.id);
            }
            setStatusMsg(message);
        } finally {
            setPreviewingVstId(null);
        }
    };


    // --- Actions ---

    const toggleModule = (id: string) => {
        // Deep clone to avoid mutating the object in state which might cause React issues
        setActiveModules(prev => {
            return prev.map(m => {
                if (m.id === id) {
                    return { ...m, enabled: !m.enabled };
                }
                return m;
            });
        });
    };

    const updateParam = (modId: string, paramId: string, val: number) => {
        setActiveModules(prev => prev.map(m => {
            if (m.id !== modId) return m;
            return {
                ...m,
                params: m.params.map(p => p.id === paramId ? { ...p, value: val } : p)
            };
        }));
    };

    const handleApplyChain = async (vstPaths: string[]) => {
        setIsApplying(true);
        setStatusMsg('Loading VST chain (sequential)…');
        try {
            let lastOutput = stemFilePath;
            for (let i = 0; i < vstPaths.length; i += 1) {
                const vstPath = vstPaths[i];
                const label = vstPath.split(/[\\/]/).pop() || `VST ${i + 1}`;
                setStatusMsg(`Loading ${i + 1}/${vstPaths.length}: ${label}…`);

                const fxJson = JSON.stringify({ vsts: [{ path: vstPath }] });
                const fxBase64 = window.btoa(fxJson);
                const result = await invoke<string>('apply_stem_fx', {
                    stemPath: lastOutput,
                    fxJson: fxBase64,
                    vstPluginIds: [],
                });
                const parsed = JSON.parse(result);
                if (parsed.status === 'success' && parsed.output_path) {
                    lastOutput = parsed.output_path;
                } else {
                    throw new Error(parsed.message || `Failed on ${label}`);
                }

                await new Promise((r) => setTimeout(r, 250));
            }
            setStatusMsg('VST chain applied');
            onApply?.(lastOutput);
        } catch (err: any) {
            setStatusMsg(`Failed: ${err?.message || err}`);
        } finally {
            setIsApplying(false);
        }
    };

    const applyPreset = (presetId: string) => {
        const typeKey = stemType?.toLowerCase() || 'other';
        const availablePresets = STEM_PRESETS[typeKey] || STEM_PRESETS['other'];
        const preset = availablePresets.find(p => p.id === presetId);
        
        if (!preset) {
            console.warn(`Preset ${presetId} not found for type ${typeKey}`);
            return;
        }

        setActiveModules(prev => prev.map(m => {
            const config = preset.fx[m.id]; // e.g. fx.compressor
            
            if (config) {
                // Update params if defined
                const newParams = m.params.map(p => {
                    const newVal = config[p.id];
                    return newVal !== undefined ? { ...p, value: newVal } : p;
                });
                
                // Determine enabled state:
                // If config has 'enabled' prop, use it.
                // Otherwise assume true if config exists.
                const shouldEnable = config.enabled !== undefined ? config.enabled : true;

                return { ...m, enabled: shouldEnable, params: newParams };
            }
            
            // Disable modules not in the preset
            return { ...m, enabled: false };
        }));

        setStatusMsg(`Loaded: ${preset.label}`);
        setTimeout(() => setStatusMsg(''), 2000);
    };

    const handleUndo = () => {
        if (history.length === 0) return;
        
        const lastStem = history[history.length - 1];
        setHistory(prev => prev.slice(0, -1));
        
        if (onApply) onApply(lastStem);
        setStatusMsg('Undone: FX Reverted.');
    };

    const handleApplyFX = useCallback(async (isPreview = false, resumeTime = -1) => {
        if (isApplyingRef.current && isPreview && resumeTime < 0) return;

        // Increment sequence ID to invalidate parallel/pending renders
        const requestId = Date.now();
        pendingPreviewRef.current = requestId;
        isApplyingRef.current = true;

        setIsApplying(true);
        setStatusMsg(isPreview ? 'Generating Preview...' : 'Rendering FX...');
        
        let previousAudio: HTMLAudioElement | null = null;
        
        // If not resuming (fresh playback) or if non-live, stop existing IMMEDIATELY
        if (resumeTime < 0) {
            // Clean up ALL audio instances, not just the current one
            cleanupAllAudio();
        } else {
            // If resuming for live preview crossfade
            previousAudio = previewAudioRef.current;
            // We keep it playing until new one is ready
        }

        try {
            const enabledModules = activeModules.filter(m => m.enabled);
            const enabledVSTs = loadedVSTs.filter(v => v.enabled);

            if (!isPro && !isPreview && enabledModules.length > 0) {
                setStatusMsg('Built-in FX require Pro to apply. Use Preview for a 5s taste.');
                setIsApplying(false);
                return;
            }

            if (!isPro && isPreview && enabledModules.length > 0 && enabledVSTs.length > 0) {
                setStatusMsg('Free preview supports built-in FX or VST — not both at once.');
                setIsApplying(false);
                return;
            }

            if (!isPro) {
                for (const vst of enabledVSTs) {
                    if (!isCatalogVst(vst.id)) {
                        setStatusMsg('Custom VST plugins require Pro or a plugin purchase.');
                        setIsApplying(false);
                        return;
                    }
                    const access = await ensureVstAccess(vst.id, isPreview ? 'preview' : 'apply');
                    if (!access.allowed) {
                        setUpgradePluginId(vst.id);
                        setStatusMsg(access.reason || (isPreview ? 'Trial preview limit reached.' : 'Trial apply limit reached.'));
                        setIsApplying(false);
                        return;
                    }
                }
            }
            
            if (enabledModules.length === 0 && enabledVSTs.length === 0) {
                setStatusMsg('No FX selected');
                setIsApplying(false);
                return;
            }

            const isFreeFxPreview = !isPro && isPreview && enabledModules.length > 0;

            const fxConfig = {
                preview: isPreview,
                free_taste: isFreeFxPreview,
                preview_duration_seconds: isFreeFxPreview ? FREE_PREVIEW_SECONDS : 10,
                preview_random: isFreeFxPreview,
                modules: enabledModules.map(m => ({
                    id: m.id,
                    params: m.params.reduce((acc, p) => ({ ...acc, [p.id]: p.value }), {})
                })),
                vsts: enabledVSTs.map(v => ({ path: v.path, state: v.state }))
            };

            const fxJson = JSON.stringify(fxConfig);
            // Retrieve actual error message from backend if possible
            let result;
            try {
                 // Use Base64 to avoid command-line quoting issues on Windows
                 const fxBase64 = typeof window !== 'undefined' ? window.btoa(fxJson) : Buffer.from(fxJson).toString('base64');
                 
                 result = await invoke<string>('apply_stem_fx', {
                    stemPath: stemFilePath,
                    fxJson: fxBase64,
                    vstPluginIds: enabledVSTs.map((v) => v.id),
                });
            } catch (err: any) {
                console.error("Backend Error:", err);
                const message = typeof err === 'string' ? err : err.message || 'Unknown error';
                if (!isPro && message.toLowerCase().includes('trial')) {
                    const blocked = enabledVSTs.find((v) => message.toLowerCase().includes(v.id));
                    setUpgradePluginId(blocked?.id || enabledVSTs[0]?.id || null);
                }
                setStatusMsg(`Failed: ${message}`);
                setIsApplying(false);
                return;
            }

            await refreshEntitlements();
            
            // Check if this request is still the latest one
            if (isPreview && pendingPreviewRef.current !== requestId) {
                // Determine if we should drop this result
                // Another request started after us, so ignore this result to prevent overlap
                return;
            }

            const parsed = JSON.parse(result);
            if (parsed.status === 'success' && parsed.output_path) {
                if (isPreview) {
                    if (previousAudio && !allAudioInstancesRef.current.has(previousAudio)) {
                        stopAudioElement(previousAudio);
                        previousAudio = null;
                    }

                    await playPreviewAudio(parsed.output_path, requestId, {
                        resumeTime,
                        isFreeFxPreview,
                        previewStartSeconds: parsed.preview_start_seconds,
                    });
                } else {
                    // Save current stem to history before replacing
                    setHistory(prev => [...prev, stemFilePath]);
                    
                    if (onApply) onApply(parsed.output_path);
                    setStatusMsg('FX Applied Successfully!');
                    // Do NOT close automatically if we want to allow Undo
                    // if (onClose) onClose(); 
                }
            } else {
                setStatusMsg(`Error: ${parsed.message}`);
            }

        } catch (e: any) {
            console.error("Apply FX Error:", e);
            setStatusMsg(`Error: ${e.message || 'Unknown error'}`);
        } finally {
            isApplyingRef.current = false;
            setIsApplying(false);
            // Safe cleanup for apply-mode (non-preview) or failure cases
            if (!isPreview) {
                cleanupAllAudio();
            }
        }
    }, [activeModules, loadedVSTs, stemFilePath, onApply, isPro, isFreeMode, refreshEntitlements, cleanupAllAudio, playPreviewAudio, stopAudioElement]);

    // Stop audio only when LIVE mode is turned off (not on every FX tweak while live is off)
    useEffect(() => {
        if (prevLivePreviewRef.current && !livePreview) {
            cleanupAllAudio();
            setStatusMsg('Preview Stopped');
        }
        prevLivePreviewRef.current = livePreview;
    }, [livePreview, cleanupAllAudio]);

    // Live Preview Effect (Pro only) — regenerate when params change while LIVE is on
    useEffect(() => {
        if (isFreeMode && livePreview) {
            setLivePreview(false);
            return;
        }
        if (!livePreview) return;

        if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);

        liveTimeoutRef.current = setTimeout(() => {
            const currentTime = previewAudioRef.current ? previewAudioRef.current.currentTime : 0;
            handleApplyFX(true, currentTime);
        }, 400);

        return () => {
            if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
        };
    }, [activeModules, loadedVSTs, livePreview, isFreeMode, handleApplyFX]);





    // --- Render ---

    return (
        <>
        <VstUpgradeModal
            isOpen={!!upgradePluginId}
            pluginId={upgradePluginId || ''}
            entitlements={vstEntitlements}
            onClose={() => setUpgradePluginId(null)}
            onUnlocked={async () => {
                await refreshEntitlements();
                setUpgradePluginId(null);
                setStatusMsg('Plugin unlocked.');
            }}
        />
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-0 right-4 w-[min(24rem,calc(100vw-2rem))] max-h-[72vh] bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 border-b-0 rounded-t-xl shadow-2xl flex flex-col overflow-hidden z-[200] text-slate-200"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-800/30">
                        <div className="flex items-center gap-2">
                           <span className="text-xs font-bold bg-blue-600 px-1.5 py-0.5 rounded text-white uppercase tracking-wider">{stemType}</span>
                           <h3 className="text-sm font-semibold text-slate-100">Pro FX Rack</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-white transition">✕</button>
                    </div>

                    {isFreeMode && (
                        <div className="px-4 py-2.5 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-amber-950/30">
                            <p className="text-[10px] font-mono text-amber-200/90 leading-relaxed">
                                <span className="text-amber-400 font-bold">PRO FX RACK</span>
                                {' '}— visible in free mode. Preview any chain for{' '}
                                <span className="text-white font-semibold">{FREE_PREVIEW_SECONDS}s random snippet</span>
                                {' '}with your FX chain — upgrade to apply to the full stem.
                            </p>
                        </div>
                    )}

                    {/* Tabs */}
                    <div className={`flex border-b border-slate-700/50 ${isFreeMode ? 'opacity-75' : ''}`}>
                        <button onClick={() => setActiveTab('daw')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'daw' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>DAW Essentials</button>
                        <button onClick={() => setActiveTab('presets')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'presets' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>Presets</button>
                        <button onClick={() => setActiveTab('vst')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'vst' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>VST Plugins</button>
                    </div>

                    {/* Content */}
                    <div className={`flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] relative ${isFreeMode ? 'opacity-60 saturate-50' : ''}`}>
                        {isFreeMode && (
                            <div className="pointer-events-none absolute inset-0 z-10 bg-slate-950/10" aria-hidden />
                        )}
                        
                        {activeTab === 'daw' && (
                            <div className="space-y-3">
                                {activeModules.slice(fxPage * 4, fxPage * 4 + 4).map((mod) => (
                                    <div key={mod.id} className={`rounded-lg border transition-all duration-200 ${mod.enabled ? 'border-blue-500/30 bg-blue-900/10' : 'border-slate-700 bg-slate-800/20 opacity-80'}`}>
                                        <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => toggleModule(mod.id)}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition ${mod.enabled ? 'bg-blue-500 border-blue-400' : 'border-slate-600'}`}>
                                                    {mod.enabled && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {mod.icon}
                                                    <span className={`text-sm font-medium ${mod.enabled ? 'text-white' : 'text-slate-400'}`}>{mod.name}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <AnimatePresence>
                                            {mod.enabled && (
                                                <motion.div 
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="p-3 border-t border-slate-700/30 grid grid-cols-2 gap-4 bg-slate-900/30">
                                                        {mod.params.map(p => (
                                                            <div key={p.id}>
                                                                <div className="flex justify-between text-[10px] mb-1 font-mono">
                                                                    <span className="text-slate-400">{p.label}</span>
                                                                    <span className="text-blue-300">{p.value}{p.unit}</span>
                                                                </div>
                                                                <input
                                                                    type="range"
                                                                    min={p.min}
                                                                    max={p.max}
                                                                    step={p.step}
                                                                    value={p.value}
                                                                    title={`${p.label}: ${p.value}${p.unit}`}
                                                                    onChange={(e) => updateParam(mod.id, p.id, parseFloat(e.target.value))}
                                                                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                ))}

                                {/* Pagination Controls */}
                                <div className="flex justify-between items-center mt-4 pt-2 border-t border-slate-700/50">
                                    <button 
                                        onClick={() => setFxPage(p => Math.max(0, p - 1))}
                                        disabled={fxPage === 0}
                                        className={`text-xs px-2 py-1 rounded transition ${fxPage === 0 ? 'text-slate-600' : 'text-blue-400 hover:bg-slate-800'}`}
                                    >
                                        &lt; Prev Pack
                                    </button>
                                    <span className="text-[10px] text-slate-500 tracking-widest">RACK {fxPage + 1} / {Math.ceil(activeModules.length / 4)}</span>
                                    <button 
                                        onClick={() => setFxPage(p => Math.min(Math.ceil(activeModules.length / 4) - 1, p + 1))}
                                        disabled={fxPage >= Math.ceil(activeModules.length / 4) - 1}
                                        className={`text-xs px-2 py-1 rounded transition ${fxPage >= Math.ceil(activeModules.length / 4) - 1 ? 'text-slate-600' : 'text-blue-400 hover:bg-slate-800'}`}
                                    >
                                        Next Pack &gt;
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'presets' && (
                            <div className="grid grid-cols-2 gap-2">
                                {(STEM_PRESETS[stemType?.toLowerCase()] || STEM_PRESETS['other']).map((preset, idx) => {
                                    const locked = isFreeMode && idx >= 2;
                                    return (
                                    <button 
                                        key={preset.id}
                                        onClick={() => applyPreset(preset.id)}
                                        className={`pl-2 pr-3 py-2 bg-slate-900/40 border rounded flex items-center gap-3 transition group text-left ${
                                            locked
                                                ? 'border-amber-800/30 opacity-70 hover:opacity-90 hover:border-amber-600/40'
                                                : 'border-slate-700/50 hover:bg-slate-800 hover:border-cyan-500/30'
                                        }`}
                                    >
                                        <div className={`p-1 rounded ${locked ? 'bg-slate-800/50' : 'bg-slate-800 group-hover:bg-slate-700'} transition`}>
                                            {preset.icon}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className={`text-[10px] uppercase tracking-widest font-semibold transition ${
                                                locked ? 'text-slate-600' : 'text-slate-400 group-hover:text-cyan-100'
                                            }`}>
                                                {preset.label}
                                                {locked && <span className="ml-1 text-[8px] text-amber-500/60">PRO</span>}
                                            </span>
                                            <span className="text-[9px] text-slate-600 hidden sm:block">
                                                {locked ? 'Preview 5s free · Apply needs Pro' : 'Load chain · Preview or Apply'}
                                            </span>
                                        </div>
                                    </button>
                                    );
                                })}
                            </div>
                        )}

                        {activeTab === 'vst' && (
                            <div className="space-y-4">
                                <div>
                                    <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500 mb-2">Quick Apply</p>
                                    <button
                                        onClick={() => {
                                            const degloss = catalogVsts.find((v) => v.id === 'reverb_degloss')?.path
                                                || loadedVSTs.find((v) => v.id === 'reverb_degloss')?.path;
                                            if (degloss) handleApplyChain([degloss]);
                                        }}
                                        disabled={isFreeMode || !catalogVsts.some((v) => v.id === 'reverb_degloss' && v.path)}
                                        className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
                                            isFreeMode
                                                ? 'border-slate-800/30 opacity-40 cursor-not-allowed'
                                                : 'border-slate-700/50 hover:border-purple-500/30 bg-slate-900/40 hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="text-[10px] font-mono text-slate-300 uppercase tracking-wider">DeGloss Pass</div>
                                        <div className="text-[8px] text-slate-500 mt-0.5">Reduce reverb glare and tighten tails</div>
                                        {isFreeMode && <div className="text-[8px] text-amber-500/60 mt-0.5">PRO</div>}
                                    </button>
                                </div>

                                {(vstLoading || loadedVSTs.length < catalogVsts.length) && (
                                    <div className="text-[9px] font-mono text-slate-500 px-1 py-1.5 border border-slate-800/60 rounded bg-slate-900/40">
                                        Loading plugins {loadedVSTs.length}/{catalogVsts.length}…
                                        <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                                            <div
                                                className="h-full bg-violet-500/70 transition-all duration-300"
                                                style={{ width: `${Math.max(8, catalogVsts.length ? (loadedVSTs.length / catalogVsts.length) * 100 : 8)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {loadedVSTs.length > 0 && (
                                    <div className="space-y-2">
                                        {loadedVSTs.map(vst => {
                                            const pluginStatus = getPluginStatus(vstEntitlements, vst.id);
                                            const owned = isPro || pluginStatus?.owned;
                                            const trialLabel = owned
                                                ? 'UNLOCKED'
                                                : `TRIAL ${pluginStatus?.previews_remaining ?? 3}P / ${pluginStatus?.applies_remaining ?? 2}A`;

                                            return (
                                            <div key={vst.id} className={`flex items-center justify-between p-2 rounded border transition ${vst.enabled ? 'bg-slate-800 border-blue-500/30' : 'bg-slate-900/50 border-slate-700 opacity-70'}`}>
                                                <div 
                                                    className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
                                                    onClick={() => setLoadedVSTs(prev => prev.map(v => v.id === vst.id ? { ...v, enabled: !v.enabled } : v))}
                                                >
                                                    <div className={`w-2 h-2 rounded-full transition ${vst.enabled ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-slate-600'}`} />
                                                    <div className="min-w-0">
                                                        <span className={`text-xs truncate block max-w-[150px] ${vst.enabled ? 'text-white font-medium' : 'text-slate-400'}`}>{vst.name}</span>
                                                        {isCatalogVst(vst.id) && (
                                                            <span className={`text-[9px] font-mono uppercase ${owned ? 'text-emerald-400' : 'text-amber-300'}`}>
                                                                {trialLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {isCatalogVst(vst.id) && !owned && (
                                                    <button
                                                        onClick={() => setUpgradePluginId(vst.id)}
                                                        className="text-[9px] px-2 py-1 rounded border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 transition ml-1"
                                                    >
                                                        Upgrade
                                                    </button>
                                                )}
                                                
                                                <button
                                                    onClick={() => handlePreviewVST(vst)}
                                                    className={`text-[10px] p-1.5 rounded transition ml-2 border ${previewingVstId === vst.id ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-blue-300'}`}
                                                    title={previewingVstId === vst.id ? 'Click to STOP Preview' : 'Open VST GUI & Preview'}
                                                    disabled={!!previewingVstId && previewingVstId !== vst.id}
                                                >
                                                    {previewingVstId === vst.id ? <Square className="w-3 h-3 fill-current text-red-500" /> : <Play className="w-3 h-3 fill-current" />}
                                                </button>
                                            </div>
                                        )})}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer / Actions */}
                    <div className="p-4 border-t border-slate-700/50 bg-slate-800/30 flex items-center justify-between">
                        <span className="text-xs text-slate-400">{statusMsg}</span>
                        <div className="flex gap-2">
                             {history.length > 0 && (
                                <button
                                    onClick={handleUndo}
                                    className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-800 hover:bg-slate-700 text-red-300 border border-slate-700 hover:border-red-500/50 transition flex items-center gap-1"
                                    title="Undo last FX"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                </button>
                             )}
                             
                             {/* Live Preview Toggle — Pro only */}
                             <button
                                onClick={() => !isFreeMode && setLivePreview(!livePreview)}
                                disabled={isFreeMode}
                                title={isFreeMode ? 'Live preview requires Pro' : 'Real-time FX preview'}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1 border ${
                                    isFreeMode
                                        ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                                        : livePreview
                                            ? 'bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_10px_rgba(74,222,128,0.2)]'
                                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                                }`}
                             >
                                <Zap className={`w-3 h-3 ${livePreview && !isFreeMode ? 'fill-current animate-pulse' : ''}`} />
                                LIVE
                             </button>

                             <button
                                onClick={() => handleApplyFX(true)}
                                disabled={isApplying} 
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-2 border ${
                                    isApplying
                                        ? 'bg-slate-800 cursor-not-allowed opacity-50 border-slate-600'
                                        : isFreeMode
                                            ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600 hover:border-blue-400'
                                }`}
                             >
                                <Play className="w-3 h-3 fill-current" />
                                {isFreeMode ? `${FREE_PREVIEW_SECONDS}S PREVIEW` : 'PREVIEW'}
                             </button>
                             <button
                                onClick={() => handleApplyFX(false)}
                                disabled={isApplying || isFreeMode} 
                                title={isFreeMode ? 'Upgrade to Pro to apply FX permanently' : 'Render and apply FX chain'}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-2 ${
                                    isFreeMode
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50 border border-slate-700'
                                        : isApplying
                                            ? 'bg-slate-600 cursor-not-allowed'
                                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                                }`}
                             >
                                {isFreeMode ? 'APPLY — PRO' : isApplying ? 'Processing...' : 'APPLY FX'}
                             </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
        </>
    );
};

export default StemFXMenu;
