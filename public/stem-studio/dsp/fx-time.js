import { Fx } from './fx-base.js';
import { Biquad, OnePole, biquadCoefs, DelayLine, clamp, sane } from './core.js';
import { FFT } from '../../roformer-web/dsp.js';

const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLP = [556, 441, 341, 225];
const SPREAD = 23;

class Comb {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; this.last = 0; }
  tick(x, fb, d1, d2) {
    const o = this.buf[this.i];
    this.last = sane(o * d2 + this.last * d1);
    this.buf[this.i] = x + this.last * fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return o;
  }
  reset() { this.buf.fill(0); this.last = 0; this.i = 0; }
}
class Allpass {
  constructor(size) { this.buf = new Float32Array(size); this.i = 0; }
  tick(x) {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
  reset() { this.buf.fill(0); this.i = 0; }
}

/**
 * Space Designer: Schroeder/Freeverb topology (8 damped combs + 4 allpasses per side, 23-sample
 * stereo spread, JUCE room/damp/wet/dry/width scaling). Desktop intent preserved: damping is
 * floored at 60 % for rooms > 60 %, dry = 1 - wet/2, and a -2 dB / 300 Hz mud cut follows when
 * wet > 30 %.
 */
export class Reverb extends Fx {
  constructor(sr, p) {
    super(sr, p);
    const k = sr / 44100;
    this.cL = COMB.map((t) => new Comb(Math.round(t * k)));
    this.cR = COMB.map((t) => new Comb(Math.round((t + SPREAD) * k)));
    this.aL = ALLP.map((t) => new Allpass(Math.round(t * k)));
    this.aR = ALLP.map((t) => new Allpass(Math.round((t + SPREAD) * k)));
    this.mud = new Biquad(2);
    this.update();
  }
  update() {
    if (!this.cL) return;
    const raw = !!this.p.raw; // raw = JUCE/pedalboard units (0..1 knobs, dry scale x2) for the Classic presets
    let room, damp, wet, width, dry;
    if (raw) {
      room = clamp(this.get('room_size', 0.5), 0, 1); damp = clamp(this.get('damping', 0.5), 0, 1);
      wet = clamp(this.get('wet', 0.33), 0, 1); width = clamp(this.get('width', 1), 0, 1); dry = clamp(this.get('dry', 0.4), 0, 1) * 2;
      this.useMud = false;
    } else {
      room = clamp(this.get('room_size', 50), 0, 100) / 100;
      damp = clamp(this.get('damping', 40), 0, 100) / 100;
      if (room > 0.6) damp = Math.max(damp, 0.6);
      wet = clamp(this.get('wet', this.get('mix', 20)), 0, 100) / 100;
      width = Math.min(clamp(this.get('width', 100), 0, 200) / 100, 1);
      dry = 1 - wet * 0.5;
      this.useMud = wet > 0.3;
    }
    this.fb = room * 0.28 + 0.7;
    this.d1 = damp * 0.4; this.d2 = 1 - this.d1;
    const w = wet * 3;
    this.w1 = w * (width / 2 + 0.5); this.w2 = w * ((1 - width) / 2);
    this.dry = dry;
    this.mud.set(biquadCoefs('peak', this.sr, 300, 0.5, -2));
    // 60 dB decay time from the average comb delay and feedback
    const avgDelay = 1400 / 44100;
    this._tail = clamp((avgDelay * -3) / Math.log10(this.fb) * (1 - 0.4 * damp), 0.3, 12);
  }
  get tailSeconds() { return this._tail; }
  process(L, R, n) {
    const { cL, cR, aL, aR, fb, d1, d2, w1, w2, dry } = this;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      const inp = (l + r) * 0.015;
      let oL = 0, oR = 0;
      for (let j = 0; j < 8; j++) { oL += cL[j].tick(inp, fb, d1, d2); oR += cR[j].tick(inp, fb, d1, d2); }
      for (let j = 0; j < 4; j++) { oL = aL[j].tick(oL); oR = aR[j].tick(oR); }
      L[i] = oL * w1 + oR * w2 + l * dry;
      R[i] = oR * w1 + oL * w2 + r * dry;
    }
    if (this.useMud) { this.mud.process(L, n, 0); this.mud.process(R, n, 1); }
  }
  reset() { for (const a of [...this.cL, ...this.cR, ...this.aL, ...this.aR]) a.reset(); this.mud.reset(); }
}

/** Tape Delay: stereo delay line, linear dry/wet, feedback low-passed at 4 kHz when feedback > 40 % (in the loop only). */
export class Delay extends Fx {
  constructor(sr, p) {
    super(sr, p);
    this.dl = [new DelayLine(2.05 * sr), new DelayLine(2.05 * sr)];
    this.lp = new OnePole('lowpass', sr, 4000, 2);
    this.update();
  }
  update() {
    if (!this.dl) return;
    this.time = clamp(this.get('time', 250), 1, 2000) * 0.001 * this.sr;
    this.fb = clamp(this.get('feedback', 30), 0, 95) / 100;
    this.mix = clamp(this.get('mix', 30), 0, 100) / 100;
    this.useLp = this.fb > 0.4;
    const reps = this.fb > 0.001 ? Math.ceil(Math.log(0.001) / Math.log(this.fb)) : 1;
    this._tail = clamp(reps * this.time / this.sr, 0.1, 12);
  }
  get tailSeconds() { return this._tail; }
  process(L, R, n) {
    const bufs = [L, R], D = Math.max(1, Math.round(this.time)) - 1, fb = this.fb, mix = this.mix;
    for (let ch = 0; ch < 2; ch++) {
      const b = bufs[ch], line = this.dl[ch];
      for (let i = 0; i < n; i++) {
        const x = b[i];
        let d = line.read(D);
        let f = this.useLp ? this.lp.tick(d, ch) : d;
        line.push(x + f * fb);
        b[i] = x * (1 - mix) + d * mix;
      }
    }
  }
  reset() { this.dl[0].reset(); this.dl[1].reset(); this.lp.reset(); }
}

/** Stereo chorus: modulated delay (centre `delay` ms, LFO depth scaled from `depth`), quadrature LFO per channel. */
export class Chorus extends Fx {
  constructor(sr, p) { super(sr, p); this.dl = [new DelayLine(0.05 * sr), new DelayLine(0.05 * sr)]; this.ph = 0; this.update(); }
  update() {
    if (!this.dl) return;
    this.rate = clamp(this.get('rate', 1), 0.01, 20);
    this.depth = clamp(this.get('depth', 0.25), 0, 1);
    let mix = this.get('mix', 50); this.mix = clamp(mix > 1 ? mix / 100 : mix, 0, 1);
    this.centre = clamp(this.get('delay', 7), 1, 30);
    this.fb = clamp(this.get('feedback', 0), 0, 0.9);
  }
  get tailSeconds() { return 0.06; }
  process(L, R, n) {
    const inc = this.rate / this.sr, sr = this.sr, amp = this.depth * this.centre * 0.6;
    for (let i = 0; i < n; i++) {
      const p = this.ph; this.ph = p + inc >= 1 ? p + inc - 1 : p + inc;
      for (let ch = 0; ch < 2; ch++) {
        const b = ch ? R : L;
        const lfo = Math.sin(2 * Math.PI * (p + ch * 0.25));
        const dSamp = Math.max(1, (this.centre + amp * lfo) * 0.001 * sr);
        const wet = this.dl[ch].read(dSamp - 1);
        const x = b[i];
        this.dl[ch].push(x + wet * this.fb);
        b[i] = x * (1 - this.mix) + wet * this.mix;
      }
    }
  }
  reset() { this.dl[0].reset(); this.dl[1].reset(); this.ph = 0; }
}

/** Jet Phaser: 6 first-order all-pass stages swept around 1.3 kHz (+-1.5 octaves at depth 1) with feedback. */
export class Phaser extends Fx {
  constructor(sr, p) { super(sr, p); this.z = [new Float64Array(6), new Float64Array(6)]; this.fbS = [0, 0]; this.ph = 0; this.update(); }
  update() {
    if (!this.z) return;
    this.rate = clamp(this.get('rate', 0.5), 0.01, 20);
    this.depth = clamp(this.get('depth', 0.5), 0, 1);
    this.fb = clamp(this.get('feedback', 0.5), 0, 0.95);
    const m = this.get('mix', 0.5); this.mix = clamp(m > 1 ? m / 100 : m, 0, 1);
    this.centre = this.get('centre', 1300);
  }
  get tailSeconds() { return 0.05; }
  process(L, R, n) {
    const inc = this.rate / this.sr, sr = this.sr;
    for (let i = 0; i < n; i++) {
      const lfo = Math.sin(2 * Math.PI * this.ph); this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      const fc = clamp(this.centre * Math.pow(2, this.depth * 1.5 * lfo), 20, sr * 0.45);
      const t = Math.tan(Math.PI * fc / sr), a = (t - 1) / (t + 1);
      for (let ch = 0; ch < 2; ch++) {
        const b = ch ? R : L, z = this.z[ch];
        const x = b[i];
        let y = x + this.fbS[ch] * this.fb;
        for (let s = 0; s < 6; s++) { const o = a * y + z[s]; z[s] = sane(y - a * o); y = o; }
        this.fbS[ch] = sane(y);
        b[i] = x * (1 - this.mix) + y * this.mix;
      }
    }
  }
  reset() { this.z[0].fill(0); this.z[1].fill(0); this.fbS = [0, 0]; }
}

/** Phase-vocoder pitch shifter (classic analysis/shift/resynthesis; fft 2048, 8x overlap). */
export class PitchShifterCh {
  constructor(sr, N = 2048, osamp = 8) {
    this.sr = sr; this.N = N; this.osamp = osamp; this.hop = N / osamp; this.lat = N - this.hop;
    this.fft = FFT.get(N);
    this.inF = new Float32Array(N); this.outF = new Float32Array(N); this.acc = new Float32Array(2 * N);
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    const h = N / 2 + 1;
    this.lastPh = new Float64Array(h); this.sumPh = new Float64Array(h);
    this.aM = new Float64Array(h); this.aF = new Float64Array(h); this.sM = new Float64Array(h); this.sF = new Float64Array(h);
    this.win = new Float64Array(N);
    for (let k = 0; k < N; k++) this.win[k] = -0.5 * Math.cos((2 * Math.PI * k) / N) + 0.5;
    this.rover = this.lat;
  }
  reset() { this.inF.fill(0); this.outF.fill(0); this.acc.fill(0); this.lastPh.fill(0); this.sumPh.fill(0); this.rover = this.lat; }
  process(buf, n, ratio) {
    const { N, osamp, hop, lat, re, im, win } = this;
    const freqPerBin = this.sr / N, expct = (2 * Math.PI * hop) / N, h = N / 2;
    for (let i = 0; i < n; i++) {
      this.inF[this.rover] = buf[i];
      buf[i] = this.outF[this.rover - lat];
      if (++this.rover >= N) {
        this.rover = lat;
        for (let k = 0; k < N; k++) { re[k] = this.inF[k] * win[k]; im[k] = 0; }
        this.fft.transform(re, im);
        for (let k = 0; k <= h; k++) {
          const mag = 2 * Math.hypot(re[k], im[k]);
          const ph = Math.atan2(im[k], re[k]);
          let d = ph - this.lastPh[k]; this.lastPh[k] = ph;
          d -= k * expct;
          let q = Math.floor(d / Math.PI); q += q >= 0 ? (q & 1) : -(q & 1);
          d -= Math.PI * q;
          d = (osamp * d) / (2 * Math.PI);
          this.aM[k] = mag; this.aF[k] = k * freqPerBin + d * freqPerBin;
        }
        this.sM.fill(0); this.sF.fill(0);
        for (let k = 0; k <= h; k++) {
          const idx = Math.floor(k * ratio);
          if (idx <= h) { this.sM[idx] += this.aM[k]; this.sF[idx] = this.aF[k] * ratio; }
        }
        for (let k = 0; k <= h; k++) {
          let d = this.sF[k] - k * freqPerBin; d /= freqPerBin; d = (2 * Math.PI * d) / osamp; d += k * expct;
          this.sumPh[k] += d;
          const m = this.sM[k];
          re[k] = m * Math.cos(this.sumPh[k]); im[k] = m * Math.sin(this.sumPh[k]);
        }
        for (let k = h + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
        this.fft.inverseUnscaled(re, im);
        for (let k = 0; k < N; k++) this.acc[k] += (2 * win[k] * re[k]) / (h * osamp);
        for (let k = 0; k < hop; k++) this.outF[k] = this.acc[k];
        this.acc.copyWithin(0, hop, hop + N);
        for (let k = N; k < N + hop; k++) this.acc[k] = 0;
        this.inF.copyWithin(0, hop, hop + lat);
      }
    }
  }
}

export class Pitch extends Fx {
  constructor(sr, p) { super(sr, p); this.ch = [new PitchShifterCh(sr), new PitchShifterCh(sr)]; this.update(); }
  update() { if (!this.ch) return; this.st = clamp(this.get('semitones', 0), -24, 24); this.ratio = Math.pow(2, this.st / 12); }
  get active() { return Math.abs(this.st) > 1e-6; }
  get latency() { return this.active ? this.ch[0].lat : 0; }
  get tailSeconds() { return this.active ? this.ch[0].lat / this.sr : 0; }
  process(L, R, n) {
    if (!this.active) return;
    this.ch[0].process(L, n, this.ratio); this.ch[1].process(R, n, this.ratio);
  }
  reset() { this.ch[0].reset(); this.ch[1].reset(); }
}
