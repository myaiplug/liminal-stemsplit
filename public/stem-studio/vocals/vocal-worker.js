/**
 * Module worker: lead / backing vocal split.  in: {op:'split', rid, L, R, device?, frames?} {op:'cancel'} {op:'probe', rid}
 * out: {type:'progress', rid, phase, fraction} {type:'done', rid, lead:[L,R], backing:[L,R], backend, ms} {type:'error', rid, message}
 */
import { ORT_MODULE_URL, ORT_WASM_BASE, ORT_CDN_MODULE_URL, ORT_CDN_BASE } from '../../roformer-web/models.js';
import { getModelFiles } from '../../roformer-web/model-store.js';
import { karaokeModel } from './karaoke-models.js';
import { separateLeadBacking, KARA_FEAT } from './karaoke.js';

let ortP = null, session = null, backend = null, cancelled = false;
const post = (m, tr = []) => self.postMessage(m, tr);

async function importOrt() {
  try {
    const ort = await import(/* @vite-ignore */ ORT_MODULE_URL);
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    const probe = await fetch(`${ORT_WASM_BASE}ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD' });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
    return ort;
  } catch {
    const ort = await import(/* @vite-ignore */ ORT_CDN_MODULE_URL);
    ort.env.wasm.wasmPaths = ORT_CDN_BASE; return ort;
  }
}
const loadOrt = () => (ortP ||= importOrt().then((ort) => {
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 1;
  ort.env.wasm.proxy = false; ort.env.logLevel = 'error'; return ort;
}));

async function ensureSession(rid, device) {
  if (session) return;
  const ort = await loadOrt(), model = karaokeModel();
  const files = await getModelFiles(model, (p) => post({ type: 'progress', rid, phase: p.verifying ? 'verify' : 'download', fraction: p.total ? p.loaded / p.total : 0, notice: p.notice }));
  post({ type: 'progress', rid, phase: 'init', fraction: 0 });
  const bytes = files[model.files[0].name];
  const mk = (ep) => ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  if (device === 'webgpu' && self.navigator?.gpu) {
    try { session = await mk({ name: 'webgpu', storageBufferCacheMode: 'simple' }); backend = 'webgpu'; }
    catch (e) { post({ type: 'progress', rid, phase: 'init', fraction: 0, notice: `WebGPU unavailable (${e.message || e}); using CPU.` }); }
  }
  if (!session) { session = await mk('wasm'); backend = 'wasm'; }
}

async function split(m) {
  const t0 = Date.now(); cancelled = false;
  await ensureSession(m.rid, m.device);
  const ort = await loadOrt();
  const run = async (feats, T) => {
    const r = await session.run({ stft_features: new ort.Tensor('float32', feats, [1, T, KARA_FEAT]) });
    const d = r.mask.data; return d instanceof Float32Array ? d : Float32Array.from(d);
  };
  const out = await separateLeadBacking({ L: m.L, R: m.R, run, frames: m.frames || undefined, isCancelled: () => cancelled,
    onProgress: (f) => post({ type: 'progress', rid: m.rid, phase: 'separate', fraction: f, backend }) });
  post({ type: 'done', rid: m.rid, lead: out.lead, backing: out.backing, backend, ms: Date.now() - t0 },
    [out.lead[0].buffer, out.lead[1].buffer, out.backing[0].buffer, out.backing[1].buffer]);
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.op === 'cancel') { cancelled = true; return; }
  try {
    if (m.op === 'probe') { const url = karaokeModel().files[0].url; const r = await fetch(url, { method: 'HEAD' }).catch(() => null); post({ type: 'done', rid: m.rid, available: !!r?.ok, url }); }
    else if (m.op === 'split') await split(m);
  } catch (e) { post({ type: 'error', rid: m.rid, message: e?.name === 'CancelledError' ? 'cancelled' : (e?.message || String(e)) }); }
};
