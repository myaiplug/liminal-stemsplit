// src/components/StemFXMenu.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
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
  state?: string;
}

interface StemFXMenuProps {
  stemType: string;
  stemFilePath: string; // File to process
  isOpen: boolean;
  onClose: () => void;
  onApply?: (newPath: string) => void;
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

const USER_VSTS: VSTPlugin[] = [
    {
        id: 'user_vst_1',
        name: 'Reverb De-Gloss',
        path: 'c:\\Users\\b33\\Desktop\\ForSale\\VST\\Reverb De-Gloss.vst3',
        enabled: false
    },
    {
        id: 'user_vst_2',
        name: 'Temporal Pitch Portal',
        path: 'c:\\Users\\b33\\Desktop\\ForSale\\VST\\Temporal Pitch Portal.vst3',
        enabled: false
    },
    {
        id: 'user_vst_3',
        name: 'Vocal Breath Controller',
        path: 'c:\\Users\\b33\\Desktop\\ForSale\\VST\\Vocal Breath Controller.vst3',
        enabled: false
    }
];

const STEM_FX_CHAINS: Record<string, string[]> = {
  vocals: ['pitch', 'gate', 'deesser', 'dereverb', 'filter', 'eq', 'compressor', 'saturation', 'delay', 'reverb', 'loudness', 'stereo-width'],
  drums: ['gate', 'dereverb', 'eq', 'filter', 'compressor', 'saturation', 'phaser', 'chorus', 'loudness', 'reverb'],
  bass: ['gate', 'dereverb', 'compressor', 'eq', 'filter', 'saturation', 'chorus', 'loudness', 'stereo-width'],
  other: ['pitch', 'dereverb', 'filter', 'phaser', 'eq', 'compressor', 'saturation', 'chorus', 'delay', 'reverb', 'stereo-width', 'loudness'],
  piano: ['dereverb', 'eq', 'filter', 'compressor', 'reverb', 'delay', 'stereo-width', 'loudness'],
  guitar: ['gate', 'dereverb', 'pitch', 'eq', 'filter', 'compressor', 'saturation', 'phaser', 'chorus', 'delay', 'reverb', 'loudness']
};

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
STEM_PRESETS['cymbals'] = STEM_PRESETS['drums'];

const QUICK_PRESETS = STEM_PRESETS['vocals']; // Default to avoid errors if used directly somewhere

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

const StemFXMenu: React.FC<StemFXMenuProps> = ({ stemType, stemFilePath, isOpen, onClose, onApply }) => {
    const [activeTab, setActiveTab] = useState<'daw' | 'presets' | 'vst'>('daw');
    const [fxPage, setFxPage] = useState(0); // 0 = first 4, 1 = next 4
    
    // Initialize module list based on stem type
    const [activeModules, setActiveModules] = useState<FXModule[]>(() => {
        // Find which chain to use (default to 'other')
        const chainKey = Object.keys(STEM_FX_CHAINS).find(k => stemType.toLowerCase().includes(k)) || 'other';
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

    const [loadedVSTs, setLoadedVSTs] = useState<VSTPlugin[]>(USER_VSTS);
    const [isApplying, setIsApplying] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [previewingVstId, setPreviewingVstId] = useState<string | null>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [livePreview, setLivePreview] = useState(false);
    
    // Preview Management
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const liveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingPreviewRef = useRef<number>(0); // Track request sequence
    const allAudioInstancesRef = useRef<Set<HTMLAudioElement>>(new Set()); // Track ALL audio instances

    // Helper function to stop and cleanup all audio instances
    const cleanupAllAudio = useCallback(() => {
        // Stop and cleanup all tracked audio instances
        allAudioInstancesRef.current.forEach(audio => {
            try {
                audio.pause();
                audio.src = "";
                audio.load(); // Force release of resources
            } catch (e) {
                console.error("Error cleaning up audio:", e);
            }
        });
        allAudioInstancesRef.current.clear();
        previewAudioRef.current = null;
    }, []);

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
        };
    }, [cleanupAllAudio]);

    // Refresh modules when stemType changes (but only if menu is open or about to open)
    useEffect(() => {
        const chainKey = Object.keys(STEM_FX_CHAINS).find(k => stemType.toLowerCase().includes(k)) || 'other';
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

    const handlePreviewVST = async (vst: VSTPlugin) => {
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
            await invoke('preview_vst_plugin', { vstPath: vst.path, audioPath: stemFilePath });
            setStatusMsg('VST Closed.');
        } catch(e) {
            console.error(e); 
            setStatusMsg('Preview Ended');
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

    const handleLoadVST = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'VST Plugin', extensions: ['dll', 'vst3'] }]
            });
            if (selected && typeof selected === 'string') {
                const name = selected.split(/[\\/]/).pop() || 'Unknown VST';
                setLoadedVSTs(prev => [...prev, { id: `vst_${Date.now()}`, name, path: selected, enabled: true }]);
            }
        } catch (e) {
            console.error('Failed to load VST', e);
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
        // Increment sequence ID to invalidate parallel/pending renders
        const requestId = Date.now();
        pendingPreviewRef.current = requestId;

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
            
            if (enabledModules.length === 0 && enabledVSTs.length === 0) {
                setStatusMsg('No FX selected');
                setIsApplying(false);
                return;
            }

            const fxConfig = {
                preview: isPreview,
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
                    fxJson: fxBase64
                });
            } catch (err: any) {
                console.error("Backend Error:", err);
                setStatusMsg(`Failed: ${typeof err === 'string' ? err : err.message || 'Unknown error'}`);
                setIsApplying(false);
                return;
            }
            
            // Check if this request is still the latest one
            if (isPreview && pendingPreviewRef.current !== requestId) {
                // Determine if we should drop this result
                // Another request started after us, so ignore this result to prevent overlap
                return;
            }

            const parsed = JSON.parse(result);
            if (parsed.status === 'success' && parsed.output_path) {
                if (isPreview) {
                    // Stop previous audio if it exists (for crossfade case)
                    if (previousAudio && !allAudioInstancesRef.current.has(previousAudio)) {
                        previousAudio.pause();
                        previousAudio.src = "";
                        previousAudio = null;
                    }
                    // Clean up any remaining audio (shouldn't be needed but safety check)
                    if (previewAudioRef.current && !allAudioInstancesRef.current.has(previewAudioRef.current)) {
                         previewAudioRef.current.pause();
                         previewAudioRef.current.src = "";
                    }

                    // Play Preview Audio without replacing the waveform file
                    const src = convertFileSrc(parsed.output_path) + `?t=${Date.now()}`;
                    const audio = new Audio(src);
                    
                    // Track this audio instance
                    allAudioInstancesRef.current.add(audio);
                    audio.volume = 0.8;
                    // Loop if live preview is on
                    if (livePreview) audio.loop = true;
                    
                    if (resumeTime >= 0) {
                        // Ensure we don't start past duration
                        if (!Number.isFinite(audio.duration) || resumeTime < audio.duration) {
                             audio.currentTime = resumeTime;
                        } else {
                             audio.currentTime = 0;
                        }
                    }

                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                        playPromise
                        .then(() => {
                            setStatusMsg('Playing Preview...');
                        })
                        .catch(e => {
                             console.error("Playback failed:", e);
                             setStatusMsg('Playback Failed');
                        });
                    }

                    previewAudioRef.current = audio;
                    
                    // Clean up this instance when it ends
                    audio.onended = () => {
                        if (!livePreview) setStatusMsg('Preview Ended.');
                        // Remove from tracking set
                        allAudioInstancesRef.current.delete(audio);
                    };
                    
                    // Also cleanup if there's an error
                    audio.onerror = () => {
                        allAudioInstancesRef.current.delete(audio);
                    };
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
            setIsApplying(false);
            // Safe cleanup for apply-mode (non-preview) or failure cases
            if (!isPreview) {
                cleanupAllAudio();
            }
        }
    }, [activeModules, loadedVSTs, stemFilePath, livePreview, onApply, setStatusMsg, setIsApplying, setHistory, cleanupAllAudio]);

    // Live Preview Effect
    useEffect(() => {
        if (!livePreview) {
            // Stop preview if turned off - clean up ALL instances
            cleanupAllAudio();
            setStatusMsg('Preview Stopped');
            return;
        }
        
        // Debounce
        if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
        
        liveTimeoutRef.current = setTimeout(() => {
            const currentTime = previewAudioRef.current ? previewAudioRef.current.currentTime : 0;
            handleApplyFX(true, currentTime); 
        }, 400); // 400ms debounce for responsiveness
        
        return () => {
             if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
        };
    }, [activeModules, loadedVSTs, livePreview, cleanupAllAudio, handleApplyFX]); // Trigger on any param change





    // --- Render ---

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-24 right-4 w-96 max-h-[80vh] bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-xl shadow-2xl flex flex-col overflow-hidden z-50 text-slate-200"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-800/30">
                        <div className="flex items-center gap-2">
                           <span className="text-xs font-bold bg-blue-600 px-1.5 py-0.5 rounded text-white uppercase tracking-wider">{stemType}</span>
                           <h3 className="text-sm font-semibold text-slate-100">Pro FX Rack</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-white transition">✕</button>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-slate-700/50">
                        <button onClick={() => setActiveTab('daw')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'daw' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>DAW Essentials</button>
                        <button onClick={() => setActiveTab('presets')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'presets' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>Presets</button>
                        <button onClick={() => setActiveTab('vst')} className={`flex-1 py-2 text-xs font-medium transition ${activeTab === 'vst' ? 'text-blue-400 border-b-2 border-blue-500 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>VST Plugins</button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px]">
                        
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
                                {(STEM_PRESETS[stemType?.toLowerCase()] || STEM_PRESETS['other']).map(preset => (
                                    <button 
                                        key={preset.id}
                                        onClick={() => applyPreset(preset.id)}
                                        className="pl-2 pr-3 py-2 bg-slate-900/40 border border-slate-700/50 hover:bg-slate-800 hover:border-cyan-500/30 rounded flex items-center gap-3 transition group text-left"
                                    >
                                        <div className="p-1 rounded bg-slate-800 group-hover:bg-slate-700 transition">
                                            {preset.icon}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 group-hover:text-cyan-100 transition">{preset.label}</span>
                                            <span className="text-[9px] text-slate-600 group-hover:text-slate-500 hidden sm:block">Apply Chain</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {activeTab === 'vst' && (
                            <div className="space-y-4">
                                <button 
                                    onClick={handleLoadVST}
                                    className="w-full py-3 border border-dashed border-slate-600 rounded-lg text-slate-400 hover:text-white hover:border-blue-500 hover:bg-blue-500/10 transition flex items-center justify-center gap-2"
                                >
                                    <span>+</span> Load VST Plugin (.dll / .vst3)
                                </button>
                                
                                {loadedVSTs.length > 0 && (
                                    <div className="space-y-2">
                                        {loadedVSTs.map(vst => (
                                            <div key={vst.id} className={`flex items-center justify-between p-2 rounded border transition ${vst.enabled ? 'bg-slate-800 border-blue-500/30' : 'bg-slate-900/50 border-slate-700 opacity-70'}`}>
                                                <div 
                                                    className="flex items-center gap-2 flex-1 cursor-pointer"
                                                    onClick={() => setLoadedVSTs(prev => prev.map(v => v.id === vst.id ? { ...v, enabled: !v.enabled } : v))}
                                                >
                                                    <div className={`w-2 h-2 rounded-full transition ${vst.enabled ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-slate-600'}`} />
                                                    <span className={`text-xs truncate max-w-[180px] ${vst.enabled ? 'text-white font-medium' : 'text-slate-400'}`}>{vst.name}</span>
                                                </div>
                                                
                                                <button
                                                    onClick={() => handlePreviewVST(vst)}
                                                    className={`text-[10px] p-1.5 rounded transition ml-2 border ${previewingVstId === vst.id ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-blue-300'}`}
                                                    title={previewingVstId === vst.id ? 'Click to STOP Preview' : 'Open VST GUI & Preview'}
                                                    disabled={!!previewingVstId && previewingVstId !== vst.id}
                                                >
                                                    {previewingVstId === vst.id ? <Square className="w-3 h-3 fill-current text-red-500" /> : <Play className="w-3 h-3 fill-current" />}
                                                </button>

                                                {!USER_VSTS.some(u => u.id === vst.id) && (
                                                    <button 
                                                        onClick={() => setLoadedVSTs(prev => prev.filter(v => v.id !== vst.id))}
                                                        className="text-[10px] text-slate-500 hover:text-red-400 px-2"
                                                        title="Remove Plugin"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
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
                             
                             {/* Live Preview Toggle */}
                             <button
                                onClick={() => setLivePreview(!livePreview)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1 border ${livePreview ? 'bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_10px_rgba(74,222,128,0.2)]' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                             >
                                <Zap className={`w-3 h-3 ${livePreview ? 'fill-current animate-pulse' : ''}`} />
                                LIVE
                             </button>

                             <button
                                onClick={() => handleApplyFX(true)}
                                disabled={isApplying} 
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-2 border border-slate-600 hover:border-blue-400 ${isApplying ? 'bg-slate-800 cursor-not-allowed opacity-50' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'}`}
                             >
                                <Play className="w-3 h-3 fill-current" /> PREVIEW
                             </button>
                             <button
                                onClick={() => handleApplyFX(false)}
                                disabled={isApplying} 
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-2 ${isApplying ? 'bg-slate-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}`}
                             >
                                {isApplying ? 'Processing...' : 'APPLY FX'}
                             </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default StemFXMenu;
