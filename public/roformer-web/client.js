/**
 * Main-thread API: capability detection, audio decoding, and a promise-based
 * wrapper around the separation worker.
 */
import { MODELS } from './models.js';

export async function detectCapabilities() {
  const caps = {
    webgpu: false, adapter: null, maxBufferGB: null, f16: false,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null, // Chrome only, capped at 8
    reason: null,
  };
  if (!('gpu' in navigator)) {
    caps.reason = 'This browser does not expose WebGPU (try desktop Chrome or Edge 113+).';
    return caps;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { caps.reason = 'No compatible GPU adapter was found (WebGPU may be blocked or the GPU is unsupported).'; return caps; }
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    caps.webgpu = true;
    caps.adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'GPU';
    caps.maxBufferGB = adapter.limits?.maxBufferSize ? adapter.limits.maxBufferSize / 2 ** 30 : null;
    caps.f16 = adapter.features?.has?.('shader-f16') || false;
    if (!caps.f16) {
      // The shipped models are fp16 graphs; ORT's WebGPU EP cannot run them without shader-f16.
      caps.webgpu = false;
      caps.reason = `WebGPU is available (${caps.adapter}) but this GPU/browser does not support 16-bit shaders (shader-f16), which these models require.`;
    }
  } catch (e) {
    caps.reason = `WebGPU initialisation failed: ${e?.message || e}`;
  }
  return caps;
}

/** Decode any browser-supported audio file to 44.1 kHz stereo Float32 planes. */
export async function decodeToStereo44k(file) {
  const bytes = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let audio;
  try {
    // Chrome/Firefox resample to the context rate while decoding.
    const ctx = new Ctx({ sampleRate: 44100 });
    audio = await ctx.decodeAudioData(bytes.slice(0));
    ctx.close?.();
  } catch (e) {
    throw new Error(`Could not decode "${file.name}". Try a WAV, MP3, FLAC, M4A or OGG file. (${e?.message || e})`);
  }
  if (audio.sampleRate !== 44100) {
    const off = new OfflineAudioContext(audio.numberOfChannels, Math.ceil(audio.duration * 44100), 44100);
    const src = off.createBufferSource();
    src.buffer = audio; src.connect(off.destination); src.start();
    audio = await off.startRendering();
  }
  const left = audio.getChannelData(0).slice();
  const right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
  return { left, right, duration: audio.duration };
}

export class StemSeparator {
  /** @param {{ workerUrl?: URL|string }} [opts] */
  constructor({ workerUrl } = {}) {
    this.workerUrl = workerUrl || new URL('./worker.js', import.meta.url);
    this.worker = null;
    this.listener = null;
    this.exportReq = new Map();
    this.nextReq = 1;
  }

  #ensure() {
    if (this.worker) return;
    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'exported') {
        this.exportReq.get(m.reqId)?.resolve(m.buffer);
        this.exportReq.delete(m.reqId);
        return;
      }
      this.listener?.(m);
    };
    this.worker.onerror = (ev) => {
      this.listener?.({ type: 'error', message: ev.message || 'Worker crashed' });
    };
  }

  /** Send a message and resolve on the first message matching `until` (or reject on error). */
  #call(msg, until, onProgress, transfer) {
    this.#ensure();
    return new Promise((resolve, reject) => {
      this.listener = (m) => {
        if (m.type === 'progress') { onProgress?.(m); return; }
        if (m.type === 'error') { this.listener = null; reject(Object.assign(new Error(m.message), { cancelled: m.cancelled })); return; }
        if (m.type === until) { this.listener = null; resolve(m); }
      };
      this.worker.postMessage(msg, transfer || []);
    });
  }

  load(modelId, { device = 'auto', onProgress } = {}) {
    if (!MODELS[modelId]) throw new Error('Unknown model');
    return this.#call({ type: 'load', modelId, device }, 'loaded', onProgress);
  }

  separate({ left, right }, { onProgress } = {}) {
    return this.#call({ type: 'separate', left, right }, 'done', onProgress, [left.buffer, right.buffer]);
  }

  exportStem(stem, format) {
    this.#ensure();
    const reqId = this.nextReq++;
    return new Promise((resolve) => {
      this.exportReq.set(reqId, { resolve });
      this.worker.postMessage({ type: 'export', stem, format, reqId });
    });
  }

  cancel() { this.worker?.postMessage({ type: 'cancel' }); }

  /** Drop the model and retained audio (frees GPU/WASM memory). */
  release() { this.worker?.postMessage({ type: 'release' }); }

  terminate() { this.worker?.terminate(); this.worker = null; this.listener = null; }
}
