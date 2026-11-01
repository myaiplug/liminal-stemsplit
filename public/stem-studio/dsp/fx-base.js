import { num } from './core.js';

/** Base class for every Stem Studio effect. Stereo, in place, any block size. */
export class Fx {
  constructor(sr, params = {}) {
    this.sr = sr;
    this.p = {};
    this.setParams(params);
  }
  /** Replace parameters (missing keys fall back to each effect's defaults). Safe while running. */
  setParams(p) { this.p = p || {}; this.update(); }
  get(key, def) { return num(this.p[key], def); }
  update() {}
  /** process `n` samples of L and R in place */
  process(/* L, R, n */) {}
  /** samples of delay this effect adds to the signal */
  get latency() { return 0; }
  /** seconds of audible ringing after the input stops (reverb/delay tails) */
  get tailSeconds() { return 0; }
  reset() {}
}
