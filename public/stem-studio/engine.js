/**
 * Stem Studio engine: project model, real-time preview (Web Audio + AudioWorklet), offline render at the source
 * sample rate, loudness, artifact fixes, export and sessions. No DOM here; the UI listens to 'change' events.
 *
 *   track pipeline:  original --(artifact fixes, worker, deterministic)--> --(edits: trim/cut/silence)--> FX chain (worklet) --> gain/pan
 */
import { applyEdits, editedLength, hasEdits, normalizeEdits, unmapTime, mapTime } from './edits.js';
import { chainLatency, chainTail } from './dsp/chain.js';
import { MODULES, presetsFor, chainFromPreset, blankChain, stemKind, STEM_KINDS, defaultParams } from './presets.js';
import { encodeTaggedWav, encodeMp3, loadLame, zipFiles, safeName, BRAND_LIMINAL } from './export.js';
import { LOUDNESS_TARGETS } from './dsp/loudness.js';
import * as store from './storage.js';

const HERE = new URL('.', import.meta.url);
export const dbToLin = (d) => 10 ** (d / 20);
const uid = (p = 't') => `${p}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const PEAK_BLOCK = 256;
const activeChain = (chain) => chain.filter((m) => m.enabled).map((m) => ({ type: m.type, enabled: true, params: m.params }));

export class StudioEngine extends EventTarget {
  constructor({ brand = BRAND_LIMINAL, workletUrl = new URL('dsp/worklet.js', HERE).href, workerUrl = new URL('studio-worker.js', HERE).href, fflateUrl = new URL('../roformer-web/vendor/fflate/fflate.mjs', HERE).href, lameUrl } = {}) {
    super();
    this.brand = brand; this.workletUrl = workletUrl; this.workerUrl = workerUrl; this.fflateUrl = fflateUrl; this.lameUrl = lameUrl;
    this.project = { id: uid('s'), name: 'Untitled session', sr: 44100, meta: { title: '', artist: '' }, notes: [] };
    this.tracks = []; this.selected = null; this.fxBypassAll = false;
    this.ctx = null; this.nodes = new Map(); this.playing = false; this.pos = 0; this._startedAt = 0; this._startPos = 0; this.sources = [];
    this.dirtyAudio = new Set(); this._rid = 0; this._pending = new Map(); this.worker = null;
    this.activity = null;
  }
  emit(what, detail) { this.dispatchEvent(new CustomEvent('change', { detail: { what, ...detail } })); }

  /* ------------------------------------------------------------ worker rpc */
  _w() {
    if (!this.worker) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
      this.worker.onmessage = (ev) => {
        const m = ev.data, p = this._pending.get(m.rid); if (!p) return;
        if (m.type === 'progress') { p.onProgress?.(m.fraction, m.phase); return; }
        this._pending.delete(m.rid); if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.result);
      };
      this.worker.onerror = (e) => { for (const p of this._pending.values()) p.reject(new Error(e.message || 'worker error')); this._pending.clear(); };
    }
    return this.worker;
  }
  call(op, payload = {}, transfer = [], onProgress) {
    const rid = ++this._rid;
    return new Promise((resolve, reject) => { this._pending.set(rid, { resolve, reject, onProgress }); this._w().postMessage({ op, rid, ...payload }, transfer); });
  }
  setActivity(a) { this.activity = a; this.emit('activity', { activity: a }); }

  /* ------------------------------------------------------------ tracks */
  get sr() { return this.project.sr; }
  trackById(id) { return this.tracks.find((t) => t.id === id); }
  get frames() { return this.tracks.reduce((m, t) => Math.max(m, t.orig[0].length), 0); }
  /** length in seconds of the edited (played / exported) timeline */
  get duration() { return this.tracks.reduce((m, t) => Math.max(m, this.editedFrames(t)), 0) / this.sr; }
  editedFrames(t) { return editedLength(t.orig[0].length, this.sr, t.edits); }

  async addTrack({ name, L, R, sr, kind, id, silentIfPresent, parent } = {}) {
    if (this.tracks.length === 0) this.project.sr = sr;
    if (sr !== this.project.sr) { [L, R] = await resampleStereo(L, R, sr, this.project.sr); this.project.notes.push(`"${name}" was ${sr} Hz and was resampled to ${this.project.sr} Hz to match the session.`); }
    L = new Float32Array(L); R = R ? new Float32Array(R) : L.slice();
    const k = kind || stemKind(name);
    const t = { id: id || uid(), name, kind: k, orig: [L, R], fixed: null, fixes: [], fixesOn: true, edits: { trim: null, ops: [] }, chain: blankChain(k), presetId: null,
      gain: 0, pan: 0, mute: false, solo: false, bypass: false, issues: null, metrics: null, loud: null, parent: parent || null, _work: null, peaks: null };
    this.tracks.push(t); this.dirtyAudio.add(t.id);
    await this.call('put', { id: t.id, L: L.slice(), R: R.slice(), sr: this.sr, name }, []);
    this.computePeaks(t); this._invalidate(t);
    if (!this.selected) this.selected = t.id;
    if (this.ctx) this._buildNodes(t);
    this.emit('tracks'); return t;
  }
  async removeTrack(id) {
    const i = this.tracks.findIndex((t) => t.id === id); if (i < 0) return;
    this.tracks.splice(i, 1); this.dirtyAudio.delete(id); const n = this.nodes.get(id); if (n) { n.src?.disconnect?.(); n.fx.disconnect(); n.mute.disconnect(); this.nodes.delete(id); }
    await this.call('drop', { id }); if (this.selected === id) this.selected = this.tracks[0]?.id || null;
    this.emit('tracks');
  }
  clear() { for (const t of [...this.tracks]) this.removeTrack(t.id); this.project = { id: uid('s'), name: 'Untitled session', sr: 44100, meta: { title: '', artist: '' }, notes: [] }; this.stop(); this.dirtyAudio.clear(); }

  computePeaks(t) {
    const L = t.orig[0], R = t.orig[1], n = Math.ceil(L.length / PEAK_BLOCK), mn = new Float32Array(n), mx = new Float32Array(n);
    for (let b = 0; b < n; b++) { let lo = 1, hi = -1; const e = Math.min(L.length, (b + 1) * PEAK_BLOCK); for (let i = b * PEAK_BLOCK; i < e; i++) { const v = (L[i] + R[i]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; } mn[b] = lo; mx[b] = hi; }
    t.peaks = { block: PEAK_BLOCK, min: mn, max: mx };
  }

  /* ------------------------------------------------------------ derived audio */
  _invalidate(t) { t._work = null; t.loud = null; this._buf = null; }
  /** audio that is played/exported before the FX chain: fixes then edits */
  workAudio(t) {
    const key = `${t.fixesOn && t.fixed ? 1 : 0}|${JSON.stringify(t.edits)}`;
    if (t._work && t._work.key === key) return t._work;
    const src = t.fixesOn && t.fixed ? t.fixed : t.orig;
    const ch = applyEdits(src, this.sr, t.edits);
    t._work = { key, L: ch[0], R: ch[1], buffer: null }; return t._work;
  }
  audioBuffer(t) {
    const w = this.workAudio(t);
    if (!w.buffer || w.buffer.sampleRate !== this.sr) { w.buffer = new AudioBuffer({ length: w.L.length, numberOfChannels: 2, sampleRate: this.sr }); w.buffer.copyToChannel(w.L, 0); w.buffer.copyToChannel(w.R, 1); }
    return w.buffer;
  }

  /* ------------------------------------------------------------ editing */
  setEdits(ids, fn) {
    for (const id of ids) { const t = this.trackById(id); if (!t) continue; t.edits = fn(JSON.parse(JSON.stringify(t.edits)), t) || t.edits; this._invalidate(t); }
    if (this.playing) this._restartAt(this.pos); this.clampPos(); this.emit('edits');
  }
  addCut(ids, start, end, type = 'cut') { this.setEdits(ids, (e) => { e.ops.push({ type, start, end }); return e; }); }
  trimTo(ids, start, end) { this.setEdits(ids, (e) => { e.trim = { start, end }; return e; }); }
  resetEdits(ids) { this.setEdits(ids, () => ({ trim: null, ops: [] })); }
  undoEdit(ids) { this.setEdits(ids, (e) => { if (e.ops.length) e.ops.pop(); else e.trim = null; return e; }); }
  clampPos() { this.pos = Math.min(this.pos, this.duration); }

  setFx(t, chain, presetId = null) { t.chain = chain; t.presetId = presetId; t.loud = null; this._pushChain(t); this.emit('fx', { id: t.id }); }
  applyPreset(t, presetId) {
    const p = presetsFor(t.kind).find((x) => x.id === presetId);
    this.setFx(t, p ? chainFromPreset(t.kind, p) : blankChain(t.kind), p ? p.id : null);
  }
  setParam(t, idx, key, value) { t.chain[idx].params[key] = value; t.presetId = t.presetId ? `${t.presetId}*` : null; t.loud = null; this._pushChain(t); this.emit('fx', { id: t.id, soft: true }); }
  setEnabled(t, idx, on) { t.chain[idx].enabled = on; t.presetId = t.presetId ? `${t.presetId}*` : null; t.loud = null; this._pushChain(t); this.emit('fx', { id: t.id }); }
  setMix(t, patch) { Object.assign(t, patch); t.loud = null; this._pushMix(); this.emit('mix', { id: t.id }); }
  setKind(t, kind) { t.kind = kind; t.chain = blankChain(kind); t.presetId = null; this._pushChain(t); this.emit('fx', { id: t.id }); }

  /* ------------------------------------------------------------ preview graph */
  async ensureCtx() {
    if (this.ctx && this.ctx.sampleRate === this.sr) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return this.ctx; }
    if (this.ctx) { this.stop(); try { await this.ctx.close(); } catch {} this.nodes.clear(); }
    this.ctx = new AudioContext({ sampleRate: this.sr, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.master = this.ctx.createGain(); this.masterAn = this.ctx.createAnalyser(); this.masterAn.fftSize = 2048; this.master.connect(this.masterAn); this.masterAn.connect(this.ctx.destination);
    for (const t of this.tracks) this._buildNodes(t);
    this._pushMix(); this._pushAllChains();
    return this.ctx;
  }
  _buildNodes(t) {
    const c = this.ctx;
    const fx = new AudioWorkletNode(c, 'studio-chain', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { chain: activeChain(t.chain), comp: 0, bypass: t.bypass || this.fxBypassAll, gain: dbToLin(t.gain), pan: t.pan } });
    const an = c.createAnalyser(); an.fftSize = 1024; const mute = c.createGain();
    fx.connect(an); an.connect(mute); mute.connect(this.master);
    this.nodes.set(t.id, { fx, an, mute, src: null, lat: 0 });
  }
  _pushChain(t) { const n = this.nodes.get(t.id); if (!n) return; n.fx.port.postMessage({ type: 'config', chain: activeChain(t.chain) }); clearTimeout(this._compT); this._compT = setTimeout(() => this._pushComp(), 120); }
  _pushAllChains() { for (const t of this.tracks) this._pushChain(t); this._pushComp(); }
  _latencyOf(t) { return chainLatency(activeChain(t.chain), this.sr); }
  _pushComp() {
    if (!this.ctx) return; const lats = this.tracks.map((t) => this._latencyOf(t)); this.maxLat = Math.max(0, ...lats);
    this.tracks.forEach((t, i) => this.nodes.get(t.id)?.fx.port.postMessage({ type: 'comp', samples: this.maxLat - lats[i] }));
  }
  _pushMix() {
    if (!this.ctx) return; const anySolo = this.tracks.some((t) => t.solo);
    for (const t of this.tracks) {
      const n = this.nodes.get(t.id); if (!n) continue;
      n.fx.port.postMessage({ type: 'out', gain: dbToLin(t.gain), pan: t.pan }); n.fx.port.postMessage({ type: 'bypass', value: t.bypass || this.fxBypassAll });
      const audible = anySolo ? t.solo : !t.mute; n.mute.gain.setTargetAtTime(audible ? 1 : 0, this.ctx.currentTime, 0.01);
    }
  }
  setFxBypassAll(v) { this.fxBypassAll = v; this._pushMix(); this.emit('mix'); }
  setFixesPreview(t, on) { t.fixesOn = on; t._work = null; if (this.playing) this._restartAt(this.pos); this.emit('fixes', { id: t.id }); }

  position() { return this.playing ? Math.min(this.duration, this._startPos + (this.ctx.currentTime - this._startedAt)) : this.pos; }
  async play(from = this.pos) {
    if (!this.tracks.length) return; await this.ensureCtx(); this._stopSources(); if (from >= this.duration - 0.01) from = 0;
    this._pushComp(); this._pushMix();
    const when = this.ctx.currentTime + 0.05; this._startedAt = when; this._startPos = from; this.pos = from; this.playing = true;
    let first = true;
    for (const t of this.tracks) {
      const n = this.nodes.get(t.id); n.fx.port.postMessage({ type: 'reset' });
      const buf = this.audioBuffer(t), off = from; if (off >= buf.duration) continue;
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(n.fx); s.start(when, off); n.src = s; this.sources.push(s);
      if (first) { s.onended = () => { if (this.playing && this.sources[0] === s && this.position() >= this.duration - 0.05) { this.stop(); this.emit('transport'); } }; first = false; }
    }
    this.emit('transport');
  }
  _stopSources() { for (const s of this.sources) { s.onended = null; try { s.stop(); } catch {} s.disconnect(); } this.sources = []; }
  pause() { if (!this.playing) return; this.pos = this.position(); this.playing = false; this._stopSources(); this.emit('transport'); }
  stop() { this.playing = false; this.pos = 0; this._stopSources(); this.emit('transport'); }
  seek(t) { this.pos = Math.max(0, Math.min(this.duration, t)); if (this.playing) this._restartAt(this.pos); this.emit('transport'); }
  _restartAt(t) { if (!this.ctx) return; const was = this.playing; this._stopSources(); this.playing = false; if (was) this.play(Math.min(t, this.duration)); }
  /** original-timeline seconds of the playhead (the lanes show the original timeline) */
  playheadOriginal(t) { return unmapTime(this.position(), this.sr, t.orig[0].length, t.edits); }
  levelOf(id) { const n = this.nodes.get(id); if (!n || !this.playing) return 0; const a = new Float32Array(n.an.fftSize); n.an.getFloatTimeDomainData(a); let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }

  /* ------------------------------------------------------------ offline render (export & measurement) */
  /** Render one track through its chain + gain/pan at the session sample rate. Returns planar arrays of the edited length (+ FX tail). */
  async renderTrack(t, { tail = false, bypass } = {}) {
    const w = this.workAudio(t), N = w.L.length, sr = this.sr, chain = activeChain(t.chain), lat = chainLatency(chain, sr);
    const tailN = tail ? Math.ceil(Math.min(30, chainTail(chain, sr)) * sr) : 0, total = N + tailN + lat;
    const oc = new OfflineAudioContext({ numberOfChannels: 2, length: total, sampleRate: sr });
    await oc.audioWorklet.addModule(this.workletUrl);
    const node = new AudioWorkletNode(oc, 'studio-chain', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { chain, comp: 0, bypass: bypass ?? (t.bypass || this.fxBypassAll), gain: dbToLin(t.gain), pan: t.pan } });
    const buf = oc.createBuffer(2, Math.max(1, N), sr); buf.copyToChannel(w.L, 0); buf.copyToChannel(w.R, 1);
    const src = oc.createBufferSource(); src.buffer = buf; src.connect(node); node.connect(oc.destination); src.start(0);
    const out = await oc.startRendering();
    const L = out.getChannelData(0).slice(lat, lat + N + tailN), R = out.getChannelData(1).slice(lat, lat + N + tailN);
    return { L, R, lat, tailN };
  }
  _audible(t) { const anySolo = this.tracks.some((x) => x.solo); return anySolo ? t.solo : !t.mute; }
  async measureTrack(t) {
    const r = await this.renderTrack(t); t.loud = await this.call('loudness', { L: r.L, R: r.R, sr: this.sr }, [r.L.buffer, r.R.buffer]); this.emit('loudness', { id: t.id }); return t.loud;
  }
  async measureMix() {
    const parts = []; for (const t of this.tracks) if (this._audible(t)) parts.push(await this.renderTrack(t));
    if (!parts.length) return null; const N = Math.max(...parts.map((p) => p.L.length)), L = new Float32Array(N), R = new Float32Array(N);
    for (const p of parts) for (let i = 0; i < p.L.length; i++) { L[i] += p.L[i]; R[i] += p.R[i]; }
    this.mixLoud = await this.call('loudness', { L, R, sr: this.sr }, [L.buffer, R.buffer]); this.emit('loudness', { id: 'mix' }); return this.mixLoud;
  }
  /** gain (dB) that brings the track's loudness to `lufs` without changing anything else; applied to the track fader */
  async matchTrackLufs(t, lufs) {
    const l = t.loud || await this.measureTrack(t); if (!Number.isFinite(l.integrated)) return null;
    const g = Math.max(-40, Math.min(40, lufs - l.integrated)); this.setMix(t, { gain: Math.round((t.gain + g) * 100) / 100 }); return g;
  }

  /* ------------------------------------------------------------ artifacts */
  async analyze(t, onProgress) {
    const others = this.tracks.filter((x) => x.id !== t.id && (x.parent || null) === (t.parent || null)).map((x) => ({ id: x.id, name: x.name }));
    const r = await this.call('analyze', { id: t.id, kind: t.kind, others }, [], onProgress); t.issues = r.issues; t.metrics = r.metrics; this.emit('issues', { id: t.id }); return r;
  }
  async addFix(t, fix, onProgress) {
    const f = { id: uid('f'), type: fix.type, label: fix.label, params: { ...(fix.params || {}) } }; t.fixes.push(f); await this._recomputeFixes(t, onProgress); return f;
  }
  async removeFix(t, fid, onProgress) { t.fixes = t.fixes.filter((f) => f.id !== fid); await this._recomputeFixes(t, onProgress); }
  async _recomputeFixes(t, onProgress) {
    if (!t.fixes.length) { t.fixed = null; } else {
      const others = this.tracks.filter((x) => x.id !== t.id).map((x) => ({ id: x.id, name: x.name }));
      const r = await this.call('fix', { id: t.id, fixes: t.fixes.map(({ type, params }) => ({ type, params })), others }, [], onProgress);
      t.fixed = [r.L, r.R]; t.fixes.forEach((f, i) => { f.summary = r.summaries[i]; });
    }
    t.fixesOn = true; this._invalidate(t); if (this.playing) this._restartAt(this.pos); this.emit('fixes', { id: t.id });
  }

  /* ------------------------------------------------------------ export */
  /**
   * @param {{format:'pcm24'|'pcm16'|'float32'|'mp3', normalize:'off'|'mix'|'each', target?:{lufs:number,tp:number}, tail:boolean, ids?:string[], mix:boolean, zip:boolean, title?, artist?, mp3kbps?}} o
   * @returns {Promise<{files:{name:string,data:Uint8Array,mime:string,info?:object}[], report:object[]}>}
   */
  async exportAll(o, onProgress = () => {}) {
    const sr = this.sr, ids = o.ids || this.tracks.map((t) => t.id), tracks = ids.map((i) => this.trackById(i)).filter(Boolean);
    const base = safeName(o.title || this.project.name), meta = { title: o.title || this.project.name, artist: o.artist || '', album: this.project.name };
    const files = [], report = []; const rendered = new Map();
    const steps = tracks.length + (o.mix ? 1 : 0); let done = 0; const tick = (label) => onProgress(++done / (steps * 2), label);
    for (const t of tracks) { rendered.set(t.id, await this.renderTrack(t, { tail: o.tail })); tick(`Rendered ${t.name}`); }
    if (o.tail && rendered.size > 1) { // with effect tails, give every stem the same length so they line up when dropped in a DAW
      const n = Math.max(...[...rendered.values()].map((r) => r.L.length)); const pad = (a) => { if (a.length === n) return a; const b = new Float32Array(n); b.set(a); return b; };
      for (const [k, r] of rendered) rendered.set(k, { ...r, L: pad(r.L), R: pad(r.R) });
    }
    let mixGainDb = 0, mixRes = null;
    const mixSources = this.tracks.filter((t) => this._audible(t));
    if (o.mix || o.normalize === 'mix') {
      const parts = []; for (const t of mixSources) parts.push(rendered.get(t.id) || await this.renderTrack(t, { tail: o.tail }));
      if (parts.length) {
        const N = Math.max(...parts.map((p) => p.L.length)); let L = new Float32Array(N), R = new Float32Array(N);
        for (const p of parts) for (let i = 0; i < p.L.length; i++) { L[i] += p.L[i]; R[i] += p.R[i]; }
        mixRes = { L, R };
        if (o.normalize === 'mix' && o.target) {
          const nr = await this.call('normalize', { L: L.slice(), R: R.slice(), sr, lufs: o.target.lufs, tp: o.target.tp }, []);
          mixGainDb = nr.gainDb; mixRes = { L: nr.L, R: nr.R, norm: nr };
        }
      }
    }
    const enc = async (name, L, R, stem) => {
      if (o.format === 'mp3') { const lame = await loadLame(this.lameUrl); const d = await encodeMp3(lame, [L, R], sr, o.mp3kbps || 256, { ...meta, stem }, this.brand); return { name: `${name}.mp3`, data: d, mime: 'audio/mpeg' }; }
      return { name: `${name}.wav`, data: encodeTaggedWav([L, R], sr, o.format, { ...meta, stem }, this.brand), mime: 'audio/wav' };
    };
    for (const t of tracks) {
      let { L, R } = rendered.get(t.id), note = null, lufsInfo = null;
      if (o.normalize === 'each' && o.target) { const nr = await this.call('normalize', { L, R, sr, lufs: o.target.lufs, tp: o.target.tp }, [L.buffer, R.buffer]); L = nr.L; R = nr.R; lufsInfo = nr.after; note = nr.limited ? `limited to ${o.target.tp} dBTP` : null; }
      else if (o.normalize === 'mix' && mixGainDb) { const k = dbToLin(mixGainDb); L = L.map((x) => x * k); R = R.map((x) => x * k); }
      const f = await enc(`${base}_${safeName(t.name)}`, L, R, t.name); f.info = { kind: 'stem', stem: t.name, frames: L.length, sampleRate: sr }; files.push(f);
      report.push({ file: f.name, stem: t.name, frames: L.length, sampleRate: sr, lufs: lufsInfo?.integrated ?? null, note, ...(lufsInfo ? { tp: lufsInfo.truePeakDb } : {}) }); tick(`Encoded ${t.name}`);
    }
    if (o.mix && mixRes) {
      const f = await enc(`${base}_mix`, mixRes.L, mixRes.R, 'mix'); f.info = { kind: 'mix', frames: mixRes.L.length, sampleRate: sr }; files.push(f);
      const after = mixRes.norm?.after; report.push({ file: f.name, stem: 'mix', frames: mixRes.L.length, sampleRate: sr, lufs: after?.integrated ?? null, tp: after?.truePeakDb ?? null, gainDb: mixGainDb, note: mixRes.norm?.limited ? `limited to ${o.target.tp} dBTP` : (mixRes.norm?.note || null) }); tick('Encoded mix');
    }
    if (o.zip) {
      const fflate = await import(this.fflateUrl); const zip = zipFiles(fflate, files.map((f) => ({ name: f.name, data: f.data })));
      return { files: [{ name: `${base}_stems.zip`, data: zip, mime: 'application/zip' }], report, inner: files };
    }
    return { files, report };
  }

  /* ------------------------------------------------------------ sessions */
  serialize() {
    const dur = this.duration;
    return { id: this.project.id, name: this.project.name, sr: this.sr, meta: this.project.meta, notes: this.project.notes, selected: this.selected, fxBypassAll: this.fxBypassAll, durationSec: dur,
      tracks: this.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, parent: t.parent, gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo, bypass: t.bypass, chain: t.chain, presetId: t.presetId,
        fixes: t.fixes, fixesOn: t.fixesOn, edits: t.edits, frames: t.orig[0].length, issues: t.issues, metrics: t.metrics })) };
  }
  async saveSession(name, onProgress) {
    if (name) this.project.name = name; const doc = this.serialize(); const audio = new Map(); for (const id of this.dirtyAudio) { const t = this.trackById(id); if (t) audio.set(id, t.orig); }
    const saved = await store.saveSession(doc, audio, { onProgress }); this.dirtyAudio.clear(); this.emit('saved', { savedAt: saved.savedAt }); return saved;
  }
  async loadSession(id) {
    const { session, audio } = await store.loadSession(id); this.stop(); for (const t of [...this.tracks]) await this.removeTrack(t.id);
    this.project = { id: session.id, name: session.name, sr: session.sr, meta: session.meta || { title: '', artist: '' }, notes: session.notes || [] }; this.fxBypassAll = !!session.fxBypassAll;
    if (this.ctx && this.ctx.sampleRate !== session.sr) { try { await this.ctx.close(); } catch {} this.ctx = null; this.nodes.clear(); }
    for (const st of session.tracks) {
      const [L, R] = audio.get(st.id); const t = await this.addTrack({ name: st.name, L, R, sr: session.sr, kind: st.kind, id: st.id, parent: st.parent });
      Object.assign(t, { gain: st.gain, pan: st.pan, mute: st.mute, solo: st.solo, bypass: st.bypass, chain: st.chain, presetId: st.presetId, edits: st.edits, issues: st.issues, metrics: st.metrics, fixes: [], fixesOn: st.fixesOn });
      this.dirtyAudio.delete(t.id);
      if (st.fixes?.length) { t.fixes = st.fixes.map((f) => ({ ...f })); }
    }
    for (const t of this.tracks) if (t.fixes.length) await this._recomputeFixes(t); // deterministic: same fixes on the same original audio
    for (const st of session.tracks) { const t = this.trackById(st.id); t.fixesOn = st.fixesOn; t._work = null; }
    this.selected = session.selected && this.trackById(session.selected) ? session.selected : this.tracks[0]?.id || null;
    this.dirtyAudio.clear(); this.emit('tracks'); this.emit('fx'); this.emit('mix'); return session;
  }
}
export const listSessions = store.listSessions, deleteSession = store.deleteSession;
export { LOUDNESS_TARGETS, STEM_KINDS, presetsFor, MODULES, defaultParams, hasEdits, normalizeEdits, mapTime, unmapTime };

/** High-quality resample through the browser's OfflineAudioContext (only used when imported files disagree on sample rate). */
export async function resampleStereo(L, R, from, to) {
  const oc = new OfflineAudioContext(2, Math.ceil(L.length * to / from), to), b = oc.createBuffer(2, L.length, from); b.copyToChannel(L, 0); b.copyToChannel(R || L, 1);
  const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start(); const o = await oc.startRendering(); return [o.getChannelData(0), o.getChannelData(1)];
}
