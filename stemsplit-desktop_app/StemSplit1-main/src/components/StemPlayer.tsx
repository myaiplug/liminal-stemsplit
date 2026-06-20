// src/components/StemPlayer.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StemFXMenu from './StemFXMenu';
import CanvasWaveform, { CanvasWaveformHandle } from './CanvasWaveform';

// --- Types ---
type StemType = 'vocals' | 'drums' | 'bass' | 'other' | 'piano' | 'guitar' | 'kick' | 'snare' | 'toms' | 'cymbals' | 'instrumental';

interface StemPlayerProps {
    stemName: string;
    filePath: string;
    duration: number;
    purityScore?: number;
    index: number;
    deferLoadMs?: number;
    isFxOpen?: boolean;
    onToggleFX?: () => void;
    onResplitStem?: () => void;
    fxDisabled?: boolean;
    resplitDisabled?: boolean;
}

const stemColors: Record<string, { wave: string; progress: string; border: string; text: string; glow: string; bg: string }> = {
    vocals:       { wave: '#a78bfa', progress: '#c084fc', border: 'border-purple-500/30', text: 'text-purple-400',  glow: 'shadow-purple-500/20', bg: 'bg-purple-500' },
    drums:        { wave: '#f87171', progress: '#fb923c', border: 'border-red-500/30',    text: 'text-red-400',     glow: 'shadow-red-500/20',    bg: 'bg-red-500' },
    bass:         { wave: '#60a5fa', progress: '#38bdf8', border: 'border-blue-500/30',   text: 'text-blue-400',    glow: 'shadow-blue-500/20',   bg: 'bg-blue-500' },
    other:        { wave: '#facc15', progress: '#a3e635', border: 'border-yellow-500/30', text: 'text-yellow-400',  glow: 'shadow-yellow-500/20', bg: 'bg-yellow-500' },
    piano:        { wave: '#e879f9', progress: '#d946ef', border: 'border-fuchsia-500/30',text: 'text-fuchsia-400', glow: 'shadow-fuchsia-500/20',bg: 'bg-fuchsia-500' },
    guitar:       { wave: '#fb923c', progress: '#f97316', border: 'border-orange-500/30', text: 'text-orange-400',  glow: 'shadow-orange-500/20', bg: 'bg-orange-500' },
    kick:         { wave: '#ef4444', progress: '#dc2626', border: 'border-red-600/30',    text: 'text-red-500',     glow: 'shadow-red-600/20',    bg: 'bg-red-600' },
    snare:        { wave: '#fbbf24', progress: '#f59e0b', border: 'border-amber-500/30',  text: 'text-amber-400',   glow: 'shadow-amber-500/20',  bg: 'bg-amber-500' },
    toms:         { wave: '#818cf8', progress: '#6366f1', border: 'border-indigo-500/30', text: 'text-indigo-400',  glow: 'shadow-indigo-500/20', bg: 'bg-indigo-500' },
    cymbals:      { wave: '#7dd3fc', progress: '#38bdf8', border: 'border-sky-400/30',    text: 'text-sky-400',     glow: 'shadow-sky-400/20',    bg: 'bg-sky-400' },
    instrumental: { wave: '#34d399', progress: '#10b981', border: 'border-emerald-500/30',text: 'text-emerald-400', glow: 'shadow-emerald-500/20',bg: 'bg-emerald-500' },
};
const defaultColors = stemColors.other;

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

const StemPlayer: React.FC<StemPlayerProps> = ({ stemName, filePath, duration, purityScore, index, deferLoadMs = 0, isFxOpen, onToggleFX, onResplitStem, fxDisabled = false, resplitDisabled = false }) => {
    const colors = stemColors[stemName] || defaultColors;

    const [currentFilePath, setCurrentFilePath] = useState(filePath);
    useEffect(() => setCurrentFilePath(filePath), [filePath]);

    const [localShowFX, setLocalShowFX] = useState(false);
    const showFX = isFxOpen !== undefined ? isFxOpen : localShowFX;
    const toggleFX = onToggleFX || (() => setLocalShowFX(prev => !prev));

    useEffect(() => {
        if (!fxDisabled || !showFX) return;
        if (onToggleFX) onToggleFX();
        else setLocalShowFX(false);
    }, [fxDisabled, showFX, onToggleFX]);

    const canvasWaveformRef = useRef<CanvasWaveformHandle>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [totalDuration, setTotalDuration] = useState(duration || 0);
    const [volume, setVolume] = useState(0.85);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [loadProgress, setLoadProgress] = useState(0);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Volume / mute sync to CanvasWaveform
    useEffect(() => {
        canvasWaveformRef.current?.setVolume(isMuted ? 0 : volume);
    }, [volume, isMuted]);

    const togglePlay = useCallback(() => {
        canvasWaveformRef.current?.playPause();
    }, []);

    const handleStop = useCallback(() => {
        canvasWaveformRef.current?.stop();
    }, []);

    const skipForward = useCallback(() => {
        const cw = canvasWaveformRef.current;
        if (!cw) return;
        const d = cw.getDuration();
        const t = Math.min(d, cw.getCurrentTime() + 5);
        cw.seekTo(t / d);
    }, []);

    const skipBack = useCallback(() => {
        const cw = canvasWaveformRef.current;
        if (!cw) return;
        const d = cw.getDuration();
        const t = Math.max(0, cw.getCurrentTime() - 5);
        cw.seekTo(t / d);
    }, []);

    const handleDownload = useCallback(async () => {
        if (!filePath) return;
        try {
            const { isTauriRuntime } = await import('@/lib/tauri-runtime');
            if (isTauriRuntime()) {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_results_folder', { path: filePath.replace(/[/\\][^/\\]+$/, '') });
            }
        } catch (err) {
            console.error('Download failed:', err);
        }
    }, [filePath]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, delay: index * 0.06 }}
            className={`relative rounded-xl border ${colors.border} bg-slate-900/60 backdrop-blur-md shadow-lg ${colors.glow}`}
        >
            {/* Header Row */}
            <div className="flex items-center justify-between px-3 py-1.5">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${colors.bg} ${isPlaying ? 'animate-pulse' : 'opacity-60'}`}
                         style={{ boxShadow: isPlaying ? `0 0 8px ${colors.wave}` : 'none' }}
                    />
                    <span className={`text-[11px] font-mono font-bold uppercase tracking-[0.15em] ${colors.text}`}>
                        {stemName}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                        {formatTime(currentTime)}
                    </span>
                    <span className="text-[10px] font-mono text-slate-600">/</span>
                    <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {formatTime(totalDuration)}
                    </span>
                </div>
            </div>

            {/* Waveform — CanvasWaveform only */}
            <div className="relative px-3 py-1">
                <CanvasWaveform
                    ref={canvasWaveformRef}
                    filePath={currentFilePath}
                    height={48}
                    waveColor={colors.wave}
                    progressColor={colors.progress}
                    onReady={(dur) => {
                        setTotalDuration(dur);
                        setLoadProgress(100);
                        setIsReady(true);
                    }}
                    onTimeUpdate={(t) => setCurrentTime(t)}
                    onPlayStateChange={(p) => setIsPlaying(p)}
                    onLoadError={() => setLoadError('waveform')}
                />
            </div>

            {/* Controls */}
            <div className="px-3 pb-2 pt-1 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <button onClick={skipBack} disabled={!isReady}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30" title="Back 5s">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 12l8.5 6V6l-8.5 6z"/></svg>
                    </button>
                    <button onClick={handleStop} disabled={!isReady}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30" title="Stop">
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                    </button>
                    <button onClick={togglePlay} disabled={!isReady}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-400/50 hover:text-cyan-300 transition-all disabled:opacity-30 shadow-[0_0_8px_rgba(34,211,238,0.15)]" title={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                        ) : (
                            <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        )}
                    </button>
                    <button onClick={skipForward} disabled={!isReady}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30" title="Forward 5s">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setIsMuted(!isMuted)} className="text-slate-500 hover:text-cyan-400 transition-colors" title={isMuted ? 'Unmute' : 'Mute'}>
                        {isMuted || volume === 0 ? (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
                            </svg>
                        ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                            </svg>
                        )}
                    </button>
                    <input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume}
                        onChange={e => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
                        className="stem-vol-slider w-14 h-1 accent-cyan-400" title={`Volume: ${Math.round(volume * 100)}%`}
                    />
                    {!fxDisabled && (
                        <button onClick={() => toggleFX()}
                            className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition-all ${showFX ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300' : 'border border-slate-700 text-slate-500 hover:text-cyan-400 hover:border-cyan-700'}`}>
                            FX
                        </button>
                    )}
                    {onResplitStem && !resplitDisabled && (
                        <button onClick={onResplitStem}
                            className="px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border border-purple-500/30 text-purple-400/70 hover:text-purple-300 hover:bg-purple-500/10 transition-all" title="Re-split this stem">
                            RE-SPLIT
                        </button>
                    )}
                </div>
            </div>

            {/* FX Menu */}
            <AnimatePresence>
                {showFX && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                    >
                        <StemFXMenu
                            stemType={stemName}
                            stemFilePath={currentFilePath}
                            isOpen={showFX}
                            onClose={() => toggleFX()}
                            onApply={(newPath) => setCurrentFilePath(newPath)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default React.memo(StemPlayer);
