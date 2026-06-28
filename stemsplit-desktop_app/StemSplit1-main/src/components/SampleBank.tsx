// src/components/SampleBank.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---- Types ----
interface SampleEntry {
    id: string;
    name: string;
    path: string;
    category: string;
    bpm: number;
    key: string;
    duration: number;
    stemType: string;
    createdAt: string;
}

interface SampleBankProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectSample?: (sample: SampleEntry) => void;
}

const CATEGORIES = [
    { id: 'all', label: 'All Samples', icon: '⬡' },
    { id: 'vocals_hook', label: 'Hooks', icon: '🎤' },
    { id: 'vocals_verse', label: 'Verses', icon: '📝' },
    { id: 'vocals_chant', label: 'Chants', icon: '🗣' },
    { id: 'vocals_oneshot', label: 'One-Shots', icon: '💥' },
    { id: 'drums_kick', label: 'Kicks', icon: '🥁' },
    { id: 'drums_snare', label: 'Snares', icon: '🔔' },
    { id: 'drums_hihat', label: 'Hi-Hats', icon: '✨' },
    { id: 'drums_percussion', label: 'Percussion', icon: '🪘' },
    { id: 'drums_loop', label: 'Drum Loops', icon: '🎵' },
    { id: 'drums_fill', label: 'Fills', icon: '🎪' },
    { id: 'bass_808', label: '808s', icon: '📢' },
    { id: 'bass_synth', label: 'Synth Bass', icon: '🔊' },
    { id: 'bass_live', label: 'Live Bass', icon: '🎸' },
    { id: 'bass_loop', label: 'Bass Loops', icon: '🔄' },
    { id: 'instrument_synth', label: 'Synth', icon: '🎹' },
    { id: 'instrument_piano', label: 'Piano', icon: '🎼' },
    { id: 'instrument_guitar', label: 'Guitar', icon: '🎸' },
    { id: 'instrument_brass', label: 'Brass', icon: '📯' },
    { id: 'instrument_fx', label: 'FX', icon: '⚡' },
];

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

const SampleBank: React.FC<SampleBankProps> = ({ isOpen, onClose, onSelectSample }) => {
    const [samples, setSamples] = useState<SampleEntry[]>([]);
    const [activeCategory, setActiveCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'bpm'>('date');
    const [previewSample, setPreviewSample] = useState<string | null>(null);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());

    // Load samples
    useEffect(() => {
        if (!isOpen) return;
        const load = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const data = await invoke<SampleEntry[]>('list_sample_bank');
                setSamples(data || []);
            } catch {
                // Demo data if no backend yet
                setSamples([]);
            }
        };
        load();
    }, [isOpen]);

    // Filter + sort
    const filteredSamples = (() => {
        let result = samples;
        if (activeCategory !== 'all') {
            result = result.filter(s => s.category === activeCategory);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.stemType.toLowerCase().includes(q) ||
                s.key.toLowerCase().includes(q)
            );
        }
        switch (sortBy) {
            case 'name': result = [...result].sort((a, b) => a.name.localeCompare(b.name)); break;
            case 'date': result = [...result].sort((a, b) => {
                const tb = parseInt(b.createdAt, 10) || 0;
                const ta = parseInt(a.createdAt, 10) || 0;
                return tb - ta;
            }); break;
            case 'bpm': result = [...result].sort((a, b) => a.bpm - b.bpm); break;
        }
        return result;
    })();

    const handlePreview = useCallback(async (sample: SampleEntry) => {
        if (previewSample === sample.id) {
            if (previewPlaying) {
                audioRef.current?.pause();
                setPreviewPlaying(false);
            } else {
                audioRef.current?.play().catch(() => {});
                setPreviewPlaying(true);
            }
            return;
        }
        try {
            const { convertFileSrc } = await import('@tauri-apps/api/core');
            const url = `${convertFileSrc(sample.path)}?t=${Date.now()}`;
            if (audioRef.current) {
                audioRef.current.pause();
                if (audioRef.current.src.startsWith('blob:')) {
                    URL.revokeObjectURL(audioRef.current.src);
                }
            }
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => setPreviewPlaying(false);
            audio.onpause = () => setPreviewPlaying(false);
            audio.onplay = () => setPreviewPlaying(true);
            await audio.play();
            setPreviewSample(sample.id);
            setPreviewPlaying(true);
        } catch { /* ignore */ }
    }, [previewSample, previewPlaying]);

    const handleToggleSelect = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedSamples(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleDelete = useCallback(async () => {
        if (selectedSamples.size === 0) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            for (const id of selectedSamples) {
                await invoke('delete_sample_from_bank', { sampleId: id });
            }
            setSamples(prev => prev.filter(s => !selectedSamples.has(s.id)));
            setSelectedSamples(new Set());
        } catch (e) { console.error('Delete failed:', e); }
    }, [selectedSamples]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ x: '100%', opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    className="fixed inset-y-0 right-0 z-[110] w-[400px] bg-slate-950/98 backdrop-blur-xl border-l border-slate-800/50 shadow-2xl flex flex-col"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50">
                        <div>
                            <h2 className="text-xs font-mono font-bold text-cyan-400 tracking-[0.2em] uppercase">Sample Bank</h2>
                            <p className="text-[9px] text-slate-500 mt-0.5">{samples.length} samples</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedSamples.size > 0 && (
                                <button onClick={handleDelete}
                                    className="px-2 py-1 rounded text-[9px] font-mono border border-red-500/30 text-red-400/70 hover:text-red-300 hover:bg-red-500/10 transition-all">
                                    Delete ({selectedSamples.size})
                                </button>
                            )}
                            <button onClick={onClose}
                                className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Search + Sort */}
                    <div className="px-4 py-2 border-b border-slate-800/30 flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Search samples..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/40"
                        />
                        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                            className="bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1 text-[9px] font-mono text-slate-400 outline-none">
                            <option value="date">Date</option>
                            <option value="name">Name</option>
                            <option value="bpm">BPM</option>
                        </select>
                    </div>

                    {/* Categories */}
                    <div className="flex-none overflow-x-auto px-4 py-2 border-b border-slate-800/30">
                        <div className="flex gap-1 flex-nowrap">
                            {CATEGORIES.map(cat => (
                                <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                                    className={`px-2 py-0.5 rounded text-[9px] font-mono whitespace-nowrap transition-all ${activeCategory === cat.id
                                        ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400'
                                        : 'border border-slate-800 text-slate-500 hover:text-slate-400 hover:border-slate-700'
                                    }`}>
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sample list */}
                    <div className="flex-1 overflow-y-auto">
                        {filteredSamples.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-600">
                                <svg className="w-12 h-12 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                                </svg>
                                <p className="text-[10px] font-mono">No samples yet</p>
                                <p className="text-[8px] mt-1">EDIT a stem → Save to Sample Bank</p>
                            </div>
                        ) : (
                            filteredSamples.map((sample, i) => (
                                <motion.div
                                    key={sample.id}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.02 }}
                                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/20 hover:bg-cyan-500/5 cursor-pointer transition-all group ${selectedSamples.has(sample.id) ? 'bg-cyan-500/8' : ''}
                                        ${previewSample === sample.id && previewPlaying ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : ''}`}
                                    onClick={() => onSelectSample?.(sample)}
                                >
                                    {/* Select checkbox */}
                                    <button onClick={e => handleToggleSelect(sample.id, e)}
                                        className={`w-4 h-4 rounded border ${selectedSamples.has(sample.id) ? 'bg-cyan-500 border-cyan-500' : 'border-slate-700'} flex items-center justify-center`}>
                                        {selectedSamples.has(sample.id) && (
                                            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                                        )}
                                    </button>

                                    {/* Preview button */}
                                    <button onClick={(e) => { e.stopPropagation(); handlePreview(sample); }}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${previewSample === sample.id && previewPlaying
                                            ? 'bg-cyan-500 text-white' : 'bg-slate-800/50 text-slate-400 group-hover:text-cyan-400 group-hover:bg-cyan-500/20'}`}>
                                        {previewSample === sample.id && previewPlaying ? (
                                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                                        ) : (
                                            <svg className="w-2.5 h-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                        )}
                                    </button>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] font-mono text-slate-300 truncate">{sample.name}</div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[8px] text-slate-500">{formatTime(sample.duration)}</span>
                                            <span className="text-[8px] text-cyan-500/50">{sample.bpm} BPM</span>
                                            <span className="text-[8px] text-purple-500/50">{sample.key}</span>
                                            <span className="text-[8px] text-slate-600">{sample.stemType}</span>
                                        </div>
                                    </div>

                                    {/* Category badge */}
                                    <span className="text-[7px] px-1.5 py-0.5 rounded font-mono border border-slate-700/50 text-slate-500">
                                        {CATEGORIES.find(c => c.id === sample.category)?.label || sample.category}
                                    </span>
                                </motion.div>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-slate-800/50 text-[8px] font-mono text-slate-600 flex items-center justify-between">
                        <span>{filteredSamples.length} of {samples.length} samples</span>
                        <span>Ctrl+Click to multi-select</span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export type { SampleEntry };
export default SampleBank;
