// src/components/OriginalPlayer.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WaveSurfer from 'wavesurfer.js';

interface OriginalPlayerProps {
    filePath: string;
    onBassEnergy?: (energy: number) => void; // 0-1 bass energy for reactor
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function getFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 1] || 'Unknown';
    // Strip extension
    return name.replace(/\.[^.]+$/, '');
}

const OriginalPlayer: React.FC<OriginalPlayerProps> = ({ filePath, onBassEnergy }) => {
    const waveRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number>(0);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [isMuted, setIsMuted] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadProgress, setLoadProgress] = useState(0);

    // Bass analysis loop
    const startBassAnalysis = useCallback(() => {
        if (!analyserRef.current || !onBassEnergy) return;

        const analyser = analyserRef.current;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const analyze = () => {
            analyser.getByteFrequencyData(dataArray);

            // Bass: bins 0-8 (~0-340Hz at 44100 sample rate, 2048 fft)
            let bassSum = 0;
            const bassBins = Math.min(8, bufferLength);
            for (let i = 0; i < bassBins; i++) {
                bassSum += dataArray[i];
            }
            const bassEnergy = bassSum / (bassBins * 255); // normalize 0-1
            onBassEnergy(bassEnergy);

            rafRef.current = requestAnimationFrame(analyze);
        };
        analyze();
    }, [onBassEnergy]);

    const stopBassAnalysis = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        }
        onBassEnergy?.(0);
    }, [onBassEnergy]);

    // Init WaveSurfer
    useEffect(() => {
        if (!waveRef.current) return;
        let cancelled = false;
        let blobUrl: string | null = null;

        const init = async () => {
        let audioUrl: string;
        try {
            // Prefer convertFileSrc for asset protocol - much faster and memory efficient
            const { convertFileSrc } = await import('@tauri-apps/api/core');
            audioUrl = convertFileSrc(filePath);
        } catch {
            // Fallback to reading binary file into blob (slower, memory heavy)
            try {
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const bytes = await readFile(filePath);
                if (cancelled) return;
                const ext = filePath.split('.').pop()?.toLowerCase() || 'wav';
                const mimeMap: Record<string, string> = {
                    wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac',
                    ogg: 'audio/ogg', m4a: 'audio/mp4',
                };
                const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeMap[ext] || 'audio/wav' });
                blobUrl = URL.createObjectURL(blob);
                audioUrl = blobUrl;
            } catch (fsErr) {
                 console.warn('[OriginalPlayer] FS read failed:', fsErr);
                 audioUrl = filePath; // Last resort
            }
        }

        if (cancelled) return;


            if (cancelled || !waveRef.current) return;

            const ws = WaveSurfer.create({
                container: waveRef.current,
                height: 32,
                waveColor: '#475569',
                progressColor: '#22d3ee',
                cursorColor: '#67e8f9',
                cursorWidth: 1,
                barWidth: 1,
                barGap: 1,
                barRadius: 1,
                normalize: true,
                fillParent: true,
                hideScrollbar: true,
            });

            ws.on('loading', (pct: number) => {
                if (!cancelled) setLoadProgress(pct);
            });

            ws.on('ready', () => {
                if (cancelled) return;
                setDuration(ws.getDuration());
                setLoadProgress(100);
                setIsReady(true);
                ws.setVolume(volume);

                // Hook up AnalyserNode for bass detection via MediaElementAudioSourceNode
                if (onBassEnergy) {
                    try {
                        // WaveSurfer v7 default backend uses an internal <audio> element
                        const mediaEl = (ws as any).getMediaElement?.() || (ws as any).media;
                        if (mediaEl instanceof HTMLMediaElement) {
                            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                            const source = ctx.createMediaElementSource(mediaEl);
                            const analyser = ctx.createAnalyser();
                            analyser.fftSize = 2048;
                            analyser.smoothingTimeConstant = 0.8;
                            source.connect(analyser);
                            analyser.connect(ctx.destination);
                            analyserRef.current = analyser;
                            audioCtxRef.current = ctx;
                            // Resume if suspended (browser autoplay policy)
                            if (ctx.state === 'suspended') ctx.resume();
                        } else {
                            console.warn('[OriginalPlayer] No HTMLMediaElement available for bass analysis');
                        }
                    } catch (e) {
                        console.warn('[OriginalPlayer] Could not set up bass analyser:', e);
                    }
                }
            });

            ws.on('audioprocess', () => {
                if (!cancelled) setCurrentTime(ws.getCurrentTime());
            });
            ws.on('seeking', () => {
                if (!cancelled) setCurrentTime(ws.getCurrentTime());
            });
            ws.on('play', () => {
                if (!cancelled) {
                    setIsPlaying(true);
                    startBassAnalysis();
                }
            });
            ws.on('pause', () => {
                if (!cancelled) {
                    setIsPlaying(false);
                    stopBassAnalysis();
                }
            });
            ws.on('finish', () => {
                if (!cancelled) {
                    setIsPlaying(false);
                    setCurrentTime(0);
                    stopBassAnalysis();
                }
            });
            ws.on('error', (err) => {
                if (!cancelled) {
                    console.warn('[OriginalPlayer] load error:', err);
                    setLoadError('Failed to load');
                }
            });

            wsRef.current = ws;

            try {
                await ws.load(audioUrl);
            } catch (err: any) {
                if (!cancelled && err?.name !== 'AbortError') {
                    setLoadError('Failed to load audio');
                }
            }
        };

        init();

        return () => {
            cancelled = true;
            stopBassAnalysis();
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            try { wsRef.current?.destroy(); } catch { /* ignore */ }
            try { audioCtxRef.current?.close(); } catch { /* ignore */ }
            wsRef.current = null;
            analyserRef.current = null;
            audioCtxRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // Volume sync
    useEffect(() => {
        if (wsRef.current && isReady) {
            wsRef.current.setVolume(isMuted ? 0 : volume);
        }
    }, [volume, isMuted, isReady]);

    const togglePlay = useCallback(() => {
        // Resume AudioContext on user gesture (required by browser autoplay policy)
        if (audioCtxRef.current?.state === 'suspended') {
            audioCtxRef.current.resume();
        }
        wsRef.current?.playPause();
    }, []);

    const handleStop = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.stop();
            setCurrentTime(0);
            setIsPlaying(false);
            stopBassAnalysis();
        }
    }, [stopBassAnalysis]);

    const skipBack = useCallback(() => {
        if (wsRef.current) {
            const t = Math.max(0, wsRef.current.getCurrentTime() - 5);
            wsRef.current.seekTo(t / wsRef.current.getDuration());
        }
    }, []);

    const skipForward = useCallback(() => {
        if (wsRef.current) {
            const d = wsRef.current.getDuration();
            const t = Math.min(d, wsRef.current.getCurrentTime() + 5);
            wsRef.current.seekTo(t / d);
        }
    }, []);

    const fileName = getFileName(filePath);

    return (
        <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 z-40"
        >
            {/* Glass bar */}
            <div className="mx-auto max-w-2xl px-3 pb-2">
                <div className="relative rounded-t-xl border border-slate-700/40 border-b-0 bg-slate-950/70 backdrop-blur-xl overflow-hidden">
                    {/* Top glow line */}
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

                    {/* Waveform row */}
                    <div className="px-4 pt-3 pb-1">
                        <div className="flex items-center gap-3">
                            {/* Track name */}
                            <div className="flex-shrink-0 max-w-[120px]">
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider block truncate" title={fileName}>
                                    {fileName}
                                </span>
                            </div>

                            {/* Waveform */}
                            <div className="flex-1 relative min-w-0">
                                <div
                                    ref={waveRef}
                                    className={`w-full cursor-pointer transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}
                                />
                                {!isReady && !loadError && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        {/* Ghost waveform + scan line */}
                                        <div className="relative w-full h-8 flex items-center justify-center overflow-hidden px-1">
                                            <div className="flex items-end gap-[1px] h-8 w-full justify-center">
                                                {Array.from({ length: 50 }).map((_, i) => {
                                                    const barH = 2 + Math.sin(i * 0.35) * 6 + Math.cos(i * 0.8) * 4;
                                                    return (
                                                        <div
                                                            key={i}
                                                            className="rounded-full flex-shrink-0"
                                                            style={{ width: 1.5, height: `${Math.max(2, barH)}px`, backgroundColor: 'rgba(34,211,238,0.1)' }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            {/* Scan line */}
                                            <motion.div
                                                className="absolute top-0 bottom-0 w-[2px] pointer-events-none"
                                                style={{
                                                    background: 'linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.5) 40%, rgba(34,211,238,0.9) 50%, rgba(34,211,238,0.5) 60%, transparent 100%)',
                                                    boxShadow: '0 0 6px rgba(34,211,238,0.4)',
                                                }}
                                                animate={{ left: ['0%', '100%'] }}
                                                transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                                            />
                                            {/* Traveling dots */}
                                            {[0, 1, 2].map(d => (
                                                <motion.div
                                                    key={`odot-${d}`}
                                                    className="absolute rounded-full"
                                                    style={{
                                                        width: 2.5, height: 2.5,
                                                        backgroundColor: '#22d3ee',
                                                        boxShadow: '0 0 5px #22d3ee',
                                                        top: `${30 + Math.sin(d * 2) * 20}%`,
                                                    }}
                                                    animate={{ left: ['-2%', '102%'], opacity: [0, 1, 1, 0] }}
                                                    transition={{ duration: 2 + d * 0.35, repeat: Infinity, delay: d * 0.5, ease: 'linear' }}
                                                />
                                            ))}
                                        </div>
                                        {/* Progress % */}
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <div className="w-12 h-[1.5px] rounded-full bg-slate-800 overflow-hidden">
                                                <motion.div
                                                    className="h-full rounded-full bg-cyan-400"
                                                    animate={{ width: `${loadProgress}%` }}
                                                    transition={{ duration: 0.3 }}
                                                />
                                            </div>
                                            <span className="text-[7px] font-mono tabular-nums text-cyan-400/60">
                                                {loadProgress}%
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {loadError && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-[9px] font-mono text-red-400/60">{loadError}</span>
                                    </div>
                                )}
                            </div>

                            {/* Time */}
                            <div className="flex-shrink-0 text-right">
                                <span className="text-[10px] font-mono text-cyan-400 tabular-nums">
                                    {formatTime(currentTime)}
                                </span>
                                <span className="text-[10px] font-mono text-slate-600 mx-0.5">/</span>
                                <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                                    {formatTime(duration)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Controls row */}
                    <div className="px-4 pb-3 pt-1 flex items-center justify-between">
                        {/* Transport controls */}
                        <div className="flex items-center gap-1">
                            {/* Skip back */}
                            <button
                                onClick={skipBack}
                                disabled={!isReady}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30"
                                title="Back 5s"
                            >
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M11.5 12l8.5 6V6l-8.5 6zm-2 0V6l-8.5 6 8.5 6v-6z" />
                                </svg>
                            </button>

                            {/* Stop */}
                            <button
                                onClick={handleStop}
                                disabled={!isReady}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30"
                                title="Stop"
                            >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                    <rect x="4" y="4" width="16" height="16" rx="2" />
                                </svg>
                            </button>

                            {/* Play/Pause - larger center button */}
                            <button
                                onClick={togglePlay}
                                disabled={!isReady}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-400/50 hover:text-cyan-300 transition-all disabled:opacity-30 shadow-[0_0_8px_rgba(34,211,238,0.15)]"
                                title={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                        <rect x="6" y="4" width="4" height="16" rx="1" />
                                        <rect x="14" y="4" width="4" height="16" rx="1" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                )}
                            </button>

                            {/* Skip forward */}
                            <button
                                onClick={skipForward}
                                disabled={!isReady}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all disabled:opacity-30"
                                title="Forward 5s"
                            >
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
                                </svg>
                            </button>
                        </div>

                        {/* Right side: volume + label */}
                        <div className="flex items-center gap-3">
                            {/* Volume */}
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => setIsMuted(!isMuted)}
                                    className="text-slate-500 hover:text-cyan-400 transition-colors"
                                    title={isMuted ? 'Unmute' : 'Mute'}
                                >
                                    {isMuted || volume === 0 ? (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                        </svg>
                                    ) : (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        </svg>
                                    )}
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={isMuted ? 0 : volume}
                                    onChange={e => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
                                    className="stem-vol-slider w-16 h-1 accent-cyan-400"
                                    title={`Volume: ${Math.round(volume * 100)}%`}
                                />
                            </div>

                            {/* Original label */}
                            <span className="text-[8px] font-mono text-slate-600 tracking-[0.2em] uppercase border border-slate-800 rounded px-1.5 py-0.5">
                                ORIGINAL
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default React.memo(OriginalPlayer);
