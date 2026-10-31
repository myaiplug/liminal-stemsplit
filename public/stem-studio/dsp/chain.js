import { Gate, DeReverb, Compressor, Limiter, Maximizer, DeEsser } from './fx-dynamics.js';
import { Peq, Eq3, DjFilter, GainFx, Saturation, Drive, Bitcrush, StereoWidth } from './fx-tone.js';
import { Reverb, Delay, Chorus, Phaser, Pitch } from './fx-time.js';

/** type id -> effect class. Ids 1-14 are the desktop module ids; the rest are Studio primitives. */
export const FX_TYPES = {
  gate: Gate, dereverb: DeReverb, deesser: DeEsser, compressor: Compressor, eq: Eq3, saturation: Saturation,
  reverb: Reverb, delay: Delay, chorus: Chorus, loudness: Maximizer, 'stereo-width': StereoWidth,
  filter: DjFilter, phaser: Phaser, pitch: Pitch,
  peq: Peq, gain: GainFx, limiter: Limiter, drive: Drive, bitcrush: Bitcrush,
};

export function createFx(type, sr, params) {
  const C = FX_TYPES[type];
  if (!C) throw new Error(`unknown effect type "${type}"`);
  return new C(sr, params);
}

/**
 * A serial effects chain (config: [{ id?, type, enabled?, params }]) with
 *  - per-module state kept across config updates (so knobs can move while playing),
 *  - total latency reporting + an internal compensation delay (`comp` samples) so that stems with
 *    different latencies stay phase aligned,
 *  - click-free bypass (A/B): the dry path is delayed by exactly the chain latency.
 */
export class Chain {
  constructor(sr, config = [], { comp = 0 } = {}) {
    this.sr = sr; this.mods = []; this.byId = new Map();
    this.bypassTarget = 0; this.bypassMix = 0; // 0 = wet, 1 = dry
    this.setConfig(config);
    this.setComp(comp);
  }
  setConfig(config) {
    const next = [], byId = new Map();
    (config || []).forEach((m, i) => {
      if (m.enabled === false) return;
      const id = m.id || `${m.type}#${i}`;
      let inst = this.byId.get(id);
      if (inst && inst.type === m.type) inst.fx.setParams(m.params || {});
      else inst = { type: m.type, fx: createFx(m.type, this.sr, m.params || {}) };
      byId.set(id, inst); next.push(inst);
    });
    this.mods = next; this.byId = byId;
    this._lat = this.mods.reduce((a, m) => a + m.fx.latency, 0);
    this.ensureDry();
  }
  get latency() { return this.mods.reduce((a, m) => a + m.fx.latency, 0); }
  get tailSeconds() { return this.mods.reduce((a, m) => a + m.fx.tailSeconds, 0); }
  setComp(samples) { this.comp = Math.max(0, samples | 0); this.compBuf = null; this.ensureDry(); }
  setBypass(b) { this.bypassTarget = b ? 1 : 0; }
  ensureDry() {
    const d = Math.max(1, this.latency + (this.comp || 0));
    if (!this.dry || this.dryLen !== d) { this.dry = [new Float32Array(d), new Float32Array(d)]; this.dryLen = d; this.dw = 0; }
    const c = this.comp || 0;
    if (c > 0 && (!this.compBuf || this.compBuf[0].length !== c)) { this.compBuf = [new Float32Array(c), new Float32Array(c)]; this.cw = 0; }
  }
  reset() { for (const m of this.mods) m.fx.reset(); this.dry[0].fill(0); this.dry[1].fill(0); if (this.compBuf) { this.compBuf[0].fill(0); this.compBuf[1].fill(0); } }
  /** Process in place. */
  process(L, R, n) {
    this.ensureDry();
    const dryL = this.dry[0], dryR = this.dry[1], D = this.dryLen;
    const needDry = this.bypassMix > 0 || this.bypassTarget > 0;
    // delayed dry copy aligned with the wet path (latency + comp)
    let dl, dr;
    if (needDry) {
      if (!this._tmpL || this._tmpL.length < n) { this._tmpL = new Float32Array(n); this._tmpR = new Float32Array(n); }
      dl = this._tmpL; dr = this._tmpR;
      for (let i = 0; i < n; i++) {
        dl[i] = dryL[this.dw]; dr[i] = dryR[this.dw];
        dryL[this.dw] = L[i]; dryR[this.dw] = R[i];
        this.dw = (this.dw + 1) % D;
      }
    } else { // keep the ring primed so a later bypass is aligned
      for (let i = 0; i < n; i++) { dryL[this.dw] = L[i]; dryR[this.dw] = R[i]; this.dw = (this.dw + 1) % D; }
    }
    for (const m of this.mods) m.fx.process(L, R, n);
    if (this.compBuf) {
      const cl = this.compBuf[0], cr = this.compBuf[1], c = cl.length;
      for (let i = 0; i < n; i++) { const a = cl[this.cw], b = cr[this.cw]; cl[this.cw] = L[i]; cr[this.cw] = R[i]; this.cw = (this.cw + 1) % c; L[i] = a; R[i] = b; }
    }
    if (needDry) {
      const step = 1 / Math.max(1, 0.01 * this.sr);
      for (let i = 0; i < n; i++) {
        if (this.bypassMix < this.bypassTarget) this.bypassMix = Math.min(this.bypassTarget, this.bypassMix + step);
        else if (this.bypassMix > this.bypassTarget) this.bypassMix = Math.max(this.bypassTarget, this.bypassMix - step);
        const b = this.bypassMix;
        L[i] = L[i] * (1 - b) + dl[i] * b; R[i] = R[i] * (1 - b) + dr[i] * b;
      }
    }
  }
}

/** Latency in samples of a chain config at `sr` (instantiates the effects once). */
export function chainLatency(config, sr) { return new Chain(sr, config).latency; }
/** Seconds of ringing after the input ends (sum of the effects' tails). */
export function chainTail(config, sr) { return new Chain(sr, config).tailSeconds; }
