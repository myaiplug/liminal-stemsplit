import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface SampleEntry {
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

export interface SplitHistoryFile {
    name: string;
    path: string;
    stemType: string;
    available: boolean;
}

export interface SplitHistoryEntry {
    id: string;
    title: string;
    sourcePath: string;
    outputDirectory: string;
    createdAt: string;
    engine?: string | null;
    model?: string | null;
    files: SplitHistoryFile[];
}

interface SampleBankProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectSample: (sample: SampleEntry) => void;
    onOpenHistoryFile?: (file: SplitHistoryFile, entry: SplitHistoryEntry) => void;
}

function formatHistoryDate(value: string): string {
    if (!value) return '';
    const asNumber = Number(value.replace(/Z$/, ''));
    const date = Number.isFinite(asNumber) && asNumber > 1_000_000_000
        ? new Date(asNumber * 1000)
        : new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const SampleBank: React.FC<SampleBankProps> = ({ isOpen, onClose, onSelectSample, onOpenHistoryFile }) => {
    const [samples, setSamples] = useState<SampleEntry[]>([]);
    const [history, setHistory] = useState<SplitHistoryEntry[]>([]);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        if (!isOpen) return;
        invoke<SampleEntry[]>('list_sample_bank')
            .then(setSamples)
            .catch(console.error);
        invoke<SplitHistoryEntry[]>('list_split_history')
            .then(setHistory)
            .catch((err) => {
                console.warn('Split history unavailable:', err);
                setHistory([]);
            });
    }, [isOpen]);

    const categories = ['all', ...Array.from(new Set(samples.map(s => s.category)))];
    const filtered = filter === 'all' ? samples : samples.filter(s => s.category === filter);

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await invoke('delete_sample_from_bank', { sampleId: id });
        setSamples(prev => prev.filter(s => s.id !== id));
    };

    const revealInFolder = async (filePath: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        try {
            await invoke('reveal_item_in_dir', { path: filePath });
        } catch {
            /* folder reveal is optional */
        }
    };

    const toggleEntry = (id: string) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    if (!isOpen) return null;

    return (
        <div className="absolute top-0 right-0 bottom-0 w-[420px] bg-[#0a0a0c]/95 backdrop-blur-xl border-l border-white/10 z-50 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 className="text-xs font-mono tracking-[0.2em] text-cyan-400 uppercase">Sample Bank</h2>
                <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
            </div>

            <div className="px-4 py-3 border-b border-white/5">
                <div className="text-[9px] font-mono tracking-[0.18em] text-cyan-500/80 uppercase mb-2">Split History</div>
                {history.length === 0 ? (
                    <p className="text-[10px] text-slate-600 font-mono">Completed splits will show up here with every stem file.</p>
                ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                        {history.map(entry => {
                            const open = !!expanded[entry.id];
                            const availableCount = entry.files.filter(file => file.available).length;
                            return (
                                <div key={entry.id} className="rounded-lg border border-white/5 bg-white/[0.02]">
                                    <button
                                        type="button"
                                        onClick={() => toggleEntry(entry.id)}
                                        className="w-full flex items-start gap-2 px-2.5 py-2 text-left hover:bg-white/[0.04]"
                                    >
                                        <span className={`mt-0.5 text-cyan-400 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] text-slate-200 truncate">{entry.title}</div>
                                            <div className="text-[9px] text-slate-500 font-mono">
                                                {formatHistoryDate(entry.createdAt)} · {availableCount}/{entry.files.length} files
                                                {entry.model ? ` · ${entry.model}` : ''}
                                            </div>
                                        </div>
                                    </button>
                                    {open && (
                                        <div className="px-2 pb-2 space-y-1">
                                            {entry.files.map(file => (
                                                <button
                                                    key={`${entry.id}-${file.path}`}
                                                    type="button"
                                                    disabled={!file.available}
                                                    onClick={() => file.available && onOpenHistoryFile?.(file, entry)}
                                                    className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left ${
                                                        file.available
                                                            ? 'hover:bg-cyan-500/10 text-slate-300'
                                                            : 'text-slate-600 cursor-not-allowed'
                                                    }`}
                                                >
                                                    <span className="text-[10px] font-mono truncate">
                                                        {(file.stemType || file.name).toUpperCase()}
                                                    </span>
                                                    <span className="text-[9px] font-mono">
                                                        {file.available ? 'Open in editor' : 'Unavailable'}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setFilter(cat)}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider shrink-0 transition-colors ${
                            filter === cat ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filtered.length === 0 && (
                    <div className="text-center py-8 text-slate-600 text-[10px] font-mono">
                        No samples yet. Drag on a waveform in the editor and save the selection here.
                    </div>
                )}
                {filtered.map(sample => (
                    <div
                        key={sample.id}
                        onClick={() => onSelectSample(sample)}
                        className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors border border-transparent hover:border-white/5"
                    >
                        <div className={`w-1.5 h-8 rounded-full ${
                            sample.stemType === 'drums' ? 'bg-red-500' :
                            sample.stemType === 'bass' ? 'bg-orange-500' :
                            sample.stemType === 'vocals' ? 'bg-pink-500' :
                            'bg-cyan-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-slate-200 truncate">{sample.name}</div>
                            <div className="text-[9px] text-slate-500 font-mono">
                                {sample.bpm > 0 ? `${Math.round(sample.bpm)} BPM` : '---'}
                                {sample.key ? ` · ${sample.key}` : ''}
                                {' · '}{sample.duration.toFixed(1)}s
                            </div>
                        </div>
                        <button
                            onClick={(e) => revealInFolder(sample.path, e)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-cyan-400 text-[10px]"
                            title="Show in folder"
                        >
                            Folder
                        </button>
                        <button
                            onClick={(e) => handleDelete(sample.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs"
                        >
                            &times;
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SampleBank;
