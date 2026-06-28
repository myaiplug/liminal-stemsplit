'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import CanvasWaveform, { CanvasWaveformHandle } from './CanvasWaveform';

interface OriginalPlayerProps {
    filePath: string;
    displayTitle?: string;
    onBassEnergy?: (energy: number) => void;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function getFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 1] || 'Unknown';
    return name.replace(/\.[^.]+$/, '');
}

const OriginalPlayer: React.FC<OriginalPlayerProps> = ({ filePath, displayTitle, onBassEnergy }) => {
    const canvasWaveformRef = useRef<CanvasWaveformHandle>(null);
    const rafRef = useRef<number>(0);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [isMuted, setIsMuted] = useState(false);

    const isFreshImport = filePath.includes('StemSplit') && filePath.includes('imports');

    const stopBassPulse = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        }
        onBassEnergy?.(0);
    }, [onBassEnergy]);

    const startBassPulse = useCallback(() => {
        if (!onBassEnergy) return;
        stopBassPulse();
        const pulse = () => {
            const t = canvasWaveformRef.current?.getCurrentTime() ?? 0;
            onBassEnergy(0.15 + Math.min(0.35, Math.abs(Math.sin(t * 3)) * 0.25));
            rafRef.current = requestAnimationFrame(pulse);
        };
        pulse();
    }, [onBassEnergy, stopBassPulse]);

    useEffect(() => {
        setIsReady(false);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        stopBassPulse();
    }, [filePath, stopBassPulse]);

    useEffect(() => {
        canvasWaveformRef.current?.setVolume(isMuted ? 0 : volume);
    }, [volume, isMuted, filePath]);

    useEffect(() => () => stopBassPulse(), [stopBassPulse]);

    const togglePlay = useCallback(() => {
        canvasWaveformRef.current?.playPause();
    }, []);

    const handleStop = useCallback(() => {
        canvasWaveformRef.current?.stop();
        setCurrentTime(0);
        setIsPlaying(false);
        stopBassPulse();
    }, [stopBassPulse]);

    const skipBack = useCallback(() => {
        const cw = canvasWaveformRef.current;
        if (!cw) return;
        const t = Math.max(0, cw.getCurrentTime() - 5);
        cw.seekTo(cw.getDuration() > 0 ? t / cw.getDuration() : 0);
    }, []);

    const skipForward = useCallback(() => {
        const cw = canvasWaveformRef.current;
        if (!cw) return;
        const d = cw.getDuration();
        const t = Math.min(d, cw.getCurrentTime() + 5);
        cw.seekTo(d > 0 ? t / d : 0);
    }, []);

    const fileName = displayTitle || getFileName(filePath);

    return (
        <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 z-40"
        >
            <div className="mx-auto max-w-2xl px-3 pb-2">
                <div className="relative rounded-t-xl border border-slate-700/40 border-b-0 bg-slate-950/70 backdrop-blur-xl overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

                    <div className="px-4 pt-3 pb-1">
                        <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 max-w-[120px]">
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider block truncate" title={fileName}>
                                    {fileName}
                                </span>
                            </div>

                            <div className="flex-1 relative min-w-0">
                                <CanvasWaveform
                                    ref={canvasWaveformRef}
                                    filePath={filePath}
                                    height={32}
                                    waveColor="#475569"
                                    progressColor="#22d3ee"
                                    deferLoadMs={isFreshImport ? 800 : 0}
                                    onReady={(dur) => {
                                        setDuration(dur);
                                        setIsReady(true);
                                    }}
                                    onTimeUpdate={(t) => setCurrentTime(t)}
                                    onPlayStateChange={(playing) => {
                                        setIsPlaying(playing);
                                        if (playing) startBassPulse();
                                        else stopBassPulse();
                                    }}
                                    onLoadError={() => {
                                        setIsReady(true);
                                    }}
                                />
                            </div>

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

                    <div className="px-4 pb-3 pt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1">
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

                        <div className="flex items-center gap-3">
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
                                    onChange={(e) => {
                                        setVolume(parseFloat(e.target.value));
                                        setIsMuted(false);
                                    }}
                                    className="stem-vol-slider w-16 h-1 accent-cyan-400"
                                    title={`Volume: ${Math.round(volume * 100)}%`}
                                />
                            </div>

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