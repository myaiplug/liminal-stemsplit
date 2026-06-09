// src/components/StemPlayer.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import WaveSurfer from 'wavesurfer.js';
import StemFXMenu from './StemFXMenu';

// --- Types ---
type StemType = 'vocals' | 'drums' | 'bass' | 'other' | 'piano' | 'guitar' | 'kick' | 'snare' | 'toms' | 'cymbals' | 'instrumental';

interface StemPlayerProps {
    stemName: string;
    filePath: string;
    duration: number;
    purityScore?: number;
    index: number;  // for staggered slide-in
    isFxOpen?: boolean;        // controlled from parent (single FX at a time)
    onToggleFX?: () => void;   // parent callback to toggle FX
    onResplitStem?: () => void; // New: Callback to re-process this stem as input
    fxDisabled?: boolean;
    resplitDisabled?: boolean;
}

// Stem type color map
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

// Format time in MM:SS.ms
function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

const StemPlayer: React.FC<StemPlayerProps> = ({ stemName, filePath, duration, purityScore, index, isFxOpen, onToggleFX, onResplitStem, fxDisabled = false, resplitDisabled = false }) => {
    const colors = stemColors[stemName] || defaultColors;
    const stemType = stemName as StemType;

    // Local file override for FX
    const [currentFilePath, setCurrentFilePath] = useState(filePath);
    // Sync if prop changes (e.g. new separation)
    useEffect(() => setCurrentFilePath(filePath), [filePath]);

    // FX state: use parent-controlled if provided, otherwise local
    const [localShowFX, setLocalShowFX] = useState(false);
    const showFX = isFxOpen !== undefined ? isFxOpen : localShowFX;
    const toggleFX = onToggleFX || (() => setLocalShowFX(prev => !prev));

    useEffect(() => {
        if (!fxDisabled || !showFX) return;
        if (onToggleFX) onToggleFX();
        else setLocalShowFX(false);
    }, [fxDisabled, showFX, onToggleFX]);

    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const waveRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);

    // State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [totalDuration, setTotalDuration] = useState(duration || 0);
    const [volume, setVolume] = useState(0.85);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [isSolo, setIsSolo] = useState(false);
    const [loadProgress, setLoadProgress] = useState(0);

    // Selection state
    const [selectionStart, setSelectionStart] = useState<number | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Initialize WaveSurfer
    useEffect(() => {
        if (!waveRef.current) return;
        let cancelled = false;
        let blobUrl: string | null = null;

        const initWaveSurfer = async () => {
            // Use asset protocol for instant loading (Direct disk stream)
            // DO NOT use readBinaryFile (IPC bridge is too slow for large audio)
            let audioUrl = convertFileSrc(currentFilePath);

            if (cancelled || !waveRef.current) return;

            const ws = WaveSurfer.create({
                container: waveRef.current,
                height: 48,
                waveColor: colors.wave,
                progressColor: colors.progress,
                cursorColor: '#22d3ee',
                cursorWidth: 1,
                barWidth: 2,
                barGap: 1,
                barRadius: 1,
                normalize: true,
                fillParent: true,
                minPxPerSec: 1,
                autoScroll: false,
                hideScrollbar: true,
            });

            ws.on('ready', () => {
                if (cancelled) return;
                setTotalDuration(ws.getDuration());
                setLoadProgress(100);
                setIsReady(true);
                ws.setVolume(volume);
            });

            ws.on('loading', (pct: number) => {
                if (!cancelled) setLoadProgress(pct);
            });

            ws.on('audioprocess', () => {
                if (!cancelled) setCurrentTime(ws.getCurrentTime());
            });

            ws.on('seeking', () => {
                if (!cancelled) setCurrentTime(ws.getCurrentTime());
            });

            ws.on('play', () => { if (!cancelled) setIsPlaying(true); });
            ws.on('pause', () => { if (!cancelled) setIsPlaying(false); });
            ws.on('finish', () => { if (!cancelled) { setIsPlaying(false); setCurrentTime(0); } });

            ws.on('error', (err) => {
                if (!cancelled) {
                    console.warn(`[StemPlayer] ${stemName} load error:`, err);
                    setLoadError('Failed to load audio');
                }
            });

            ws.on('interaction', () => {
                if (!cancelled) {
                    setSelectionStart(null);
                    setSelectionEnd(null);
                }
            });

            wsRef.current = ws;

            try {
                await ws.load(audioUrl);
            } catch (err: any) {
                // AbortError is expected when component unmounts during load
                if (!cancelled && err?.name !== 'AbortError') {
                    console.warn(`[StemPlayer] ${stemName} load failed:`, err);
                    setLoadError('Failed to load audio');
                }
            }
        };

        initWaveSurfer();

        return () => {
            cancelled = true;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            try { wsRef.current?.destroy(); } catch { /* ignore AbortError on cleanup */ }
            wsRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFilePath]); // Updated dependency

    // Volume sync
    useEffect(() => {
        if (wsRef.current && isReady) {
            wsRef.current.setVolume(isMuted ? 0 : volume);
        }
    }, [volume, isMuted, isReady]);

    // --- Controls ---
    const togglePlay = useCallback(() => {
        if (!wsRef.current) return;
        wsRef.current.playPause();
    }, []);

    const handleStop = useCallback(() => {
        if (!wsRef.current) return;
        wsRef.current.stop();
        setIsPlaying(false);
        setCurrentTime(0);
    }, []);

    const toggleMute = useCallback(() => {
        setIsMuted(prev => !prev);
    }, []);

    const skipForward = useCallback(() => {
        if (!wsRef.current) return;
        const t = Math.min(wsRef.current.getCurrentTime() + 5, totalDuration);
        wsRef.current.seekTo(t / totalDuration);
    }, [totalDuration]);

    const skipBack = useCallback(() => {
        if (!wsRef.current) return;
        const t = Math.max(wsRef.current.getCurrentTime() - 5, 0);
        wsRef.current.seekTo(t / totalDuration);
    }, [totalDuration]);

    // Download stem
    const handleDownload = useCallback(async () => {
        if (!filePath) return;
        try {
            const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
            if (isTauri) {
                // Open the file with system default or copy to downloads
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_results_folder', { path: filePath.replace(/[/\\][^/\\]+$/, '') });
            }
        } catch (err) {
            console.error('Download failed:', err);
        }
    }, [filePath]);

    // Selection drag on waveform
    const handleWaveMouseDown = useCallback((e: React.MouseEvent) => {
        if (!waveRef.current || !wsRef.current) return;
        const rect = waveRef.current.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        const time = pct * totalDuration;
        setSelectionStart(time);
        setSelectionEnd(null);

        const handleMouseMove = (ev: MouseEvent) => {
            const movePct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            setSelectionEnd(movePct * totalDuration);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [totalDuration]);

    // Selection overlay position
    const selectionOverlay = useMemo(() => {
        if (selectionStart === null || selectionEnd === null || totalDuration === 0) return null;
        const left = Math.min(selectionStart, selectionEnd) / totalDuration * 100;
        const width = Math.abs(selectionEnd - selectionStart) / totalDuration * 100;
        if (width < 0.5) return null; // too small
        return { left: `${left}%`, width: `${width}%` };
    }, [selectionStart, selectionEnd, totalDuration]);

    // Trim to selection
    const handleTrim = useCallback(() => {
        if (selectionStart === null || selectionEnd === null || !wsRef.current) return;
        const start = Math.min(selectionStart, selectionEnd);
        const end = Math.max(selectionStart, selectionEnd);
        // Seek to start of selection and play it
        wsRef.current.seekTo(start / totalDuration);
        console.log(`[StemPlayer] Trim region: ${formatTime(start)} → ${formatTime(end)}`);
        // TODO: wire to actual audio trim backend
    }, [selectionStart, selectionEnd, totalDuration]);

    // Cut selection (remove region)
    const handleCut = useCallback(() => {
        if (selectionStart === null || selectionEnd === null) return;
        const start = Math.min(selectionStart, selectionEnd);
        const end = Math.max(selectionStart, selectionEnd);
        console.log(`[StemPlayer] Cut region: ${formatTime(start)} → ${formatTime(end)}`);
        // TODO: wire to actual audio cut backend
        setSelectionStart(null);
        setSelectionEnd(null);
    }, [selectionStart, selectionEnd]);

    const hasSelection = selectionStart !== null && selectionEnd !== null && Math.abs(selectionEnd - selectionStart) > 0.05;

    return (
        <motion.div
            ref={containerRef}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ 
                duration: 0.45,
                delay: index * 0.12,
                ease: [0.23, 1, 0.32, 1] 
            }}
            className="w-full"
        >
            {/* Main Container */}
            <div className={`relative rounded-t-lg ${showFX ? '' : 'rounded-b-lg'} border ${colors.border} overflow-hidden shadow-lg ${colors.glow} transition-all duration-300`}
                 style={{
                     background: 'linear-gradient(135deg, rgba(2,6,23,0.92) 0%, rgba(8,15,40,0.95) 50%, rgba(2,6,23,0.92) 100%)',
                     backdropFilter: 'blur(16px)',
                     boxShadow: (isPlaying && !isMuted) ? `0 0 25px ${colors.glow.replace('shadow-', '').split('/')[0]}30` : undefined,
                     borderColor: (isPlaying && !isMuted) ? colors.wave : undefined,
                 }}
            >
                {/* Top accent line */}
                <div className="h-[1px] w-full" style={{
                    background: `linear-gradient(90deg, transparent 0%, ${colors.wave}44 30%, ${colors.wave}88 50%, ${colors.wave}44 70%, transparent 100%)`,
                }} />

                {/* Header Row */}
                <div className="flex items-center justify-between px-3 py-1.5">
                    {/* Left: Stem name + status */}
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${colors.bg} ${isPlaying ? 'animate-pulse' : 'opacity-60'}`}
                             style={{ boxShadow: isPlaying ? `0 0 8px ${colors.wave}` : 'none' }}
                        />
                        <span className={`text-[11px] font-mono font-bold uppercase tracking-[0.15em] ${colors.text}`}>
                            {stemName}
                        </span>
                        {purityScore !== undefined && (
                            <span className="text-[8px] font-mono text-emerald-400/70 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                {purityScore}% pure
                            </span>
                        )}
                    </div>

                    {/* Right: Time display */}
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

                {/* Waveform Area */}
                <div className="relative px-3 py-1" onMouseDown={handleWaveMouseDown}>
                    {/* Waveform container */}
                    <div 
                        ref={waveRef} 
                        className={`w-full cursor-crosshair transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}
                    />

                    {/* Futuristic waveform loader */}
                    {!isReady && !loadError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {/* Fake waveform bars with traveling dots */}
                            <div className="relative w-full h-10 flex items-center justify-center overflow-hidden px-2">
                                {/* Static waveform ghost bars */}
                                <div className="flex items-end gap-[1.5px] h-10 w-full justify-center">
                                    {Array.from({ length: 60 }).map((_, i) => {
                                        const barH = 3 + Math.sin(i * 0.3) * 8 + Math.cos(i * 0.7) * 6;
                                        return (
                                            <div
                                                key={i}
                                                className="rounded-full flex-shrink-0"
                                                style={{
                                                    width: 2,
                                                    height: `${Math.max(3, barH)}px`,
                                                    backgroundColor: `${colors.wave}15`,
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                                {/* Scan line sweeping left to right */}
                                <motion.div
                                    className="absolute top-0 bottom-0 w-[2px] pointer-events-none"
                                    style={{
                                        background: `linear-gradient(180deg, transparent 0%, ${colors.wave}88 40%, ${colors.wave} 50%, ${colors.wave}88 60%, transparent 100%)`,
                                        boxShadow: `0 0 8px ${colors.wave}66, 0 0 16px ${colors.wave}33`,
                                    }}
                                    animate={{ left: ['0%', '100%'] }}
                                    transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                                />
                                {/* Traveling dot particles along the waveform */}
                                {[0, 1, 2, 3, 4].map(d => (
                                    <motion.div
                                        key={`dot-${d}`}
                                        className="absolute rounded-full"
                                        style={{
                                            width: 3,
                                            height: 3,
                                            backgroundColor: colors.wave,
                                            boxShadow: `0 0 6px ${colors.wave}`,
                                            top: `${30 + Math.sin(d * 1.8) * 20}%`,
                                        }}
                                        animate={{ left: ['-2%', '102%'], opacity: [0, 1, 1, 0] }}
                                        transition={{
                                            duration: 2.2 + d * 0.3,
                                            repeat: Infinity,
                                            delay: d * 0.4,
                                            ease: 'linear',
                                        }}
                                    />
                                ))}
                            </div>
                            {/* Progress percentage */}
                            <div className="flex items-center gap-2 mt-1">
                                {/* Mini progress track */}
                                <div className="w-16 h-[2px] rounded-full bg-slate-800 overflow-hidden">
                                    <motion.div
                                        className="h-full rounded-full"
                                        style={{ backgroundColor: colors.wave }}
                                        animate={{ width: `${loadProgress}%` }}
                                        transition={{ duration: 0.3 }}
                                    />
                                </div>
                                <span className="text-[8px] font-mono tabular-nums" style={{ color: `${colors.wave}99` }}>
                                    {loadProgress}%
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Load error */}
                    {loadError && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] font-mono text-red-400/80">{loadError}</span>
                        </div>
                    )}

                    {/* Selection overlay */}
                    {selectionOverlay && (
                        <div
                            className="absolute top-0 bottom-0 pointer-events-none z-10"
                            style={{
                                left: selectionOverlay.left,
                                width: selectionOverlay.width,
                                background: `${colors.wave}18`,
                                borderLeft: `1px solid ${colors.wave}66`,
                                borderRight: `1px solid ${colors.wave}66`,
                            }}
                        >
                            {/* Selection time labels */}
                            <div className="absolute -top-0.5 left-0 text-[7px] font-mono px-1 rounded" style={{ color: colors.wave, backgroundColor: 'rgba(2,6,23,0.9)' }}>
                                {selectionStart !== null && selectionEnd !== null && formatTime(Math.min(selectionStart, selectionEnd))}
                            </div>
                            <div className="absolute -top-0.5 right-0 text-[7px] font-mono px-1 rounded" style={{ color: colors.wave, backgroundColor: 'rgba(2,6,23,0.9)' }}>
                                {selectionStart !== null && selectionEnd !== null && formatTime(Math.max(selectionStart, selectionEnd))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between px-3 pb-2 pt-1">
                    {/* Left: Transport */}
                    <div className="flex items-center gap-1">
                        {/* Skip Back */}
                        <ControlBtn onClick={skipBack} title="Back 5s" disabled={!isReady}>
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1L1 6l5 5V1zM12 1L7 6l5 5V1z"/></svg>
                        </ControlBtn>

                        {/* Play / Pause */}
                        <ControlBtn onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} disabled={!isReady} accent={colors.wave} isMain>
                            {isPlaying ? (
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" rx="0.5"/><rect x="7" y="1" width="3" height="10" rx="0.5"/></svg>
                            ) : (
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5l7 4.5-7 4.5V1.5z"/></svg>
                            )}
                        </ControlBtn>

                        {/* Stop */}
                        <ControlBtn onClick={handleStop} title="Stop" disabled={!isReady}>
                            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="0.5"/></svg>
                        </ControlBtn>

                        {/* Skip Forward */}
                        <ControlBtn onClick={skipForward} title="Forward 5s" disabled={!isReady}>
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M0 1l5 5-5 5V1zM6 1l5 5-5 5V1z"/></svg>
                        </ControlBtn>

                        {/* Divider */}
                        <div className="w-px h-4 bg-slate-700/50 mx-1" />

                        {/* Volume */}
                        <ControlBtn onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'} disabled={!isReady}>
                            {isMuted ? (
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M1 4.5h2l3-3v9l-3-3H1v-3z" opacity="0.4"/><path d="M9 3.5l3 3M12 3.5l-3 3" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
                            ) : (
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M1 4.5h2l3-3v9l-3-3H1v-3z"/><path d="M9 4a3 3 0 010 4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6"/></svg>
                            )}
                        </ControlBtn>
                        <input
                            type="range"
                            min={0} max={1} step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={e => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
                            className="w-16 h-1 appearance-none bg-slate-800 rounded-full outline-none cursor-pointer pro-fader"
                            style={{
                                background: `linear-gradient(to right, ${colors.wave} 0%, ${colors.wave} ${(isMuted ? 0 : volume) * 100}%, #1e293b ${(isMuted ? 0 : volume) * 100}%, #1e293b 100%)`,
                            }}
                            title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                        />
                    </div>

                    {/* Center: Selection tools */}
                    <div className="flex items-center gap-1">
                        <AnimatePresence>
                            {hasSelection && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    className="flex items-center gap-1"
                                >
                                    <ControlBtn onClick={handleTrim} title="Trim to selection" disabled={!isReady}>
                                        <span className="text-[8px] font-mono">TRIM</span>
                                    </ControlBtn>
                                    <ControlBtn onClick={handleCut} title="Cut selection" disabled={!isReady}>
                                        <span className="text-[8px] font-mono">CUT</span>
                                    </ControlBtn>
                                    <ControlBtn onClick={() => { setSelectionStart(null); setSelectionEnd(null); }} title="Clear selection">
                                        <span className="text-[8px] font-mono text-slate-500">CLR</span>
                                    </ControlBtn>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Right: FX + Download + Solo */}
                    <div className="flex items-center gap-1">
                        {/* Re-split button */}
                        <ControlBtn 
                            onClick={onResplitStem || (() => {})} 
                            title={resplitDisabled ? 'Re-split is Pro-only' : 'Split this stem further'} 
                            disabled={!onResplitStem || resplitDisabled}
                        >
                           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                <line x1="12" y1="22.08" x2="12" y2="12"></line>
                           </svg>
                        </ControlBtn>

                        <ControlBtn 
                            onClick={() => { if (!fxDisabled) toggleFX(); }} 
                            title={fxDisabled ? 'FX is Pro-only' : 'FX Chain'} 
                            active={!fxDisabled && showFX}
                            disabled={fxDisabled}
                            accent={showFX ? colors.wave : undefined}
                        >
                            <span className="text-[8px] font-mono font-bold">FX</span>
                        </ControlBtn>

                        <ControlBtn 
                            onClick={() => setIsSolo(prev => !prev)} 
                            title="Solo" 
                            active={isSolo}
                            accent={isSolo ? '#facc15' : undefined}
                        >
                            <span className="text-[8px] font-mono font-bold">S</span>
                        </ControlBtn>

                        <ControlBtn onClick={handleDownload} title="Open stem folder" disabled={!isReady}>
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                                <path d="M6 1v7M3 6l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                                <path d="M1 10h10" stroke="currentColor" strokeWidth="1.2"/>
                            </svg>
                        </ControlBtn>
                    </div>
                </div>
            </div>

            {/* FX Panel (expands below) */}
            <StemFXMenu 
                stemType={stemType} 
                stemFilePath={currentFilePath} 
                isOpen={fxDisabled ? false : showFX} 
                onApply={(newPath: string) => {
                    console.log("[StemPlayer] Received FX processed file:", newPath);
                    // Force a small delay to ensure file lock is released? Usually fine.
                    setCurrentFilePath(newPath);
                }}
                onClose={() => { 
                    if (onToggleFX) onToggleFX(); 
                    else setLocalShowFX(false); 
                }} 
            />
        </motion.div>
    );
};

// --- Small Control Button ---
const ControlBtn: React.FC<{
    onClick: () => void;
    title: string;
    disabled?: boolean;
    active?: boolean;
    accent?: string;
    isMain?: boolean;
    children: React.ReactNode;
}> = ({ onClick, title, disabled, active, accent, isMain, children }) => (
    <motion.button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`
            w-6 h-6 flex items-center justify-center rounded-md
            transition-all duration-100
            ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.06]'}
            ${active ? 'bg-white/[0.08]' : ''}
            ${isMain ? 'w-7 h-7' : ''}
        `}
        style={accent ? { color: accent, textShadow: `0 0 8px ${accent}44` } : { color: '#94a3b8' }}
        whileHover={disabled ? {} : { scale: 1.1 }}
        whileTap={disabled ? {} : { scale: 0.9 }}
    >
        {children}
    </motion.button>
);

export default StemPlayer;
