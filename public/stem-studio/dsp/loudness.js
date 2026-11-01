/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement.
 *   - K-weighting (shelf + RLB high-pass) with coefficients derived for any sample rate
 *   - momentary (400 ms), short-term (3 s), integrated (two-stage gating) loudness
 *   - loudness range (EBU Tech 3342: 10th-95th percentile of gated short-term values)
 *   - true peak with 4x oversampling (2x at 96 kHz+, none at 192 kHz+; BS.1770-4 Annex 2)
 * One streaming implementation serves the live meter (AudioWorklet), the offline analysis (worker)
 * and the unit tests. Block structure: 100 ms sub-blocks; a 400 ms gating block = 4 sub-blocks
 * (75 % overlap); short-term = 30 sub-blocks, evaluated every 100 ms.
 */
import { Biquad } from './core.js';

/** BS.1770 stage-1 (high-shelf) and stage-2 (RLB high-pass) biquads for `sr`. Returns [b0,b1,b2,a1,a2] x 2 */
export function kWeightCoefs(sr) {
  // pre-filter (head-related shelf)
  let G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.9744509555319;
  let K = Math.tan((Math.PI * fc) / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // RLB weighting high-pass: numerator is exactly [1, -2, 1]
  Q = 0.5003270373238773; fc = 38.13547087602444;
  K = Math.tan((Math.PI * fc) / sr); a0 = 1 + K / Q + K * K;
  const rlb = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, rlb];
}

const TAPS_PER_PHASE = 32, BETA = 9; // history ring length (power of two); 128 taps at 4x (BS.1770-4 Annex 2 asks for >= 48)
const HMASK = TAPS_PER_PHASE - 1;
/** Polyphase windowed-sinc interpolator for true-peak detection. */
function makeInterpolator(factor) {
  const taps = TAPS_PER_PHASE * factor;
  const h = new Float64Array(taps); const c = (taps - 1) / 2; const beta = BETA;
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; };
  for (let n = 0; n < taps; n++) {
    const x = (n - c) / factor; const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = (2 * n) / (taps - 1) - 1; const w = i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0(beta);
    h[n] = sinc * w;
  }
  const phases = []; // phases[p][j] multiplies x[n - j]
  for (let p = 0; p < factor; p++) { const ph = []; for (let j = 0; j * factor + p < taps; j++) ph.push(h[j * factor + p]); phases.push(Float64Array.from(ph)); }
  return phases;
}
const interpCache = new Map();
const interp = (f) => { if (!interpCache.has(f)) interpCache.set(f, makeInterpolator(f)); return interpCache.get(f); };

export class LoudnessMeter {
  constructor(sr, { truePeak = true } = {}) {
    this.sr = sr; this.sub = Math.round(sr * 0.1);
    const [s, r] = kWeightCoefs(sr);
    this.f = [[new Biquad(1).set(s), new Biquad(1).set(r)], [new Biquad(1).set(s), new Biquad(1).set(r)]];
    this.acc = 0; this.cnt = 0; // current sub-block power sum
    this.subPow = []; // per 100 ms mean power (L+R weighted sum)
    this.blockPow = []; // 400 ms gating blocks (power)
    this.stPow = []; // 3 s short-term (power)
    this.momMax = -Infinity; this.stMax = -Infinity;
    this.samplePeak = 0; this.tp = 0; this.total = 0;
    this.tpFactor = !truePeak ? 0 : sr <= 96000 ? 4 : sr < 192000 ? 2 : 0;
    if (this.tpFactor) { this.phases = interp(this.tpFactor); this.histL = new Float64Array(TAPS_PER_PHASE); this.histR = new Float64Array(TAPS_PER_PHASE); this.hp = 0; }
    this.tmp = new Float64Array(1);
  }
  static toLufs(p) { return p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity; }
  /** feed `n` samples (does not modify the inputs) */
  push(L, R, n) {
    const [[sL1, sL2], [sR1, sR2]] = this.f;
    const useTp = this.tpFactor > 0, ph = this.phases;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R ? R[i] : L[i];
      const al = Math.abs(xl), ar = Math.abs(xr);
      if (al > this.samplePeak) this.samplePeak = al; if (ar > this.samplePeak) this.samplePeak = ar;
      if (useTp) {
        const hl = this.histL, hr = this.histR, h = this.hp;
        hl[h] = xl; hr[h] = xr; this.hp = (h + 1) & HMASK;
        for (let p = 0; p < ph.length; p++) {
          const c = ph[p]; let yl = 0, yr = 0;
          for (let j = 0; j < c.length; j++) { const idx = (h - j) & HMASK; yl += c[j] * hl[idx]; yr += c[j] * hr[idx]; }
          yl = Math.abs(yl); yr = Math.abs(yr);
          if (yl > this.tp) this.tp = yl; if (yr > this.tp) this.tp = yr;
        }
      }
      const kl = sL2.tick(sL1.tick(xl, 0), 0), kr = sR2.tick(sR1.tick(xr, 0), 0);
      this.acc += kl * kl + kr * kr;
      if (++this.cnt >= this.sub) this._endSub();
    }
    this.total += n;
  }
  _endSub() {
    const p = this.acc / this.cnt; this.acc = 0; this.cnt = 0;
    const sp = this.subPow; sp.push(p);
    const k = sp.length;
    if (k >= 4) {
      const b = (sp[k - 1] + sp[k - 2] + sp[k - 3] + sp[k - 4]) / 4; this.blockPow.push(b);
      const m = LoudnessMeter.toLufs(b); if (m > this.momMax) this.momMax = m; this.momentary = m;
    }
    if (k >= 30) {
      let s = 0; for (let i = k - 30; i < k; i++) s += sp[i];
      const st = s / 30; this.stPow.push(st);
      const l = LoudnessMeter.toLufs(st); if (l > this.stMax) this.stMax = l; this.shortTerm = l;
    }
  }
  get truePeakDb() { return this.tpFactor ? 20 * Math.log10(Math.max(this.tp, this.samplePeak, 1e-12)) : this.samplePeakDb; }
  get samplePeakDb() { return 20 * Math.log10(Math.max(this.samplePeak, 1e-12)); }
  /** gated integrated loudness in LUFS (-Infinity when silent) */
  get integrated() {
    const abs = Math.pow(10, (-70 + 0.691) / 10);
    const g1 = this.blockPow.filter((p) => p > abs);
    if (!g1.length) return -Infinity;
    const mean1 = g1.reduce((a, b) => a + b, 0) / g1.length;
    const rel = mean1 * Math.pow(10, -10 / 10);
    const g2 = g1.filter((p) => p > rel);
    if (!g2.length) return -Infinity;
    return LoudnessMeter.toLufs(g2.reduce((a, b) => a + b, 0) / g2.length);
  }
  /** loudness range in LU (EBU Tech 3342) */
  get lra() {
    const abs = Math.pow(10, (-70 + 0.691) / 10);
    const g1 = this.stPow.filter((p) => p > abs);
    if (g1.length < 2) return 0;
    const rel = (g1.reduce((a, b) => a + b, 0) / g1.length) * Math.pow(10, -20 / 10);
    const v = g1.filter((p) => p > rel).map((p) => LoudnessMeter.toLufs(p)).sort((a, b) => a - b);
    if (v.length < 2) return 0;
    const pct = (q) => { const x = q * (v.length - 1), i = Math.floor(x); return v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * (x - i); };
    return pct(0.95) - pct(0.10);
  }
  /** summary snapshot */
  result() {
    const durationSec = this.total / this.sr;
    return { integrated: this.integrated, shortTermMax: this.stMax, momentaryMax: this.momMax, lra: this.lra, truePeakDb: this.truePeakDb, samplePeakDb: this.samplePeakDb, durationSec };
  }
}

/** One-shot analysis of two channel arrays. */
export function measureLoudness(L, R, sr, opts) {
  const m = new LoudnessMeter(sr, opts); const B = 1 << 16;
  for (let i = 0; i < L.length; i += B) { const n = Math.min(B, L.length - i); m.push(L.subarray(i, i + n), R ? R.subarray(i, i + n) : null, n); }
  return m.result();
}

/** Normalisation targets. `tp` is the true-peak ceiling in dBTP. */
export const LOUDNESS_TARGETS = [
  { id: 'streaming', label: 'Streaming (−14 LUFS)', lufs: -14, tp: -1 },
  { id: 'apple', label: 'Apple Music / desktop split guard (−16 LUFS)', lufs: -16, tp: -1 },
  { id: 'club', label: 'Club / loud (−9 LUFS)', lufs: -9, tp: -0.3 },
  { id: 'loud', label: 'Loud master (−11 LUFS)', lufs: -11, tp: -1 },
  { id: 'broadcast', label: 'Broadcast EBU R128 (−23 LUFS)', lufs: -23, tp: -1 },
];
