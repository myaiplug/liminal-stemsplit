/** Main-thread controller for the deeper drum split: talks to drum-worker.js and adds the results to the studio engine. */
import { resampleStereo } from '../engine.js';
import { drumModel } from './drum-models.js';

const MODEL_SR = 44100;
const fit = (a, n) => { if (a.length === n) return a; const o = new Float32Array(n); o.set(a.subarray(0, Math.min(n, a.length))); return o; };

export class DrumSplitter {
  constructor(workerUrl = new URL('./drum-worker.js', import.meta.url).href) { this.workerUrl = workerUrl; this.worker = null; this.rid = 0; this.pending = new Map(); }
  _w() {
    if (!this.worker) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
      this.worker.onmessage = (ev) => { const m = ev.data, p = this.pending.get(m.rid); if (!p) return; if (m.type === 'progress') p.onProgress?.(m); else { this.pending.delete(m.rid); m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m); } };
      this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'drum worker failed')); this.pending.clear(); this.worker = null; };
    }
    return this.worker;
  }
  _call(msg, transfer, onProgress) { const rid = ++this.rid; return new Promise((resolve, reject) => { this.pending.set(rid, { resolve, reject, onProgress }); this._w().postMessage({ ...msg, rid }, transfer || []); }); }
  /** is the ML model file reachable? */
  async probe() { try { return await this._call({ op: 'probe' }); } catch { return { available: false, url: drumModel().files[0].url }; } }
  cancel() { this.worker?.postMessage({ op: 'cancel' }); }
  terminate() { this.worker?.terminate(); this.worker = null; for (const p of this.pending.values()) p.reject(new Error('cancelled')); this.pending.clear(); }
  split(msg, onProgress) { const tr = [msg.L.buffer, msg.R.buffer, ...(msg.bass ? [msg.bass[0].buffer, msg.bass[1].buffer] : [])]; return this._call({ op: 'split', ...msg }, tr, onProgress); }
}

export const isDrumChild = (eng, t) => t.parent && eng.trackById(t.parent)?.kind === 'drums' || (t.parent && t.name === 'Bass (no sub)');
export const childrenOf = (eng, drum) => eng.tracks.filter((t) => t.parent === drum.id || (t.name === 'Bass (no sub)' && eng.trackById(t.parent)?.kind === 'bass'));

/**
 * Split `drum` into kick / snare / toms / hats / cymbals / 808 / remainder tracks.
 * @param {object} o { mode:'ml'|'dsp', hats:boolean, sub808:boolean, fc:number, device:'wasm'|'webgpu' }
 * @param {(fraction:number, text?:string)=>void} onProgress
 */
export async function splitDrumTrack(eng, splitter, drum, o, onProgress = () => {}) {
  await undoDrumSplit(eng, drum, { keepMuted: true });
  const sr = eng.sr, N = drum.orig[0].length, bassT = eng.tracks.find((t) => t.kind === 'bass' && !t.parent) || null;
  const useSr = o.mode === 'ml' ? MODEL_SR : sr;
  const prep = async (ch) => (sr === useSr ? [ch[0].slice(), ch[1].slice()] : (await resampleStereo(ch[0], ch[1], sr, useSr)).map((a) => Float32Array.from(a)));
  const L0 = await prep(drum.orig), bass = o.sub808 && bassT ? await prep(bassT.orig) : null;
  const text = { download: 'downloading model', verify: 'verifying model', init: 'starting the model', separate: 'separating', dsp: 'analysing', post: 'splitting hats and 808' };
  const res = await splitter.split({ L: L0[0], R: L0[1], bass, mode: o.mode, sr: useSr, device: o.device || 'wasm', opts: { splitHats: o.hats, sub808: o.sub808, fc: o.fc, minTailMs: o.minTailMs } },
    (m) => { const base = { download: [0, 0.3], verify: [0.3, 0.32], init: [0.32, 0.35], separate: [0.35, 0.92], dsp: [0.05, 0.92], post: [0.93, 0.96] }[m.phase] || [0, 1]; onProgress(base[0] + (base[1] - base[0]) * (m.fraction || 0), text[m.phase] + (m.phase === 'download' ? ` ${Math.round((m.fraction || 0) * 100)}%` : m.phase === 'separate' ? ` ${Math.round((m.fraction || 0) * 100)}%` : '')); });
  const made = [];
  for (const p of res.parts) {
    let L = p.L, R = p.R;
    if (useSr !== sr) [L, R] = (await resampleStereo(L, R, useSr, sr)).map((a) => Float32Array.from(a));
    const parent = p.parent === 'bass' ? bassT.id : drum.id;
    made.push(await eng.addTrack({ name: p.name, kind: p.kind, L: fit(L, N), R: fit(R, N), sr, parent, silentIfPresent: false }));
  }
  eng.setMix(drum, { mute: true }); if (res.parts.some((p) => p.parent === 'bass') && bassT) eng.setMix(bassT, { mute: true });
  eng.emit('tracks');
  return { tracks: made, notes: res.notes, events: res.events, backend: res.backend, ms: res.ms, remainderDb: res.parts.find((p) => p.key === 'remainder')?.rmsDb };
}

export async function undoDrumSplit(eng, drum, { keepMuted = false } = {}) {
  const kids = childrenOf(eng, drum); if (!kids.length) return 0;
  const bassParents = new Set(kids.filter((k) => k.parent !== drum.id).map((k) => k.parent));
  for (const k of kids) await eng.removeTrack(k.id);
  if (!keepMuted) { eng.setMix(drum, { mute: false }); for (const b of bassParents) { const t = eng.trackById(b); if (t) eng.setMix(t, { mute: false }); } }
  eng.emit('tracks'); return kids.length;
}
