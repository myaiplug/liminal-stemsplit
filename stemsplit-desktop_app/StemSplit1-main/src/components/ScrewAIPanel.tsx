'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';

type ScrewPreset = 'baby' | 'screw' | 'mane_hold_up';

interface ScrewAIProps {
  audioPath?: string | null;
  audioTitle?: string;
  onScrewedFile?: (filePath: string) => void;
  isPro?: boolean;
}

export default function ScrewAIPanel({ audioPath, audioTitle, onScrewedFile, isPro }: ScrewAIProps) {
  const [preset, setPreset] = useState<ScrewPreset>('screw');
  const [loaded, setLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (audioPath) loadAudioFromPath(audioPath);
  }, [audioPath]);

  const ensureAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const loadAudioFromPath = async (path: string) => {
    try {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      const ctx = ensureAudioContext();
      if (isTauriRuntime()) {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(path);
        if (bytes?.byteLength) {
          const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
          setAudioBuffer(buffer);
          setLoaded(true);
          return;
        }
      }
      const resp = await fetch(path);
      const arrayBuf = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuf);
      setAudioBuffer(buffer);
      setLoaded(true);
    } catch (err) {
      console.error('[ScrewAI] Failed to load audio:', err);
    }
  };

  const applyScrew = useCallback(async () => {
    if (!audioBuffer) return;
    setProcessing(true);
    try {
      const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const rates: Record<ScrewPreset, number> = { baby: 0.92, screw: 0.85, mane_hold_up: 0.75 };
      source.playbackRate.value = rates[preset];

      const gainBoost = ctx.createGain();
      const boosts: Record<ScrewPreset, number> = { baby: 1.1, screw: 1.25, mane_hold_up: 1.4 };
      gainBoost.gain.value = boosts[preset];

      const delay = ctx.createDelay(5.0);
      const delays: Record<ScrewPreset, number> = { baby: 0.25, screw: 0.35, mane_hold_up: 0.55 };
      delay.delayTime.value = delays[preset];

      const feedback = ctx.createGain();
      feedback.gain.value = 0.4;
      delay.connect(feedback);
      feedback.connect(delay);

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(-1, ctx.currentTime);
      limiter.knee.setValueAtTime(0, ctx.currentTime);
      limiter.ratio.setValueAtTime(12, ctx.currentTime);

      source.connect(gainBoost);
      gainBoost.connect(delay);
      delay.connect(limiter);
      limiter.connect(ctx.destination);

      source.start(0);
      const rendered = await ctx.startRendering();

      const blob = await renderToBlob(rendered);
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
    } catch (err) {
      console.error('[ScrewAI] Processing failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [audioBuffer, preset]);

  const handleDownload = () => {
    if (!exportUrl) return;
    const name = audioTitle || 'audio';
    const presetNames: Record<ScrewPreset, string> = { baby: 'Baby_Screw', screw: 'Screwd', mane_hold_up: 'Mane_Hold_Up' };
    const a = document.createElement('a');
    a.href = exportUrl;
    a.download = `${name}_${presetNames[preset]}.wav`;
    a.click();
  };

  const presetLabels: Record<ScrewPreset, { label: string; desc: string }> = {
    baby: { label: 'Baby Screw', desc: 'Light slow-down, gentle wobble' },
    screw: { label: 'Screw', desc: 'Classic chop & screw' },
    mane_hold_up: { label: 'MANE HOLD UP', desc: 'Deep crawl, hypnotic' },
  };

  if (!isPro) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <span className="text-purple-400 text-lg">🧪</span>
        </div>
        <p className="text-sm text-slate-300 font-semibold mb-1">ScrewAI Pro</p>
        <p className="text-xs text-slate-500 max-w-xs">
          Chop & screw with AI. Upgrade to Pro to unlock ScrewAI + 17 additional strains.
        </p>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-sales-modal'))}
          className="mt-4 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-xs font-mono uppercase tracking-wider transition-all"
        >
          Upgrade $49
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Audio source indicator */}
      <div className="flex items-center gap-2 text-[10px] font-mono">
        <div className={`w-2 h-2 rounded-full ${loaded ? 'bg-purple-400' : 'bg-slate-600'}`} />
        <span className="text-slate-400 uppercase tracking-wider">
          {loaded ? (audioTitle || 'Audio loaded') : 'No audio — load a file first'}
        </span>
      </div>

      {/* Preset buttons */}
      <div className="grid grid-cols-3 gap-1.5">
        {(Object.keys(presetLabels) as ScrewPreset[]).map(p => (
          <button
            key={p}
            onClick={() => { setPreset(p); setExportUrl(null); }}
            disabled={processing}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-2 rounded border transition-all ${
              preset === p
                ? 'border-purple-500/60 bg-purple-500/10 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.15)]'
                : 'border-slate-700/50 bg-slate-900/50 text-slate-400 hover:border-slate-600'
            } disabled:opacity-50`}
          >
            <div className="font-bold">{presetLabels[p].label}</div>
            <div className="text-[8px] text-slate-500 normal-case tracking-normal mt-0.5">{presetLabels[p].desc}</div>
          </button>
        ))}
      </div>

      {/* Process + Export */}
      <div className="flex gap-2">
        <button
          onClick={applyScrew}
          disabled={!loaded || processing}
          className="flex-1 py-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 transition-all font-mono text-xs uppercase tracking-wider disabled:opacity-40"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span animate={{ opacity: [0.4,1,0.4] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-2 h-2 rounded-full bg-purple-400" />
              Screwing...
            </span>
          ) : 'Apply Screw'}
        </button>
        {exportUrl && (
          <button
            onClick={handleDownload}
            className="px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-all font-mono text-xs uppercase tracking-wider"
          >
            Download
          </button>
        )}
      </div>

      {/* Audio preview */}
      {exportUrl && (
        <audio controls className="w-full h-8" src={exportUrl} />
      )}
    </div>
  );
}

async function renderToBlob(buffer: AudioBuffer): Promise<Blob> {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  const rendered = await ctx.startRendering();

  const length = rendered.length;
  const numChannels = rendered.numberOfChannels;
  const sampleRate = rendered.sampleRate;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = length * numChannels * bitsPerSample / 8;
  const buffer_size = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(buffer_size);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, buffer_size - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, rendered.getChannelData(0)[i]));
    view.setInt16(offset, sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
