/**
 * Module worker: DrumSep inference.  messages in:  {op:'split', rid, L, R, device?}  {op:'cancel'}  {op:'probe', rid}
 * out: {type:'progress', rid, phase, fraction, ...}  {type:'done', rid, parts, events, notes, backend, ms}  {type:'error', rid, message}
 */
import { ORT_MODULE_URL, ORT_WASM_BASE, ORT_CDN_MODULE_URL, ORT_CDN_BASE } from '../../roformer-web/models.js';
import { getModelFiles } from '../../roformer-web/model-store.js';
import { drumModel } from './drum-models.js';
import { separateLong } from './hdemucs.js';
import { dspDrumSplit } from './drum-dsp.js';
import { buildParts } from './pipeline.js';

let ortP = null, session = null, backend = null, cancelled = false;
const post = (m, tr = []) => self.postMessage(m, tr);

async function importOrt() {
  try {
    const ort = await import(/* @vite-ignore */ ORT_MODULE_URL);
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    const probe = await fetch(`${ORT_WASM_BASE}ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD' });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
    return ort;
  } catch (e) {
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
  const ort = await loadOrt(), model = drumModel();
  const files = await getModelFiles(model, (p) => post({ type: 'progress', rid, phase: p.verifying ? 'verify' : 'download', fraction: p.total ? p.loaded / p.total : 0, fromCache: !!p.fromCache, notice: p.notice }));
  post({ type: 'progress', rid, phase: 'init', fraction: 0 });
  const bytes = files[model.files[0].name];
  const mk = (ep) => ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  if (device === 'webgpu' && self.navigator?.gpu) { try { session = await mk({ name: 'webgpu' }); backend = 'webgpu'; } catch (e) { post({ type: 'progress', rid, phase: 'init', fraction: 0, notice: `WebGPU unavailable (${e.message || e}); using CPU.` }); } }
  if (!session) { session = await mk('wasm'); backend = 'wasm'; }
}

async function mlSeparate(rid, L, R, device) {
  await ensureSession(rid, device);
  const ort = await loadOrt(), model = drumModel(), W = model.window;
  const run = async (mix, mag, le) => {
    const res = await session.run({ mix: new ort.Tensor('float32', mix, [1, 2, W]), mag: new ort.Tensor('float32', mag, [1, 4, 2048, le]) });
    const f = res.freq_out.data, t = res.time_out.data;
    return { freq: f instanceof Float32Array ? f.slice() : Float32Array.from(f), time: t instanceof Float32Array ? t.slice() : Float32Array.from(t) };
  };
  const st = await separateLong({ L, R, run, W, S: 4, overlap: model.overlap, isCancelled: () => cancelled,
    onProgress: (f) => post({ type: 'progress', rid, phase: 'separate', fraction: f, backend }) });
  return { kick: st[0], snare: st[1], cymbals: st[2], toms: st[3] };
}

/** m: {rid, L, R, bass?:[L,R], mode:'ml'|'dsp', sr (=44100 for ml), device, opts} -> done {parts:[{key,name,kind,parent,L,R}], events, notes, backend, ms} */
async function split(m) {
  const t0 = Date.now(); cancelled = false; const { rid, L, R, mode, sr, opts = {} } = m, drums = [L, R];
  const bass = m.bass || null;
  const step = (phase, fraction = 0) => post({ type: 'progress', rid, phase, fraction, backend });
  let ml = null, dsp = null;
  if (mode === 'ml') ml = await mlSeparate(rid, L, R, m.device); else { step('dsp'); dsp = dspDrumSplit(L, R, sr, { onProgress: (f) => step('dsp', f) }); }
  step('post');
  const out = buildParts({ drums, bass, ml, dsp, sr, ...opts, onProgress: (p) => step('post') });
  const parts = out.parts.map((p) => ({ key: p.key, name: p.name, kind: p.kind, parent: p.parent, rmsDb: p.rmsDb, L: p.audio[0], R: p.audio[1] }));
  post({ type: 'done', rid, parts, events: out.events, notes: out.notes, backend: mode === 'ml' ? backend : 'dsp', ms: Date.now() - t0 }, parts.flatMap((p) => [p.L.buffer, p.R.buffer]));
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.op === 'cancel') { cancelled = true; return; }
  try {
    if (m.op === 'probe') { const model = drumModel(); const r = await fetch(model.files[0].url, { method: 'HEAD' }).catch(() => null); post({ type: 'done', rid: m.rid, available: !!r?.ok, url: model.files[0].url }); }
    else if (m.op === 'split') await split(m);
  } catch (e) { post({ type: 'error', rid: m.rid, message: e?.name === 'CancelledError' ? 'cancelled' : (e?.message || String(e)) }); }
};
