import { Fx } from './fx-base.js';
import { Biquad, OnePole, biquadCoefs, dbToLin, clamp, DelayLine } from './core.js';
import { hardClip } from './fx-dynamics.js';

/** A chain of biquad / one-pole sections applied to both channels. */
class FilterBank {
  constructor() { this.sections = []; }
  clear() { this.sections = []; }
  addBiquad(coefs) { const b = new Biquad(2).set(coefs); this.sections.push(b); return b; }
  addOnePole(type, sr, fc) { this.sections.push(new OnePole(type, sr, fc, 2)); }
  process(L, R, n) { for (const s of this.sections) { s.process(L, n, 0); s.process(R, n, 1); } }
  reset() { for (const s of this.sections) s.reset(); }
}

/** Parametric band: type hp|lp (first-order, as the desktop) | hp2|lp2 (12 dB/oct) | peak | lowshelf | highshelf. */
export class Peq extends Fx {
  constructor(sr, p) { super(sr, p); this.bank = new FilterBank(); this.update(); }
  update() {
    if (!this.bank) return;
    const type = this.p.type || 'peak', f = this.get('freq', 1000), g = this.get('gain', 0), q = this.get('q', 1);
    this.bank.clear();
    if (type === 'hp' || type === 'lp') this.bank.addOnePole(type === 'hp' ? 'highpass' : 'lowpass', this.sr, f);
    else if (type === 'hp2') this.bank.addBiquad(biquadCoefs('highpass', this.sr, f, q || Math.SQRT1_2));
    else if (type === 'lp2') this.bank.addBiquad(biquadCoefs('lowpass', this.sr, f, q || Math.SQRT1_2));
    else if (type === 'notch') this.bank.addBiquad(biquadCoefs('notch', this.sr, f, q));
    else if (g !== 0) this.bank.addBiquad(biquadCoefs(type, this.sr, f, type === 'peak' ? q : (this.p.q ? q : Math.SQRT1_2), g));
  }
  process(L, R, n) { this.bank.process(L, R, n); }
  reset() { this.bank.reset(); }
}

/** Desktop "3-Band EQ": low shelf 200 Hz, peak (Q 1) at freq_mid, high shelf 5 kHz, with the desktop's "smart curves". */
export class Eq3 extends Fx {
  constructor(sr, p) { super(sr, p); this.bank = new FilterBank(); this.update(); }
  update() {
    if (!this.bank) return;
    const low = this.get('low', 0), mid = this.get('mid', 0), high = this.get('high', 0), mf = this.get('freq_mid', 1000);
    const sr = this.sr; this.bank.clear();
    if (low > 3) this.bank.addOnePole('highpass', sr, 30);
    if (low !== 0) this.bank.addBiquad(biquadCoefs('lowshelf', sr, 200, Math.SQRT1_2, low));
    if (mid !== 0) this.bank.addBiquad(biquadCoefs('peak', sr, mf, 1, mid));
    if (high !== 0) this.bank.addBiquad(biquadCoefs('highshelf', sr, 5000, Math.SQRT1_2, high));
    if (high > 2) this.bank.addBiquad(biquadCoefs('highshelf', sr, 12000, Math.SQRT1_2, high * 0.25));
  }
  process(L, R, n) { this.bank.process(L, R, n); }
  reset() { this.bank.reset(); }
}

/** Desktop "DJ Filter": first-order HP (when > 20 Hz) and LP (when < 19 kHz). */
export class DjFilter extends Fx {
  constructor(sr, p) { super(sr, p); this.bank = new FilterBank(); this.update(); }
  update() {
    if (!this.bank) return;
    const hp = this.get('hp', 20), lp = this.get('lp', 20000);
    this.bank.clear();
    if (hp > 20) this.bank.addOnePole('highpass', this.sr, hp);
    if (lp < 19000) this.bank.addOnePole('lowpass', this.sr, lp);
  }
  process(L, R, n) { this.bank.process(L, R, n); }
  reset() { this.bank.reset(); }
}

/** Plain gain in dB. */
export class GainFx extends Fx {
  update() { this.g = dbToLin(this.get('gain', 0)); }
  process(L, R, n) { const g = this.g; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
}

/**
 * Desktop "Analog Warmth": +2 dB head bump at 60 Hz (Q 0.5) -> tanh drive (drive*0.35 dB)
 * -> hard clip at -0.3 dB -> 14 kHz one-pole low-pass, with a dry/wet mix (the desktop ignores
 * the mix knob; here it works).
 */
export class Saturation extends Fx {
  constructor(sr, p) { super(sr, p); this.bank = new FilterBank(); this.dryL = new Float32Array(0); this.dryR = new Float32Array(0); this.update(); }
  update() {
    if (!this.bank) return;
    this.driveDb = this.get('drive', 20) * 0.35;
    this.mix = clamp(this.get('mix', 100), 0, 100) / 100;
    this.drive = dbToLin(this.driveDb); this.clipAt = dbToLin(-0.3);
    this.bump = new Biquad(2).set(biquadCoefs('peak', this.sr, 60, 0.5, 2));
    this.lp = new OnePole('lowpass', this.sr, 14000, 2);
  }
  process(L, R, n) {
    if (this.driveDb <= 0 || this.mix <= 0) return;
    if (this.dryL.length < n) { this.dryL = new Float32Array(n); this.dryR = new Float32Array(n); }
    const dl = this.dryL, dr = this.dryR, mix = this.mix;
    if (mix < 1) { dl.set(L.subarray(0, n)); dr.set(R.subarray(0, n)); }
    this.bump.process(L, n, 0); this.bump.process(R, n, 1);
    const d = this.drive, c = this.clipAt;
    for (let i = 0; i < n; i++) { L[i] = hardClip(Math.tanh(d * L[i]), c); R[i] = hardClip(Math.tanh(d * R[i]), c); }
    this.lp.process(L, n, 0); this.lp.process(R, n, 1);
    if (mix < 1) for (let i = 0; i < n; i++) { L[i] = dl[i] + (L[i] - dl[i]) * mix; R[i] = dr[i] + (R[i] - dr[i]) * mix; }
  }
  reset() { this.bump.reset(); this.lp.reset(); }
}

/** Raw tanh drive in dB (Classic presets' "Distortion"). */
export class Drive extends Fx {
  update() { this.g = dbToLin(this.get('drive', 10)); }
  process(L, R, n) { const g = this.g; for (let i = 0; i < n; i++) { L[i] = Math.tanh(g * L[i]); R[i] = Math.tanh(g * R[i]); } }
}

/** Bit-depth reduction (Classic "Bitcrush"). Quantises to 2^(bits-1) levels. */
export class Bitcrush extends Fx {
  update() { this.q = Math.pow(2, clamp(this.get('bits', 8), 1, 24) - 1); }
  process(L, R, n) { const q = this.q; for (let i = 0; i < n; i++) { L[i] = Math.round(L[i] * q) / q; R[i] = Math.round(R[i] * q) / q; } }
}

/**
 * Desktop "Stereo Widener": mid/side, side high-passed at 120 Hz (bass stays mono), side scaled by
 * width, plus a 15 % 10 ms Haas copy of the side above 120 % width. (Fixed vs desktop: the desktop
 * wraps the delayed copy around the file with np.roll; here it is a true delay line.)
 */
export class StereoWidth extends Fx {
  constructor(sr, p) {
    super(sr, p); this.hp = new OnePole('highpass', sr, 120, 1);
    this.haas = new DelayLine(Math.ceil(0.011 * sr)); this.update();
  }
  update() {
    if (!this.hp) return;
    this.w = this.get('width', 100) / 100; this.useHaas = this.get('width', 100) > 120;
    this.haasSamples = Math.max(1, Math.round(0.010 * this.sr));
  }
  process(L, R, n) {
    const w = this.w;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5, s0 = (L[i] - R[i]) * 0.5;
      let s = this.hp.tick(s0, 0) * w;
      if (this.useHaas) { const d = this.haas.read(this.haasSamples - 1); this.haas.push(s); s += d * 0.15; } else this.haas.push(s);
      L[i] = m + s; R[i] = m - s;
    }
  }
  reset() { this.hp.reset(); this.haas.reset(); }
}

/** Mid/side balance utility used by cleanup tools. */
export class MonoBass extends Fx {
  constructor(sr, p) { super(sr, p); this.hp = new OnePole('highpass', sr, 120, 1); this.update(); }
  update() { this.hp && this.hp.setFreq(this.sr, this.get('freq', 120)); }
  process(L, R, n) { for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) * 0.5, s = this.hp.tick((L[i] - R[i]) * 0.5, 0); L[i] = m + s; R[i] = m - s; } }
  reset() { this.hp.reset(); }
}
