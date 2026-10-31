/**
 * Main-thread API: capability detection, audio decoding, and a promise-based
 * wrapper around the separation worker.
 */
import { MODELS } from './models.js';
import { parseWav } from './wav.js';

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

const TARGET_SR = 44100;

async function resampleBuffer(audio, sr) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Off(Math.min(2, audio.numberOfChannels), Math.max(1, Math.ceil(audio.duration * sr)), sr);
  const src = off.createBufferSource();
  src.buffer = audio; src.connect(off.destination); src.start();
  return off.startRendering();
}

/**
 * Decode an audio file to 44.1 kHz stereo Float32 planes, entirely in the browser.
 * WebAudio handles MP3/FLAC/OGG/M4A/WAV; if it refuses a WAV (odd bit depth, RF64, ...)
 * a built-in parser takes over. Anything not 44.1 kHz is resampled; mono is duplicated,
 * surround keeps front L/R.
 */
export async function decodeToStereo44k(file) {
  const bytes = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let audio = null;
  let firstErr = null;
  for (const opts of [{ sampleRate: TARGET_SR }, undefined]) {
    try {
      const ctx = opts ? new Ctx(opts) : new Ctx();
      try { audio = await ctx.decodeAudioData(bytes.slice(0)); } finally { ctx.close?.(); }
      break;
    } catch (e) { firstErr = firstErr || e; }
  }
  if (!audio) {
    try {
      const w = parseWav(bytes);
      const buf = new AudioBuffer({ length: w.frames, numberOfChannels: Math.min(2, w.channels.length), sampleRate: w.sampleRate });
      for (let c = 0; c < buf.numberOfChannels; c++) buf.copyToChannel(w.channels[c], c);
      audio = buf;
    } catch {
      throw new Error(`Could not decode "${file.name}". Try a WAV, MP3, FLAC, M4A or OGG file. (${firstErr?.message || firstErr || 'unsupported format'})`);
    }
  }
  const sourceRate = audio.sampleRate;
  if (sourceRate !== TARGET_SR) audio = await resampleBuffer(audio, TARGET_SR);
  const l0 = audio.getChannelData(0);
  const left = l0.slice();
  const right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : l0).slice();
  for (const ch of [left, right]) for (let i = 0; i < ch.length; i++) if (!(ch[i] === ch[i])) ch[i] = 0; // NaN guard
  if (left.length < 2048) throw new Error('This audio is too short to separate.');
  return { left, right, duration: left.length / TARGET_SR, sourceRate };
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
      if (m.type === 'exported' || m.type === 'export-error') {
        const r = this.exportReq.get(m.reqId);
        this.exportReq.delete(m.reqId);
        if (m.type === 'exported') r?.resolve(m); else r?.reject(new Error(m.message));
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

  #request(msg) {
    this.#ensure();
    const reqId = this.nextReq++;
    return new Promise((resolve, reject) => {
      this.exportReq.set(reqId, { resolve, reject });
      this.worker.postMessage({ ...msg, reqId });
    });
  }

  /** @returns {Promise<Blob>} WAV of one stem ('pcm16' | 'pcm24' | 'float32'), encoded on demand from the worker's stem store. */
  exportStem(stem, format) { return this.#request({ type: 'export', stem, format }).then((m) => m.blob); }

  /** @returns {Promise<Blob>} a .zip with every stem as WAV. */
  exportZip(format, base) { return this.#request({ type: 'zip', format, base }).then((m) => m.blob); }

  /** Float32 planes of one finished stem, copied out of the worker store. */
  readStem(stem) { return this.#request({ type: 'planes', stem }).then((m) => m.planes); }

  cancel() { this.worker?.postMessage({ type: 'cancel' }); }

  /** Drop the model and retained audio (frees GPU/WASM memory). */
  release() { this.worker?.postMessage({ type: 'release' }); }

  terminate() { this.worker?.terminate(); this.worker = null; this.listener = null; }
}
