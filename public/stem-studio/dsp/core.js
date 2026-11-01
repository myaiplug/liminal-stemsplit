/**
 * Shared DSP primitives for Stem Studio effects. Pure functions/classes, no DOM / Web Audio
 * dependencies, so the same code runs in an AudioWorklet (live preview and OfflineAudioContext
 * export) and in Node (unit tests).
 *
 * Everything here is written from the public algorithm descriptions (RBJ Audio-EQ-Cookbook
 * biquads, one-pole ballistics, Freeverb, TPT first-order filters). No GPL code (pedalboard,
 * Rubber Band) is copied or linked.
 */
export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Flush denormals / NaN so recursive filters can never wedge. */
export const sane = (x) => (x > 1e-24 || x < -1e-24 ? x : 0);

/** RBJ cookbook biquad coefficients, normalised so a0 = 1. Returns [b0,b1,b2,a1,a2]. */
export function biquadCoefs(type, sr, f0, q = Math.SQRT1_2, gainDb = 0) {
  f0 = clamp(f0, 2, sr * 0.499);
  q = Math.max(q, 0.05);
  const w = (2 * Math.PI * f0) / sr, cs = Math.cos(w), sn = Math.sin(w);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const beta = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cs + beta); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - beta);
      a0 = (A + 1) + (A - 1) * cs + beta; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - beta; break;
    }
    case 'highshelf': {
      const beta = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cs + beta); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - beta);
      a0 = (A + 1) - (A - 1) * cs + beta; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - beta; break;
    }
    case 'highpass':
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'lowpass':
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'notch':
      b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    default: throw new Error(`unknown biquad type ${type}`);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Direct-form-II-transposed biquad for N channels (state kept per channel). */
export class Biquad {
  constructor(channels = 2) {
    this.z1 = new Float64Array(channels); this.z2 = new Float64Array(channels);
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
  }
  set(coefs) { [this.b0, this.b1, this.b2, this.a1, this.a2] = coefs; return this; }
  reset() { this.z1.fill(0); this.z2.fill(0); }
  /** one sample of channel `ch` */
  tick(x, ch) {
    const y = this.b0 * x + this.z1[ch];
    this.z1[ch] = sane(this.b1 * x - this.a1 * y + this.z2[ch]);
    this.z2[ch] = sane(this.b2 * x - this.a2 * y);
    return y;
  }
  process(buf, n, ch) {
    let z1 = this.z1[ch], z2 = this.z2[ch];
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = sane(b1 * x - a1 * y + z2);
      z2 = sane(b2 * x - a2 * y);
      buf[i] = y;
    }
    this.z1[ch] = z1; this.z2[ch] = z2;
  }
}

/** First-order (6 dB/oct) TPT high/low-pass: the slope the desktop engine's HP/LP filters use. */
export class OnePole {
  constructor(type, sr, fc, channels = 2) {
    this.type = type; this.s = new Float64Array(channels);
    this.setFreq(sr, fc);
  }
  setFreq(sr, fc) {
    const g = Math.tan(Math.PI * clamp(fc, 1, sr * 0.49) / sr);
    this.G = g / (1 + g);
  }
  reset() { this.s.fill(0); }
  tick(x, ch) {
    const v = (x - this.s[ch]) * this.G;
    const lp = v + this.s[ch];
    this.s[ch] = lp + v;
    return this.type === 'lowpass' ? lp : x - lp;
  }
  process(buf, n, ch) {
    let s = this.s[ch]; const G = this.G; const lpOut = this.type === 'lowpass';
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const v = (x - s) * G; const lp = v + s; s = sane(lp + v);
      buf[i] = lpOut ? lp : x - lp;
    }
    this.s[ch] = s;
  }
}

/** One-pole attack/release smoother time constant: reaches 1-1/e of a step in `ms`. */
export const ballisticCoef = (ms, sr) => (ms <= 0 ? 0 : Math.exp(-1 / (0.001 * ms * sr)));

/** Fractional delay line with linear interpolation (one channel). */
export class DelayLine {
  constructor(maxSamples) {
    this.size = Math.max(4, Math.ceil(maxSamples) + 4);
    this.buf = new Float32Array(this.size); this.w = 0;
  }
  reset() { this.buf.fill(0); this.w = 0; }
  push(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.size; }
  /** sample written `d` samples ago (d >= 0 can be fractional; 0 = most recent push) */
  read(d) {
    let p = this.w - 1 - d; const i0 = Math.floor(p); const fr = p - i0;
    const a = this.buf[((i0 % this.size) + this.size) % this.size];
    const b = this.buf[(((i0 + 1) % this.size) + this.size) % this.size];
    return a + (b - a) * fr;
  }
}
