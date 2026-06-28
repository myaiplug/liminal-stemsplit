// src/components/SurgicalEditor.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SurgicalEditorProps {
    filePath: string;
    stemName: string;
    isOpen: boolean;
    onClose: () => void;
    onApply?: (newPath: string) => void;
    selectionStart?: number;
    selectionEnd?: number;
}

interface EditOp {
    type: 'cut' | 'split' | 'trim' | 'silence';
    position: number;
    endPosition?: number;
    timestamp: number;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function getFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1]?.replace(/\.[^.]+$/, '') || 'Unknown';
}

const BPM_PRESETS = [60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];

const SurgicalEditor: React.FC<SurgicalEditorProps> = ({ filePath, stemName, isOpen, onClose, onApply, selectionStart = 0, selectionEnd = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const bufferRef = useRef<AudioBuffer | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const gainRef = useRef<GainNode | null>(null);
    const rafRef = useRef<number>(0);
    const startTimeRef = useRef(0);
    const startOffsetRef = useRef(0);

    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [zoomStart, setZoomStart] = useState(0);
    const [zoomEnd, setZoomEnd] = useState(10);
    const [volume, setVolume] = useState(0.8);
    const [muted, setMuted] = useState(false);
    const [bpm, setBpm] = useState(120);
    const [key, setKey] = useState('C');
    const [selStart, setSelStart] = useState(selectionStart);
    const [selEnd, setSelEnd] = useState(selectionEnd || selectionStart + 1);
    const [editHistory, setEditHistory] = useState<EditOp[]>([]);
    const [editIndex, setEditIndex] = useState(-1);
    const [exportProgress, setExportProgress] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [exportPath, setExportPath] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setStatusMsg('');
        setExportPath(null);
    }, [isOpen, filePath]);

    // Load audio
    useEffect(() => {
        if (!isOpen || !filePath) return;
        let cancelled = false;

        const load = async () => {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioCtxRef.current = ctx;
            const gain = ctx.createGain();
            gain.gain.value = muted ? 0 : volume;
            gainRef.current = gain;

            try {
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const bytes = await readFile(filePath);
                if (bytes && bytes.byteLength > 0 && !cancelled) {
                    const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
                    bufferRef.current = buf;
                    setDuration(buf.duration);
                    setZoomEnd(Math.min(buf.duration, 10));
                    setSelStart(selectionStart || 0);
                    setSelEnd(selectionEnd || Math.min(1, buf.duration));
                }
            } catch {
                try {
                    const { convertFileSrc } = await import('@tauri-apps/api/core');
                    const resp = await fetch(convertFileSrc(filePath));
                    if (resp.ok && !cancelled) {
                        const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
                        bufferRef.current = buf;
                        setDuration(buf.duration);
                        setZoomEnd(Math.min(buf.duration, 10));
                    }
                } catch { /* ignore */ }
            }
        };
        load();
        return () => { cancelled = true; };
    }, [isOpen, filePath, selectionStart, selectionEnd]);

    // Volume sync
    useEffect(() => {
        if (gainRef.current) gainRef.current.gain.value = muted ? 0 : volume;
    }, [volume, muted]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            switch (e.key) {
                case ' ': e.preventDefault(); handlePlayPause(); break;
                case 'ArrowLeft': e.preventDefault(); seekRelative(-0.5); break;
                case 'ArrowRight': e.preventDefault(); seekRelative(0.5); break;
                case 'z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleUndo(); } break;
                case 'y': if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleRedo(); } break;
                case 'Delete': case 'Backspace': e.preventDefault(); handleDelete(); break;
                case 'Escape': onClose(); break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, currentTime, selStart, selEnd]);

    // RAF time update
    const updateTime = useCallback(() => {
        if (!bufferRef.current || !startTimeRef.current) return;
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const t = Math.min(startOffsetRef.current + elapsed, duration);
        setCurrentTime(t);
        if (t >= duration) { handleStop(); return; }
        // Auto-scroll the zoom window if playing past the right edge
        if (t > zoomEnd - 0.5) {
            const visible = zoomEnd - zoomStart;
            setZoomStart(Math.max(0, t - visible * 0.3));
            setZoomEnd(Math.min(duration, t + visible * 0.7));
        } else if (t < zoomStart) {
            const visible = zoomEnd - zoomStart;
            setZoomStart(Math.max(0, t - visible * 0.7));
            setZoomEnd(Math.min(duration, t + visible * 0.3));
        }
        rafRef.current = requestAnimationFrame(updateTime);
    }, [duration, zoomStart, zoomEnd]);

    const handlePlayPause = useCallback(() => {
        if (!bufferRef.current) return;
        if (playing) {
            sourceRef.current?.stop();
            sourceRef.current = null;
            cancelAnimationFrame(rafRef.current);
            setPlaying(false);
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            setCurrentTime(Math.min(startOffsetRef.current + elapsed, duration));
        } else {
            const ctx = audioCtxRef.current;
            if (!ctx) return;
            if (ctx.state === 'suspended') ctx.resume();
            const source = ctx.createBufferSource();
            source.buffer = bufferRef.current;
            source.connect(gainRef.current || ctx.destination);
            source.start(0, currentTime);
            sourceRef.current = source;
            source.onended = () => { setPlaying(false); cancelAnimationFrame(rafRef.current); };
            startTimeRef.current = Date.now();
            startOffsetRef.current = currentTime;
            setPlaying(true);
            rafRef.current = requestAnimationFrame(updateTime);
        }
    }, [playing, currentTime, duration, updateTime]);

    const handleStop = useCallback(() => {
        try { sourceRef.current?.stop(); } catch { /* */ }
        sourceRef.current = null;
        cancelAnimationFrame(rafRef.current);
        setPlaying(false);
        setCurrentTime(0);
    }, []);

    const seekRelative = useCallback((secs: number) => {
        const t = Math.max(0, Math.min(duration, currentTime + secs));
        setCurrentTime(t);
        if (playing) {
            sourceRef.current?.stop();
            const ctx = audioCtxRef.current;
            if (!ctx || !bufferRef.current) return;
            const source = ctx.createBufferSource();
            source.buffer = bufferRef.current;
            source.connect(gainRef.current || ctx.destination);
            source.start(0, t);
            sourceRef.current = source;
            startTimeRef.current = Date.now();
            startOffsetRef.current = t;
            rafRef.current = requestAnimationFrame(updateTime);
        }
    }, [currentTime, duration, playing, updateTime]);

    // Canvas waveform rendering
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !bufferRef.current) return;
        const dpr = window.devicePixelRatio || 1;
        const w = container.clientWidth;
        const h = 220;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);

        const data = bufferRef.current.getChannelData(0);
        const sampleRate = bufferRef.current.sampleRate;
        const startSample = Math.floor(zoomStart * sampleRate);
        const endSample = Math.floor(zoomEnd * sampleRate);
        const visibleSamples = endSample - startSample;
        const totalBars = Math.max(1, Math.floor(w));
        const samplesPerBar = Math.max(1, Math.floor(visibleSamples / totalBars));
        const mid = h / 2;

        // Background
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, w, h);

        // Grid lines (beats)
        if (bpm > 0) {
            const beatDuration = 60 / bpm;
            ctx.strokeStyle = 'rgba(71,85,105,0.12)';
            ctx.lineWidth = 0.5;
            for (let beat = Math.floor(zoomStart / beatDuration); beat * beatDuration <= zoomEnd; beat++) {
                const x = ((beat * beatDuration - zoomStart) / (zoomEnd - zoomStart)) * w;
                ctx.beginPath();
                ctx.setLineDash(beat % 4 === 0 ? [] : [3, 6]);
                ctx.moveTo(x, 0); ctx.lineTo(x, h);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // Waveform bars
        for (let i = 0; i < totalBars; i++) {
            let peak = 0;
            const start = startSample + i * samplesPerBar;
            for (let j = 0; j < samplesPerBar; j++) {
                const idx = start + j;
                if (idx < data.length) {
                    const v = Math.abs(data[idx]);
                    if (v > peak) peak = v;
                }
            }
            const barH = Math.max(0.5, peak * mid * 0.85);
            const x = i;
            // Progress coloring
            const timeAtBar = zoomStart + (i / totalBars) * (zoomEnd - zoomStart);
            const isSelected = timeAtBar >= selStart && timeAtBar <= selEnd;
            if (isSelected) {
                ctx.fillStyle = 'rgba(34,211,238,0.3)';
            } else if (timeAtBar <= currentTime) {
                ctx.fillStyle = '#22d3ee';
            } else {
                ctx.fillStyle = '#334155';
            }
            ctx.globalAlpha = timeAtBar <= currentTime ? 0.9 : (isSelected ? 0.7 : 0.4);
            ctx.fillRect(x, mid - barH / 2, 1.5, Math.max(0.5, barH));
        }
        ctx.globalAlpha = 1;

        // Selection overlay
        if (selEnd > selStart) {
            const selX1 = ((selStart - zoomStart) / (zoomEnd - zoomStart)) * w;
            const selX2 = ((selEnd - zoomStart) / (zoomEnd - zoomStart)) * w;
            ctx.fillStyle = 'rgba(34,211,238,0.06)';
            ctx.fillRect(selX1, 0, selX2 - selX1, h);
            ctx.strokeStyle = 'rgba(34,211,238,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(selX1, 0); ctx.lineTo(selX1, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(selX2, 0); ctx.lineTo(selX2, h); ctx.stroke();
        }

        // Playhead
        const playX = ((currentTime - zoomStart) / (zoomEnd - zoomStart)) * w;
        if (playX >= 0 && playX <= w) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(playX, 0); ctx.lineTo(playX, h); ctx.stroke();
        }

        // Zero crossing line
        ctx.strokeStyle = 'rgba(71,85,105,0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    }, [zoomStart, zoomEnd, currentTime, selStart, selEnd, duration, bpm]);

    // Redraw on any state change
    useEffect(() => {
        const frame = requestAnimationFrame(drawWaveform);
        return () => cancelAnimationFrame(frame);
    }, [drawWaveform, playing]);

    // Resize handler
    useEffect(() => {
        const obs = new ResizeObserver(() => drawWaveform());
        if (containerRef.current) obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [drawWaveform]);

    // Canvas mouse events
    const canvasXToTime = useCallback((clientX: number): number => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = x / rect.width;
        return zoomStart + pct * (zoomEnd - zoomStart);
    }, [zoomStart, zoomEnd]);

    const [dragging, setDragging] = useState<'seek' | 'select' | 'scroll' | null>(null);
    const dragStartRef = useRef<number>(0);

    const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button === 1 || e.button === 2) {
            // Middle click or right click: scroll/pan
            setDragging('scroll');
            dragStartRef.current = e.clientX;
            return;
        }
        if (e.shiftKey) {
            // Shift+click: add to selection
            const t = canvasXToTime(e.clientX);
            setDragging('select');
            setSelStart(t);
            setSelEnd(t);
            return;
        }
        // Left click: seek
        const t = canvasXToTime(e.clientX);
        setDragging('seek');
        setCurrentTime(t);
        if (playing) {
            sourceRef.current?.stop();
            const ctx = audioCtxRef.current;
            if (ctx && bufferRef.current) {
                const source = ctx.createBufferSource();
                source.buffer = bufferRef.current;
                source.connect(gainRef.current || ctx.destination);
                source.start(0, t);
                sourceRef.current = source;
                startTimeRef.current = Date.now();
                startOffsetRef.current = t;
            }
        }
    }, [canvasXToTime, playing]);

    const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
        if (dragging === 'scroll') {
            const dx = (e.clientX - dragStartRef.current) / (containerRef.current?.clientWidth || 1);
            const visible = zoomEnd - zoomStart;
            const shift = dx * visible;
            let newStart = Math.max(0, zoomStart - shift);
            let newEnd = Math.min(duration, zoomEnd - shift);
            if (newEnd - newStart !== visible) {
                if (newStart === 0) newEnd = Math.min(duration, visible);
                else if (newEnd === duration) newStart = Math.max(0, duration - visible);
            }
            setZoomStart(newStart);
            setZoomEnd(newEnd);
            dragStartRef.current = e.clientX;
        } else if (dragging === 'select') {
            const t = canvasXToTime(e.clientX);
            setSelEnd(t);
        } else if (dragging === 'seek') {
            const t = canvasXToTime(e.clientX);
            setCurrentTime(t);
        }
    }, [dragging, zoomStart, zoomEnd, duration, canvasXToTime]);

    const handleCanvasMouseUp = useCallback(() => {
        if (dragging === 'select') {
            if (selEnd < selStart) {
                setSelStart(selEnd);
                setSelEnd(selStart);
            }
        }
        setDragging(null);
    }, [dragging, selStart, selEnd]);

    // Zoom: mouse wheel
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.3 : 0.7;
        const mouseTime = canvasXToTime(e.clientX);
        const visible = Math.max(0.5, (zoomEnd - zoomStart) * factor);
        const mousePct = (mouseTime - zoomStart) / (zoomEnd - zoomStart || 1);
        const newStart = Math.max(0, mouseTime - visible * mousePct);
        const newEnd = Math.min(duration, newStart + visible);
        setZoomStart(newStart);
        setZoomEnd(newEnd);
    }, [zoomStart, zoomEnd, duration, canvasXToTime]);

    // DAW operations
    const handleSplit = useCallback(async () => {
        if (!currentTime || !duration) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const newPath = await invoke('export_audio_clip', {
                filePath,
                startSec: 0,
                endSec: currentTime,
                stemName: `${stemName}_partA`,
            });
            const newPath2 = await invoke<string>('export_audio_clip', {
                filePath,
                startSec: currentTime,
                endSec: duration,
                stemName: `${stemName}_partB`,
            });
            pushEdit({ type: 'split', position: currentTime });
            setExportPath(newPath2);
        } catch (e) { console.error('Split failed:', e); }
    }, [currentTime, duration, filePath, stemName]);

    const handleTrimToSelection = useCallback(async () => {
        if (selEnd <= selStart) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const newPath = await invoke('export_audio_clip', {
                filePath,
                startSec: selStart,
                endSec: selEnd,
                stemName: `${stemName}_trimmed`,
            });
            pushEdit({ type: 'trim', position: selStart, endPosition: selEnd });
            setExportPath(newPath as string);
            setStatusMsg('Trim applied');
            onApply?.(newPath as string);
        } catch (e) {
            console.error('Trim failed:', e);
            setStatusMsg('Trim failed');
        }
    }, [selStart, selEnd, filePath, stemName, onApply]);

    const handleSilenceSelection = useCallback(async () => {
        if (selEnd <= selStart || !bufferRef.current) return;
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const buf = bufferRef.current;
            const startSample = Math.floor(selStart * buf.sampleRate);
            const endSample = Math.floor(selEnd * buf.sampleRate);
            const newBuf = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
            for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                const data = buf.getChannelData(ch);
                const newData = newBuf.getChannelData(ch);
                newData.set(data);
                newData.fill(0, startSample, endSample);
            }
            bufferRef.current = newBuf;
            pushEdit({ type: 'silence', position: selStart, endPosition: selEnd });
            setExportPath(null);
        } catch (e) { console.error('Silence failed:', e); }
    }, [selStart, selEnd]);

    const handleDelete = useCallback(() => {
        handleTrimToSelection();
    }, [handleTrimToSelection]);

    const handleExportSelectionAsFile = useCallback(async () => {
        if (selEnd <= selStart) return;
        setExporting(true);
        setExportProgress(0);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const newPath = await invoke('export_audio_clip', {
                filePath,
                startSec: selStart,
                endSec: selEnd,
                stemName: stemName,
            });
            setExportPath(newPath as string);
            setExportProgress(100);
        } catch (e) { console.error('Export failed:', e); }
        setExporting(false);
    }, [selStart, selEnd, filePath, stemName]);

    const handleSaveToSampleBank = useCallback(async () => {
        if (selEnd <= selStart) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('save_to_sample_bank', {
                sourcePath: filePath,
                startSec: selStart,
                endSec: selEnd,
                stemType: stemName,
                bpm,
                key,
            });
            setStatusMsg('Saved to sample bank');
        } catch (e) {
            console.error('Sample bank save failed:', e);
            setStatusMsg('Sample bank save failed');
        }
    }, [selStart, selEnd, filePath, stemName, bpm, key]);

    // Undo/Redo
    const pushEdit = useCallback((edit: Omit<EditOp, 'timestamp'>) => {
        const fullEdit: EditOp = { ...edit, timestamp: Date.now() };
        setEditHistory(prev => {
            const newHist = prev.slice(0, editIndex + 1);
            newHist.push(fullEdit);
            return newHist;
        });
        setEditIndex(i => i + 1);
    }, [editIndex]);

    const handleUndo = useCallback(() => {
        if (editIndex < 0) return;
        setEditIndex(i => i - 1);
    }, [editIndex]);

    const handleRedo = useCallback(() => {
        if (editIndex >= editHistory.length - 1) return;
        setEditIndex(i => i + 1);
    }, [editIndex, editHistory]);

    // Zoom presets
    const zoomToFit = useCallback(() => { setZoomStart(0); setZoomEnd(duration); }, [duration]);
    const zoomIn = useCallback(() => {
        const center = (zoomStart + zoomEnd) / 2;
        const visible = (zoomEnd - zoomStart) * 0.5;
        setZoomStart(Math.max(0, center - visible / 2));
        setZoomEnd(Math.min(duration, center + visible / 2));
    }, [zoomStart, zoomEnd, duration]);
    const zoomOut = useCallback(() => {
        const center = (zoomStart + zoomEnd) / 2;
        const visible = Math.min(duration, (zoomEnd - zoomStart) * 2);
        setZoomStart(Math.max(0, center - visible / 2));
        setZoomEnd(Math.min(duration, center + visible / 2));
    }, [zoomStart, zoomEnd, duration]);

    const canUndo = editIndex >= 0;
    const canRedo = editIndex < editHistory.length - 1;
    const hasSelection = selEnd > selStart;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col"
                    onContextMenu={e => e.preventDefault()}
                >
                    {/* === Toolbar === */}
                    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800/50 bg-slate-950/60">
                        {/* Transport */}
                        <button onClick={handlePlayPause}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-all">
                            {playing ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                    <rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>
                                </svg>
                            ) : (
                                <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                            )}
                        </button>
                        <button onClick={handleStop}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                        </button>

                        <div className="w-px h-5 bg-slate-800 mx-1.5" />

                        {/* Edit tools */}
                        <button onClick={handleUndo} disabled={!canUndo}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 disabled:opacity-30 transition-all" title="Undo (Ctrl+Z)">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                            </svg>
                        </button>
                        <button onClick={handleRedo} disabled={!canRedo}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 disabled:opacity-30 transition-all" title="Redo (Ctrl+Y)">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"/>
                            </svg>
                        </button>

                        <div className="w-px h-5 bg-slate-800 mx-1.5" />

                        <button onClick={handleSplit}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all" title="Split at Cursor (S)">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 12h16M4 19h16M12 5v14"/>
                            </svg>
                        </button>
                        <button onClick={handleDelete} disabled={!hasSelection}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-all" title="Cut Selection (Del)">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                        <button onClick={handleSilenceSelection} disabled={!hasSelection}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-30 transition-all" title="Silence Selection">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                                <line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/>
                            </svg>
                        </button>

                        <div className="w-px h-5 bg-slate-800 mx-1.5" />

                        {/* Zoom */}
                        <button onClick={zoomIn}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all" title="Zoom In">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                            </svg>
                        </button>
                        <button onClick={zoomOut}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all" title="Zoom Out">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
                            </svg>
                        </button>
                        <button onClick={zoomToFit}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-all" title="Zoom to Fit">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                            </svg>
                        </button>

                        <div className="w-px h-5 bg-slate-800 mx-1.5" />

                        {/* BPM / Key */}
                        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                            <select value={bpm} onChange={e => setBpm(Number(e.target.value))}
                                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 outline-none">
                                {BPM_PRESETS.map(b => <option key={b} value={b}>{b} BPM</option>)}
                            </select>
                            <select value={key} onChange={e => setKey(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 outline-none">
                                {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>

                        <div className="flex-1" />

                        {/* Selection info */}
                        {hasSelection && (
                            <span className="text-[9px] font-mono text-cyan-400/70 tracking-wider">
                                {formatTime(selStart)} — {formatTime(selEnd)} ({formatTime(selEnd - selStart)})
                            </span>
                        )}

                        <div className="w-px h-5 bg-slate-800 mx-1.5" />

                        {/* Actions */}
                        <button onClick={handleExportSelectionAsFile} disabled={!hasSelection || exporting}
                            className="px-2.5 py-1 rounded text-[10px] font-mono tracking-wider border border-cyan-500/30 text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30 transition-all">
                            Export Selection
                        </button>
                        <button onClick={handleSaveToSampleBank} disabled={!hasSelection}
                            className="px-2.5 py-1 rounded text-[10px] font-mono tracking-wider border border-purple-500/30 text-purple-400/80 hover:text-purple-300 hover:bg-purple-500/10 disabled:opacity-30 transition-all">
                            Save to Sample Bank
                        </button>

                        {/* Close */}
                        <button onClick={onClose}
                            className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all ml-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>

                    {/* === Info bar === */}
                    <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-950/40 border-b border-slate-800/30 text-[9px] font-mono text-slate-500">
                        <span className="text-cyan-400/60">{getFileName(filePath)}</span>
                        <span>{stemName.toUpperCase()}</span>
                        <span>{formatTime(duration)}</span>
                        <span>{bufferRef.current?.sampleRate}Hz</span>
                        <span>{bufferRef.current?.numberOfChannels}ch</span>
                        <span className="ml-auto truncate max-w-[50%]">
                            {statusMsg || (exporting ? `Exporting... ${exportProgress}%` : exportPath ? `Saved: ${exportPath.split(/[\\/]/).pop()}` : '')}
                        </span>
                    </div>

                    {/* === Time ruler === */}
                    <div className="flex-none h-6 bg-slate-950/60 border-b border-slate-800/30 flex items-center px-4 relative overflow-hidden">
                        <div className="absolute inset-0 flex" style={{ marginLeft: 0 }}>
                            {(() => {
                                const tickSpacing = Math.max(1, Math.floor((zoomEnd - zoomStart) / 20 * 10) / 10);
                                const ticks: number[] = [];
                                for (let t = Math.ceil(zoomStart / tickSpacing) * tickSpacing; t < zoomEnd; t += tickSpacing) {
                                    ticks.push(t);
                                }
                                return ticks.map(t => (
                                    <div key={t} className="absolute text-[8px] font-mono text-slate-500 top-1"
                                        style={{ left: `${((t - zoomStart) / (zoomEnd - zoomStart || 1)) * 100}%`, transform: 'translateX(-50%)' }}>
                                        {t % 1 < 0.01 ? formatTime(t) : ''}
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>

                    {/* === Waveform canvas === */}
                    <div ref={containerRef} className="flex-1 relative cursor-crosshair" style={{ height: 220 }}>
                        <canvas
                            ref={canvasRef}
                            className="w-full h-full"
                            onMouseDown={handleCanvasMouseDown}
                            onMouseMove={handleCanvasMouseMove}
                            onMouseUp={handleCanvasMouseUp}
                            onMouseLeave={handleCanvasMouseUp}
                            onWheel={handleWheel}
                        />
                    </div>

                    {/* === Volume / Transport footer === */}
                    <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-800/50 bg-slate-950/60">
                        <button onClick={() => setMuted(!muted)} className="text-slate-500 hover:text-cyan-400 transition-colors">
                            {muted ? (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                                    <line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/>
                                </svg>
                            ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                                </svg>
                            )}
                        </button>
                        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                            onChange={e => { setVolume(parseFloat(e.target.value)); setMuted(false); }}
                            className="w-20 h-1 accent-cyan-400"
                        />

                        <div className="flex-1" />

                        <span className="text-[10px] font-mono text-cyan-400 tabular-nums">{formatTime(currentTime)}</span>
                        <span className="text-[10px] text-slate-600">/</span>
                        <span className="text-[10px] font-mono text-slate-500 tabular-nums">{formatTime(duration)}</span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SurgicalEditor;
