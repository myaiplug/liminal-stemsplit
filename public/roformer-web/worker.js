/**
 * Module Web Worker: downloads/caches a model, runs separation, encodes WAVs.
 * Start with: new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
 */
import { MODELS, ORT_MODULE_URL, ORT_WASM_BASE, ORT_CDN_MODULE_URL, ORT_CDN_BASE } from './models.js';
import { RoformerEngine } from './engine.js';
import { getModelFiles } from './model-store.js';
import { wavBlob, zipBlob } from './wav.js';
import { MemorySink, OpfsSink, TapSink } from './sinks.js';

let engine = null;
let ortPromise = null;
let lastSink = null;  // finished stems (OPFS-backed when possible); kept so WAV/ZIP exports can be made on demand
let lastMeta = null;  // { names, frames, sampleRate }
let swept = false;
let abort = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

let ortSource = null; // 'local' | 'cdn'

async function importOrt() {
  try {
    const ort = await import(/* @vite-ignore */ ORT_MODULE_URL);
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    // The wasm binary must be reachable too, otherwise InferenceSession.create fails much later.
    const probe = await fetch(`${ORT_WASM_BASE}ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD' });
    if (!probe.ok) throw new Error(`vendored ORT wasm: HTTP ${probe.status}`);
    ortSource = 'local';
    return ort;
  } catch (e) {
    console.warn('[roformer-web] local onnxruntime-web unavailable, falling back to CDN:', e);
    const ort = await import(/* @vite-ignore */ ORT_CDN_MODULE_URL);
    ort.env.wasm.wasmPaths = ORT_CDN_BASE;
    ortSource = 'cdn';
    return ort;
  }
}

async function loadOrt() {
  if (!ortPromise) {
    ortPromise = importOrt().then((ort) => {
      // SharedArrayBuffer (multi-threaded WASM) needs cross-origin isolation.
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 1;
      ort.env.wasm.proxy = false;
      ort.env.logLevel = 'error';
      return ort;
    });
  }
  return ortPromise;
}

async function disposeSink() {
  const s = lastSink; lastSink = null; lastMeta = null;
  try { await s?.dispose(); } catch { /* ignore */ }
}

/** Stems go to OPFS scratch files when the browser allows and there is room; otherwise RAM. */
function makeSinkFactory(model) {
  const storeInfo = { note: null };
  const createSink = async (N) => {
    const inner = await createInner(N);
    return new TapSink(inner, (m) => post({ type: 'progress', phase: 'stem-chunk', ...m }, [m.peaks.buffer, m.preview?.buffer].filter(Boolean)), { sampleRate: model.sampleRate });
  };
  const createInner = async (N) => {
    const need = N * 2 * 4 * model.stems.length;
    if (OpfsSink.supported()) {
      let room = true;
      try {
        const e = await navigator.storage.estimate();
        if (e.quota != null && e.usage != null) room = e.quota - e.usage > need * 1.1 + 64e6;
      } catch { /* unknown -> try */ }
      if (room) {
        try { storeInfo.note = null; return await OpfsSink.create(N); } catch (err) { console.warn('[roformer-web] OPFS scratch unavailable:', err); }
      }
    }
    storeInfo.note = need > 1.5e9
      ? `Stems are held in memory (~${Math.round(need / 1e6)} MB) because browser file storage isn't available or is full - a very long track may run the tab out of memory.`
      : null;
    return new MemorySink(N);
  };
  return { createSink, storeInfo };
}

async function getEngine() {
  if (!engine) {
    const ort = await loadOrt();
    engine = new RoformerEngine({
      ort,
      getModelFiles: (model, onProgress) => getModelFiles(model, onProgress, { signal: abort?.signal }),
      log: (...a) => console.warn('[roformer-web]', ...a),
      webgpuAvailable: !!self.navigator?.gpu,
    });
  }
  return engine;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'load': {
        abort = new AbortController();
        const eng = await getEngine();
        const info = await eng.load(msg.modelId, {
          device: msg.device,
          onProgress: (p) => post({ type: 'progress', ...p }),
        });
        post({ type: 'loaded', modelId: msg.modelId, ...info, threads: self.crossOriginIsolated ? 'multi' : 'single' });
        break;
      }
      case 'separate': {
        const eng = await getEngine();
        await disposeSink();
        const model = MODELS[eng.model.id];
        const sr = model.sampleRate;
        const frames = msg.left.length;
        const { createSink, storeInfo } = makeSinkFactory(model);
        if (!swept) { swept = true; if (OpfsSink.supported()) await OpfsSink.sweep(); }
        const { sink, backend, ms } = await eng.separate(msg.left, msg.right, {
          createSink,
          onProgress: (p) => post({ type: 'progress', ...p }),
        });
        lastSink = sink;
        const names = model.stems.filter((n) => sink.names().includes(n));
        lastMeta = { names, frames, sampleRate: sr };
        post({ type: 'done', stems: names, backend, ms, sampleRate: sr, frames, store: sink.kind, storeNote: storeInfo.note });
        break;
      }
      case 'export': {
        if (!lastSink || !lastMeta.names.includes(msg.stem)) throw new Error('No separated audio available');
        const blob = wavBlob(lastSink, msg.stem, lastMeta.frames, lastMeta.sampleRate, msg.format);
        post({ type: 'exported', reqId: msg.reqId, stem: msg.stem, format: msg.format, blob });
        break;
      }
      case 'planes': {
        if (!lastSink || !lastMeta.names.includes(msg.stem)) throw new Error('No separated audio available');
        const N = lastMeta.frames;
        const left = new Float32Array(lastSink.read(msg.stem, 0, 0, N));
        const right = new Float32Array(lastSink.read(msg.stem, 1, 0, N));
        post({ type: 'exported', reqId: msg.reqId, stem: msg.stem, planes: { left, right } }, [left.buffer, right.buffer]);
        break;
      }
      case 'zip': {
        if (!lastSink) throw new Error('No separated audio available');
        const fflate = await import('./vendor/fflate/fflate.mjs');
        const blob = zipBlob(fflate, lastSink, lastMeta.names, lastMeta.frames, lastMeta.sampleRate, msg.format, msg.base);
        post({ type: 'exported', reqId: msg.reqId, format: msg.format, blob });
        break;
      }
      case 'cancel':
        engine?.cancel();
        abort?.abort();
        break;
      case 'release':
        await disposeSink();
        await engine?.unload();
        break;
      default:
        break;
    }
  } catch (e) {
    const cancelled = e?.name === 'CancelledError' || e?.name === 'AbortError';
    if (msg?.reqId) post({ type: 'export-error', reqId: msg.reqId, message: String(e?.message || e) });
    else post({ type: 'error', cancelled, message: String(e?.message || e), name: e?.name });
  }
};
