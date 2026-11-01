import { Fx } from './fx-base.js';
import { Biquad, biquadCoefs, ballisticCoef, dbToLin, linToDb, clamp } from './core.js';

/** JUCE-style peak envelope follower (instant in one direction, one-pole in the other). */
export class Ballistics {
  constructor(sr) { this.sr = sr; this.env = 0; this.a = 0; this.r = 0; }
  set(attackMs, releaseMs) { this.a = ballisticCoef(attackMs, this.sr); this.r = ballisticCoef(releaseMs, this.sr); }
  tick(x) {
    const c = x > this.env ? this.a : this.r;
    this.env = x + c * (this.env - x);
    return this.env;
  }
  reset() { this.env = 0; }
}

/**
 * Downward expander ("Pro Gate" and "De-Reverb"):
 * gain = 1 above the threshold, (env/thr)^(ratio-1) below it. Stereo-linked.
 */
export class Gate extends Fx {
  constructor(sr, p) { super(sr, p); this.env = new Ballistics(sr); this.update(); }
  update() {
    if (!this.env) return;
    this.thr = dbToLin(this.get('threshold', -40));
    this.ratio = Math.max(1, this.get('ratio', 4));
    this.env.set(this.get('attack', 2), this.get('release', 100));
  }
  process(L, R, n) {
    const { thr, ratio, env } = this; const ex = ratio - 1;
    for (let i = 0; i < n; i++) {
      const e = env.tick(Math.max(Math.abs(L[i]), Math.abs(R[i])));
      if (e < thr) { const g = Math.pow(e / thr, ex); L[i] *= g; R[i] *= g; }
    }
  }
  reset() { this.env.reset(); }
}

/** Desktop "De-Reverb": the same expander with ratio = 1 + amount/10, attack 10 ms. */
export class DeReverb extends Gate {
  update() {
    if (!this.env) return;
    this.thr = dbToLin(this.get('threshold', -30));
    this.ratio = 1 + clamp(this.get('amount', 40), 0, 100) / 10;
    this.env.set(10, this.get('release', 200));
  }
}

/** Hard-knee feed-forward compressor (JUCE law), stereo-linked, optional auto makeup and parallel mix. */
export class Compressor extends Fx {
  constructor(sr, p) { super(sr, p); this.env = new Ballistics(sr); this.limiter = new Limiter(sr, { threshold: -0.5, release: 100 }); this.update(); this.tmpL = new Float32Array(0); this.tmpR = new Float32Array(0); }
  update() {
    if (!this.env) return;
    const thrDb = this.get('threshold', -20), ratio = Math.max(1, this.get('ratio', 2.5));
    this.thr = dbToLin(thrDb); this.invRatioM1 = 1 / ratio - 1;
    this.env.set(this.get('attack', 10), this.get('release', 100));
    let mk = this.get('makeup', 0);
    if (mk <= 0 && this.p.autoMakeup !== false && thrDb < 0 && ratio > 1) mk = Math.abs(thrDb * (1 - 1 / ratio)) * 0.7;
    this.makeupDb = mk > 0.5 ? mk : 0;
    this.makeup = dbToLin(this.makeupDb);
    this.mix = clamp(this.get('mix', 100), 0, 100) / 100;
    this.useLimiter = this.makeupDb > 0;
    this.limiter.setParams({ threshold: -0.5, release: 100 });
  }
  get latency() { return this.useLimiter ? this.limiter.latency : 0; }
  process(L, R, n) {
    const { thr, invRatioM1, env, makeup, mix } = this;
    if (this.tmpL.length < n) { this.tmpL = new Float32Array(n); this.tmpR = new Float32Array(n); }
    const dl = this.tmpL, dr = this.tmpR;
    if (mix < 1) { dl.set(L.subarray(0, n)); dr.set(R.subarray(0, n)); }
    for (let i = 0; i < n; i++) {
      const e = env.tick(Math.max(Math.abs(L[i]), Math.abs(R[i])));
      const g = e > thr ? Math.pow(e / thr, invRatioM1) * makeup : makeup;
      L[i] *= g; R[i] *= g;
    }
    if (this.useLimiter) this.limiter.process(L, R, n);
    if (mix < 1) {
      // parallel mix: the dry path must be delayed by the limiter latency to stay phase aligned
      const lat = this.latency;
      if (lat === 0) for (let i = 0; i < n; i++) { L[i] = dl[i] + (L[i] - dl[i]) * mix; R[i] = dr[i] + (R[i] - dr[i]) * mix; }
      else {
        if (!this.dryL || this.dryL.length !== lat) { this.dryL = new Float32Array(lat); this.dryR = new Float32Array(lat); this.dw = 0; }
        for (let i = 0; i < n; i++) {
          const a = this.dryL[this.dw], b = this.dryR[this.dw];
          this.dryL[this.dw] = dl[i]; this.dryR[this.dw] = dr[i]; this.dw = (this.dw + 1) % lat;
          L[i] = a + (L[i] - a) * mix; R[i] = b + (R[i] - b) * mix;
        }
      }
    }
  }
  reset() { this.env.reset(); this.limiter.reset(); if (this.dryL) { this.dryL.fill(0); this.dryR.fill(0); } }
}

/**
 * Look-ahead brick-wall limiter. A sliding-window minimum of the required gain over the last
 * `la` samples, smoothed by a boxcar of the same length, guarantees gain(n) <= thr/|x(n)| for
 * every sample (sample-peak safe) with a smooth attack; a one-pole release follows.
 * Latency = la - 1 samples.
 */
export class Limiter extends Fx {
  constructor(sr, p) { super(sr, p); this.alloc(); }
  alloc() {
    const la = Math.max(2, Math.round(this.sr * 0.0015)); this.la = la;
    this.dl = new Float32Array(la - 1); this.dr = new Float32Array(la - 1); this.dw = 0;
    this.dqVal = new Float64Array(la + 1); this.dqIdx = new Int32Array(la + 1); this.dqHead = 0; this.dqLen = 0; this.pos = 0;
    this.ring = new Float64Array(la).fill(1); this.rw = 0; this.sum = la; this.relState = 1;
    this.update();
  }
  update() {
    if (!this.la) return;
    this.thr = dbToLin(this.get('threshold', -1));
    this.rel = ballisticCoef(this.get('release', 100), this.sr);
  }
  get latency() { return this.la - 1; }
  reset() { this.alloc(); }
  process(L, R, n) {
    const la = this.la, thr = this.thr, rel = this.rel;
    const dqVal = this.dqVal, dqIdx = this.dqIdx, cap = la + 1;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      const a = Math.max(Math.abs(xl), Math.abs(xr));
      const g = a > thr ? thr / a : 1;
      // monotonic deque: sliding minimum over the last `la` required gains
      const p = this.pos++;
      while (this.dqLen > 0) {
        const tail = (this.dqHead + this.dqLen - 1) % cap;
        if (dqVal[tail] >= g) this.dqLen--; else break;
      }
      dqVal[(this.dqHead + this.dqLen) % cap] = g; dqIdx[(this.dqHead + this.dqLen) % cap] = p; this.dqLen++;
      while (dqIdx[this.dqHead] <= p - la) { this.dqHead = (this.dqHead + 1) % cap; this.dqLen--; }
      const m = dqVal[this.dqHead];
      // boxcar average of the last `la` window-minima
      this.sum += m - this.ring[this.rw]; this.ring[this.rw] = m; this.rw = (this.rw + 1) % la;
      let gs = this.sum / la; if (gs > 1) gs = 1;
      // release smoothing (never above the boxcar value, so the ceiling is preserved)
      this.relState = gs < this.relState ? gs : gs + rel * (this.relState - gs);
      if (this.relState > gs) this.relState = gs;
      const gain = this.relState;
      // the delayed audio sample that this gain applies to
      const ol = this.dl[this.dw], or = this.dr[this.dw];
      this.dl[this.dw] = xl; this.dr[this.dw] = xr; this.dw = (this.dw + 1) % (la - 1);
      L[i] = ol * gain; R[i] = or * gain;
    }
  }
}

/** Hard clipper at a ceiling in dB. */
export const hardClip = (x, c) => (x > c ? c : x < -c ? -c : x);

/**
 * "Pro Maximizer": input gain -> fast high-ratio compressor at the ceiling -> hard clip at the
 * ceiling (exactly the desktop signal flow; not a true-peak limiter).
 */
export class Maximizer extends Fx {
  constructor(sr, p) { super(sr, p); this.comp = new Compressor(sr, { autoMakeup: false, makeup: 0 }); this.update(); }
  update() {
    if (!this.comp) return;
    this.gain = dbToLin(this.get('gain', 0));
    this.ceilDb = this.get('ceiling', -0.1);
    this.ceil = dbToLin(this.ceilDb);
    this.comp.setParams({ threshold: this.ceilDb, ratio: 20, attack: 1, release: 100, autoMakeup: false, makeup: 0 });
  }
  process(L, R, n) {
    const g = this.gain, c = this.ceil;
    if (g !== 1) for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    this.comp.process(L, R, n);
    for (let i = 0; i < n; i++) { L[i] = hardClip(L[i], c); R[i] = hardClip(R[i], c); }
  }
  reset() { this.comp.reset(); }
}

/**
 * De-esser. mode 'split' (default): a band-pass sidechain around `frequency` drives gain
 * reduction applied only to that band (transparent). mode 'desktop': the desktop's hybrid
 * (static -3 dB peak cut at the frequency + 5:1 0.5 ms compressor on the full signal).
 */
export class DeEsser extends Fx {
  constructor(sr, p) {
    super(sr, p);
    this.bpL = new Biquad(1); this.bpR = new Biquad(1); this.split = new Biquad(2); this.cutF = new Biquad(2);
    this.comp = new Compressor(sr, {}); this.env = new Ballistics(sr);
    this.update();
  }
  update() {
    if (!this.comp) return;
    const f = this.get('frequency', 7000);
    this.mode = this.p.mode === 'desktop' ? 'desktop' : 'split';
    this.thr = dbToLin(this.get('threshold', -20)); this.ratio = Math.max(1, this.get('ratio', 5));
    this.bpL.set(biquadCoefs('bandpass', this.sr, f, 1.5)); this.bpR.set(biquadCoefs('bandpass', this.sr, f, 1.5));
    this.cutF.set(biquadCoefs('peak', this.sr, f, 3, -3));
    this.env.set(0.5, 30);
    this.comp.setParams({ threshold: this.get('threshold', -20), ratio: 5, attack: 0.5, release: 30, autoMakeup: false, makeup: 0 });
    this.f = f;
    // split-band: complementary band = x - bandpass(x) (phase-linear subtraction)
  }
  get latency() { return 0; }
  process(L, R, n) {
    if (this.mode === 'desktop') {
      this.cutF.process(L, n, 0); this.cutF.process(R, n, 1);
      this.comp.process(L, R, n); return;
    }
    const { thr, ratio, env } = this; const ex = 1 / ratio - 1;
    for (let i = 0; i < n; i++) {
      const bl = this.bpL.tick(L[i], 0), br = this.bpR.tick(R[i], 0);
      const e = env.tick(Math.max(Math.abs(bl), Math.abs(br)));
      const g = e > thr ? Math.pow(e / thr, ex) : 1;
      // reduce only the sibilant band: y = x - (1-g)*band
      L[i] -= (1 - g) * bl; R[i] -= (1 - g) * br;
    }
  }
  reset() { this.bpL.reset(); this.bpR.reset(); this.cutF.reset(); this.comp.reset(); this.env.reset(); }
}
