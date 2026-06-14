// src/components/CanvasWaveform.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';

export interface CanvasWaveformHandle {
  playPause: () => void;
  stop: () => void;
  seekTo: (fraction: number) => void;
  setVolume: (vol: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
  isReady: () => boolean;
}

interface CanvasWaveformProps {
  filePath: string;
  height: number;
  waveColor: string;
  progressColor: string;
  barWidth?: number;
  barGap?: number;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (time: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onLoadError?: () => void;
}

const BAR_W = 2;
const BAR_GAP = 1;

async function loadAudioBuffer(filePath: string): Promise<AudioBuffer> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

  // Strategy 1: Tauri FS read
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(filePath);
    if (bytes?.byteLength > 0) {
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    }
  } catch { /* fall through */ }

  // Strategy 2: Tauri asset protocol
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    const resp = await fetch(convertFileSrc(filePath));
    if (resp.ok) {
      return await ctx.decodeAudioData(await resp.arrayBuffer());
    }
  } catch { /* fall through */ }

  // Strategy 3: backend blob read
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const payload = await invoke<{ data_base64: string }>('read_audio_file', { path: filePath });
    if (payload?.data_base64) {
      const binary = atob(payload.data_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return await ctx.decodeAudioData(bytes.buffer);
    }
  } catch { /* fall through */ }

  throw new Error('Could not load audio');
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  data: Float32Array,
  progress: number,
  waveColor: string,
  progressColor: string,
  barW: number, barGap: number
) {
  const totalBars = Math.max(1, Math.floor(w / (barW + barGap)));
  const samplesPerBar = Math.max(1, Math.floor(data.length / totalBars));
  const progBar = Math.floor(progress * totalBars);
  const mid = h / 2;

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < totalBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) {
      const v = Math.abs(data[start + j] || 0);
      if (v > peak) peak = v;
    }
    const barH = Math.max(1, peak * h * 0.9);
    const x = i * (barW + barGap);
    ctx.fillStyle = i < progBar ? progressColor : waveColor;
    ctx.globalAlpha = i < progBar ? 1 : 0.35;
    ctx.fillRect(x, mid - barH / 2, barW, barH);
  }
  ctx.globalAlpha = 1;
}

const CanvasWaveform = forwardRef<CanvasWaveformHandle, CanvasWaveformProps>(({
  filePath, height, waveColor, progressColor,
  barWidth = BAR_W, barGap = BAR_GAP,
  onReady, onTimeUpdate, onPlayStateChange, onLoadError,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startOffsetRef = useRef(0);
  const startTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const volumeRef = useRef(0.85);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  // Load audio
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    bufferRef.current = null;
    setReady(false);

    loadAudioBuffer(filePath).then((buf) => {
      if (cancelled) return;
      bufferRef.current = buf;
      setDuration(buf.duration);
      setReady(true);
      setLoadState('ready');
      onReady?.(buf.duration);
    }).catch(() => {
      if (!cancelled) {
        setLoadState('error');
        onLoadError?.();
      }
    });

    return () => {
      cancelled = true;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [filePath, onReady, onLoadError]);

  // Get or create AudioContext
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  // Schedule stop + cleanup current source
  const stopSource = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch { /* already stopped */ }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
  }, []);

  // Update time via RAF
  const updateTime = useCallback(() => {
    if (!sourceRef.current || !startTimeRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const t = Math.min(startOffsetRef.current + elapsed, duration);
    setCurrentTime(t);
    onTimeUpdate?.(t);
    if (t >= duration) {
      setPlaying(false);
      onPlayStateChange?.(false);
      stopSource();
      return;
    }
    rafRef.current = requestAnimationFrame(updateTime);
  }, [duration, onTimeUpdate, onPlayStateChange, stopSource]);

  // Play
  const doPlay = useCallback(() => {
    if (!bufferRef.current) return;
    stopSource();
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0, startOffsetRef.current);
    sourceRef.current = source;
    gainRef.current = gain;
    startTimeRef.current = Date.now();

    setPlaying(true);
    onPlayStateChange?.(true);
    rafRef.current = requestAnimationFrame(updateTime);
  }, [getAudioCtx, stopSource, updateTime, onPlayStateChange]);

  // Pause
  const doPause = useCallback(() => {
    if (!sourceRef.current) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    startOffsetRef.current = Math.min(startOffsetRef.current + elapsed, duration);
    stopSource();
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    onPlayStateChange?.(false);
  }, [duration, stopSource, onPlayStateChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopSource();
    };
  }, [stopSource]);

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    playPause: () => {
      if (playing) doPause();
      else doPlay();
    },
    stop: () => {
      stopSource();
      startOffsetRef.current = 0;
      setCurrentTime(0);
      setPlaying(false);
      onPlayStateChange?.(false);
      cancelAnimationFrame(rafRef.current);
    },
    seekTo: (fraction: number) => {
      if (!bufferRef.current) return;
      const t = fraction * bufferRef.current.duration;
      startOffsetRef.current = t;
      setCurrentTime(t);
      if (playing) {
        stopSource();
        doPlay();
      }
    },
    setVolume: (vol: number) => {
      volumeRef.current = vol;
      if (gainRef.current) gainRef.current.gain.value = vol;
    },
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    isPlaying: () => playing,
    isReady: () => ready,
  }), [playing, ready, duration, currentTime, doPlay, doPause, stopSource, onPlayStateChange]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !bufferRef.current || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const prog = duration > 0 ? currentTime / duration : 0;
    const data = bufferRef.current.getChannelData(0);
    drawBars(ctx, w, h, data, prog, waveColor, progressColor, barWidth, barGap);
  }, [ready, currentTime, duration, height, waveColor, progressColor, barWidth, barGap]);

  // Redraw on resize
  useEffect(() => {
    if (!ready) return;
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container || !bufferRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const prog = duration > 0 ? currentTime / duration : 0;
      const data = bufferRef.current.getChannelData(0);
      drawBars(ctx, w, h, data, prog, waveColor, progressColor, barWidth, barGap);
    };
    const obs = new ResizeObserver(handleResize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [ready, currentTime, duration, height, waveColor, progressColor, barWidth, barGap]);

  // Click to seek
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!containerRef.current || !duration) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    if (ref && 'current' in ref && ref.current) {
      ref.current.seekTo(pct);
    }
  }, [duration, ref]);

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2" style={{ height }}>
        <div className="flex items-end gap-[1.5px] h-8 w-full justify-center opacity-20 px-2">
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} className="rounded-full flex-shrink-0"
              style={{ width: 2, height: `${3 + Math.sin(i * 0.4) * 6}px`, backgroundColor: waveColor }} />
          ))}
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="flex items-end gap-[1.5px] h-8 w-full justify-center px-2">
          {Array.from({ length: 40 }).map((_, i) => {
            const barH = 2 + Math.sin(i * 0.3) * 3;
            return (
              <div key={i} className="rounded-full flex-shrink-0"
                style={{ width: 2, height: `${Math.max(2, barH)}px`, backgroundColor: `${waveColor}15` }} />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="w-full block cursor-crosshair"
        onClick={handleClick}
      />
    </div>
  );
});

CanvasWaveform.displayName = 'CanvasWaveform';
export { loadAudioBuffer };
export default CanvasWaveform;
