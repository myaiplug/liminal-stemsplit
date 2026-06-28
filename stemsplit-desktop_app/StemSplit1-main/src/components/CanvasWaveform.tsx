// src/components/CanvasWaveform.tsx
'use client';

import React, {
  useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef,
} from 'react';
import {
  loadPeaksFromFile,
  peaksPathForAudio,
  buildPlaybackUrl,
  type AudioLoadProgress,
} from '@/lib/audio-loader';

export interface CanvasWaveformHandle {
  playPause: () => void;
  stop: () => void;
  seekTo: (fraction: number) => void;
  setVolume: (vol: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
  isReady: () => boolean;
  retryLoad: () => void;
}

interface CanvasWaveformProps {
  filePath: string;
  peaksPath?: string;
  height: number;
  waveColor: string;
  progressColor: string;
  barWidth?: number;
  barGap?: number;
  fallbackDuration?: number;
  deferLoadMs?: number;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (time: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onLoadError?: () => void;
  onLoadProgress?: (progress: AudioLoadProgress) => void;
}

const BAR_W = 2;
const BAR_GAP = 1;
const PLACEHOLDER_BARS = 512;

function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  peaks: Float32Array,
  progress: number,
  waveColor: string,
  progressColor: string,
  barW: number,
  barGap: number,
) {
  const totalBars = peaks.length;
  const barStep = barW + barGap;
  const progBar = Math.floor(progress * totalBars);
  const mid = h / 2;

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < totalBars; i++) {
    const peak = peaks[i] || 0;
    const barH = Math.max(1, peak * h * 0.92);
    const x = i * barStep;
    if (x + barW > w) break;

    const played = i < progBar;
    ctx.fillStyle = played ? progressColor : waveColor;
    ctx.globalAlpha = played ? 1 : 0.28;
    ctx.fillRect(x, mid - barH / 2, barW, barH);

    if (played && i === progBar - 1) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = progressColor;
      ctx.fillRect(x, mid - barH * 0.55, barW, barH * 1.1);
    }
  }

  if (progress > 0 && progress < 1) {
    const playheadX = progress * w;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = progressColor;
    ctx.fillRect(Math.max(0, playheadX - 0.5), 0, 1.5, h);
  }

  ctx.globalAlpha = 1;
}

function buildPlaceholderPeaks(): Float32Array {
  const peaks = new Float32Array(PLACEHOLDER_BARS);
  for (let i = 0; i < PLACEHOLDER_BARS; i += 1) {
    peaks[i] = 0.15 + Math.abs(Math.sin(i * 0.08)) * 0.35;
  }
  return peaks;
}

const CanvasWaveform = forwardRef<CanvasWaveformHandle, CanvasWaveformProps>(({
  filePath, peaksPath, height, waveColor, progressColor,
  barWidth = BAR_W, barGap = BAR_GAP, fallbackDuration = 0, deferLoadMs = 0,
  onReady, onTimeUpdate, onPlayStateChange, onLoadError, onLoadProgress,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const playingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const timeDisplayRef = useRef(0);
  const durationRef = useRef(fallbackDuration || 0);
  const volumeRef = useRef(0.85);
  const rafRef = useRef(0);

  const onReadyRef = useRef(onReady);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  const onLoadErrorRef = useRef(onLoadError);
  const onLoadProgressRef = useRef(onLoadProgress);
  const styleRef = useRef({ height, waveColor, progressColor, barWidth, barGap });
  styleRef.current = { height, waveColor, progressColor, barWidth, barGap };

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);
  useEffect(() => { onPlayStateChangeRef.current = onPlayStateChange; }, [onPlayStateChange]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);
  useEffect(() => { onLoadProgressRef.current = onLoadProgress; }, [onLoadProgress]);

  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(fallbackDuration || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadProgress, setLoadProgress] = useState<AudioLoadProgress>({
    stage: 'waiting', percent: 0, detail: 'Preparing waveform…',
  });
  const [peaksVersion, setPeaksVersion] = useState(0);

  const paintRef = useRef<(time: number, dur: number) => void>(() => {});

  paintRef.current = (time: number, dur: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !container || !peaks?.length) return;

    const { height: h, waveColor: wc, progressColor: pc, barWidth: bw, barGap: bg } = styleRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, container.clientWidth);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const prog = dur > 0 ? Math.min(1, Math.max(0, time / dur)) : 0;
    drawBars(ctx, w, h, peaks, prog, wc, pc, bw, bg);
  };

  const stopRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const syncProgressFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime || 0;
    timeDisplayRef.current = t;
    setCurrentTime(t);
    onTimeUpdateRef.current?.(t);
    paintRef.current(t, durationRef.current);
  }, []);

  const startProgressLoop = useCallback(() => {
    stopRaf();
    const loop = () => {
      if (!playingRef.current) return;
      syncProgressFromAudio();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [stopRaf, syncProgressFromAudio]);

  // Load peaks (tiny JSON) — no MP3/WAV decode
  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    let cancelled = false;

    setLoadState('loading');
    setReady(false);
    setCurrentTime(0);
    timeDisplayRef.current = 0;
    peaksRef.current = null;

    const load = async () => {
      if (deferLoadMs > 0) await new Promise((r) => setTimeout(r, deferLoadMs));
      if (cancelled || generation !== loadGenerationRef.current) return;

      const targetPeaks = peaksPath || peaksPathForAudio(filePath);

      try {
        const peaksData = await loadPeaksFromFile(targetPeaks, {
          fallbackDuration,
          onProgress: (p) => {
            if (cancelled || generation !== loadGenerationRef.current) return;
            setLoadProgress(p);
            onLoadProgressRef.current?.(p);
          },
        });

        if (cancelled || generation !== loadGenerationRef.current) return;

        peaksRef.current = peaksData.peaks;
        const dur = peaksData.durationSeconds || fallbackDuration || 0;
        durationRef.current = dur;
        setDuration(dur);
        setPeaksVersion((v) => v + 1);
        setReady(true);
        setLoadState('ready');
        onReadyRef.current?.(dur);
        requestAnimationFrame(() => paintRef.current(0, dur));
      } catch (error) {
        console.warn('[CanvasWaveform] peaks load failed, using placeholder:', error);
        if (cancelled || generation !== loadGenerationRef.current) return;

        peaksRef.current = buildPlaceholderPeaks();
        const dur = fallbackDuration || 0;
        durationRef.current = dur;
        setDuration(dur);
        setPeaksVersion((v) => v + 1);
        setReady(true);
        setLoadState('ready');
        setLoadProgress({ stage: 'ready', percent: 100, detail: 'Audio ready (re-split for full waveform)' });
        onReadyRef.current?.(dur);
        requestAnimationFrame(() => paintRef.current(0, dur));
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [filePath, peaksPath, fallbackDuration, deferLoadMs, loadAttempt]);

  // Stream playback via asset protocol — no decode in Web Audio
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = buildPlaybackUrl(filePath);
    audio.volume = volumeRef.current;
    audioRef.current = audio;

    const onLoadedMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);
      }
    };

    const onEnded = () => {
      playingRef.current = false;
      timeDisplayRef.current = 0;
      setCurrentTime(0);
      stopRaf();
      paintRef.current(0, durationRef.current);
      onPlayStateChangeRef.current?.(false);
    };

    const onTimeUpdate = () => {
      if (!playingRef.current) return;
      syncProgressFromAudio();
    };

    const onError = () => {
      console.error('[CanvasWaveform] audio stream error');
      onLoadErrorRef.current?.();
    };

    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
      audio.src = '';
      audioRef.current = null;
      stopRaf();
    };
  }, [filePath, stopRaf, syncProgressFromAudio]);

  useEffect(() => {
    if (!ready || playingRef.current) return;
    paintRef.current(timeDisplayRef.current, durationRef.current);
  }, [peaksVersion, ready, waveColor, progressColor, height, barWidth, barGap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ready) return;
    const obs = new ResizeObserver(() => {
      if (!playingRef.current) {
        paintRef.current(timeDisplayRef.current, durationRef.current);
      }
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [ready]);

  const doPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await audio.play();
      playingRef.current = true;
      onPlayStateChangeRef.current?.(true);
      startProgressLoop();
    } catch (err) {
      console.error('[CanvasWaveform] play failed:', err);
      playingRef.current = false;
      onPlayStateChangeRef.current?.(false);
    }
  }, [startProgressLoop]);

  const doPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    playingRef.current = false;
    stopRaf();
    syncProgressFromAudio();
    onPlayStateChangeRef.current?.(false);
  }, [stopRaf, syncProgressFromAudio]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  useImperativeHandle(ref, () => ({
    playPause: () => {
      if (playingRef.current) doPause();
      else void doPlay();
    },
    stop: () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      playingRef.current = false;
      stopRaf();
      timeDisplayRef.current = 0;
      setCurrentTime(0);
      onPlayStateChangeRef.current?.(false);
      paintRef.current(0, durationRef.current);
    },
    seekTo: (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || !durationRef.current) return;
      const t = fraction * durationRef.current;
      audio.currentTime = t;
      timeDisplayRef.current = t;
      setCurrentTime(t);
      paintRef.current(t, durationRef.current);
    },
    setVolume: (vol: number) => {
      volumeRef.current = vol;
      if (audioRef.current) audioRef.current.volume = vol;
    },
    getCurrentTime: () => timeDisplayRef.current,
    getDuration: () => durationRef.current,
    isPlaying: () => playingRef.current,
    isReady: () => ready,
    retryLoad,
  }), [doPlay, doPause, stopRaf, ready, retryLoad]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!containerRef.current || !durationRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (ref && 'current' in ref && ref.current) ref.current.seekTo(pct);
  }, [ref]);

  const showProgress = loadState === 'loading';

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className={`w-full block ${ready ? 'cursor-crosshair' : 'cursor-default'}`}
        onClick={ready ? handleClick : undefined}
      />

      {(showProgress || loadState === 'error') && (
        <div className="absolute inset-x-0 bottom-0 px-0.5 pb-0.5 pointer-events-none">
          <div className="h-[3px] rounded-full bg-slate-800/80 overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-150 ease-out ${
                loadState === 'error' ? 'bg-red-500/70' : 'bg-cyan-400'
              }`}
              style={{ width: loadState === 'error' ? '100%' : `${Math.max(2, loadProgress.percent)}%` }}
            />
          </div>
          <p className="mt-0.5 text-[8px] font-mono text-slate-500 truncate leading-tight">
            {loadProgress.detail}
            {loadProgress.percent > 0 ? ` · ${Math.round(loadProgress.percent)}%` : ''}
          </p>
        </div>
      )}

      {loadState === 'error' && (
        <button
          type="button"
          onClick={retryLoad}
          className="absolute top-1 right-1 text-[8px] font-mono uppercase tracking-wider text-cyan-400/90 hover:text-cyan-300 bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-700/60"
        >
          Retry
        </button>
      )}
    </div>
  );
});

CanvasWaveform.displayName = 'CanvasWaveform';
export default CanvasWaveform;