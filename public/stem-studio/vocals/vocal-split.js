/** Main-thread controller for the lead / backing split of a vocal stem (vocal-worker.js). */
import { resampleStereo } from '../engine.js';
import { karaokeModel } from './karaoke-models.js';
import { KARA_SR } from './karaoke.js';

/** Workers cannot see the page URL, so forward its query string (?drummodel=, ?drummodel_htr=, ?karaokemodel= overrides). */
const withPageQuery = (u) => { u.search = globalThis.location?.search || ''; return u.href; };


const fit = (a, n) => { if (a.length === n) return a; const o = new Float32Array(n); o.set(a.subarray(0, Math.min(n, a.length))); return o; };

export class VocalSplitter {
  constructor(workerUrl = withPageQuery(new URL('./vocal-worker.js', import.meta.url))) { this.workerUrl = workerUrl; this.worker = null; this.rid = 0; this.pending = new Map(); }
  _w() {
    if (!this.worker) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
      this.worker.onmessage = (ev) => { const m = ev.data, p = this.pending.get(m.rid); if (!p) return; if (m.type === 'progress') p.onProgress?.(m); else { this.pending.delete(m.rid); m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m); } };
      this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'vocal worker failed')); this.pending.clear(); this.worker = null; };
    }
    return this.worker;
  }
  _call(msg, transfer, onProgress) { const rid = ++this.rid; return new Promise((resolve, reject) => { this.pending.set(rid, { resolve, reject, onProgress }); this._w().postMessage({ ...msg, rid }, transfer || []); }); }
  async probe() { try { return await this._call({ op: 'probe' }); } catch { return { available: false, url: karaokeModel().files[0].url }; } }
  cancel() { this.worker?.postMessage({ op: 'cancel' }); }
  split(msg, onProgress) { return this._call({ op: 'split', ...msg }, [msg.L.buffer, msg.R.buffer], onProgress); }
}

export const vocalChildrenOf = (eng, voc) => eng.tracks.filter((t) => t.parent === voc.id && (t.kind === 'lead' || t.kind === 'backing'));

export async function undoVocalSplit(eng, voc, { keepMuted = false } = {}) {
  const kids = vocalChildrenOf(eng, voc); if (!kids.length) return 0;
  for (const k of kids) await eng.removeTrack(k.id);
  if (!keepMuted) eng.setMix(voc, { mute: false });
  eng.emit('tracks'); return kids.length;
}

/** Split `voc` into "Lead vocal" + "Backing vocals" children (they sum exactly to the vocal stem). */
export async function splitVocalTrack(eng, splitter, voc, o = {}, onProgress = () => {}) {
  await undoVocalSplit(eng, voc, { keepMuted: true });
  const sr = eng.sr, N = voc.orig[0].length;
  const prep = async (ch) => (sr === KARA_SR ? [ch[0].slice(), ch[1].slice()] : (await resampleStereo(ch[0], ch[1], sr, KARA_SR)).map((a) => Float32Array.from(a)));
  const [L, R] = await prep(voc.orig);
  const text = { download: 'downloading model', verify: 'verifying model', init: 'starting the model', separate: 'separating' };
  const res = await splitter.split({ L, R, device: o.device || 'wasm', frames: o.frames },
    (m) => { const base = { download: [0, 0.4], verify: [0.4, 0.42], init: [0.42, 0.45], separate: [0.45, 0.98] }[m.phase] || [0, 1]; onProgress(base[0] + (base[1] - base[0]) * (m.fraction || 0), `${text[m.phase] || ''} ${Math.round((m.fraction || 0) * 100)}%`); });
  const made = [];
  for (const [key, name, kind] of [['lead', 'Lead vocal', 'lead'], ['backing', 'Backing vocals', 'backing']]) {
    let [cL, cR] = res[key];
    if (sr !== KARA_SR) [cL, cR] = (await resampleStereo(cL, cR, KARA_SR, sr)).map((a) => Float32Array.from(a));
    made.push(await eng.addTrack({ name, kind, L: fit(cL, N), R: fit(cR, N), sr, parent: voc.id, silentIfPresent: false }));
  }
  eng.setMix(voc, { mute: true }); eng.emit('tracks');
  return { tracks: made, backend: res.backend, ms: res.ms };
}
