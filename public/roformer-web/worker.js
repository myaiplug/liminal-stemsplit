/**
 * Module Web Worker: downloads/caches a model, runs separation, encodes WAVs.
 * Start with: new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
 */
import { MODELS, ORT_MODULE_URL, ORT_WASM_BASE } from './models.js';
import { RoformerEngine } from './engine.js';
import { getModelFiles } from './model-store.js';
import { encodeWav } from './wav.js';

let engine = null;
let ortPromise = null;
let lastStems = null; // { name: [Float32Array, Float32Array] }
let abort = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function loadOrt() {
  if (!ortPromise) {
    ortPromise = import(/* @vite-ignore */ ORT_MODULE_URL).then((ort) => {
      ort.env.wasm.wasmPaths = ORT_WASM_BASE;
      // SharedArrayBuffer (multi-threaded WASM) needs cross-origin isolation.
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 1;
      ort.env.wasm.proxy = false;
      ort.env.logLevel = 'error';
      return ort;
    });
  }
  return ortPromise;
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
        lastStems = null;
        const { stems, backend, ms } = await eng.separate(msg.left, msg.right, {
          onProgress: (p) => post({ type: 'progress', ...p }),
        });
        lastStems = stems;
        const sr = MODELS[eng.model.id].sampleRate;
        const wavs = {};
        const transfer = [];
        for (const [name, ch] of Object.entries(stems)) {
          const buf = encodeWav(ch, sr, 'pcm16');
          wavs[name] = buf;
          transfer.push(buf);
        }
        post({ type: 'done', wavs, backend, ms, sampleRate: sr }, transfer);
        break;
      }
      case 'export': {
        if (!lastStems?.[msg.stem]) throw new Error('No separated audio available');
        const buf = encodeWav(lastStems[msg.stem], 44100, msg.format);
        post({ type: 'exported', reqId: msg.reqId, stem: msg.stem, format: msg.format, buffer: buf }, [buf]);
        break;
      }
      case 'cancel':
        engine?.cancel();
        abort?.abort();
        break;
      case 'release':
        lastStems = null;
        await engine?.unload();
        break;
      default:
        break;
    }
  } catch (e) {
    const cancelled = e?.name === 'CancelledError' || e?.name === 'AbortError';
    post({ type: 'error', cancelled, message: String(e?.message || e), name: e?.name });
  }
};
