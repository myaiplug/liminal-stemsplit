/**
 * Stem fidelity helpers.
 *
 * Idea credit: the "residual stem" and "null test" checks come from
 * badwolf-ro/stemsep (MIT). The code here is our own and only does arithmetic.
 *
 *  - residualInto(): make the catch-all stem (usually "other") equal to
 *    mix - (every other stem), so all stems add back to the original.
 *  - NullMeter: running measure of how far the written stems are from the mix,
 *    in dB relative to the mix (lower is better, -60 dB or less is inaudible).
 */

/**
 * Overwrite stems[target] with mix - sum(other stems). Works in place on the
 * chunk's Float32Arrays. Stems are [left, right].
 */
export function residualInto(stems, left, right, target = 'other') {
  const t = stems[target];
  if (!t) return stems;
  const n = t[0].length;
  const others = Object.keys(stems).filter((k) => k !== target);
  for (let i = 0; i < n; i++) {
    let sl = 0, sr = 0;
    for (const k of others) { sl += stems[k][0][i]; sr += stems[k][1][i]; }
    t[0][i] = left[i] - sl;
    t[1][i] = right[i] - sr;
  }
  return stems;
}

export class NullMeter {
  constructor() { this.err = 0; this.ref = 0; }
  /** @param {Float32Array[]} mix [l, r] slice  @param {Array<[Float32Array,Float32Array]>} stems same length */
  add(mixL, mixR, stems, n = mixL.length) {
    for (let i = 0; i < n; i++) {
      let sl = 0, sr = 0;
      for (const [a, b] of stems) { sl += a[i]; sr += b[i]; }
      const dl = mixL[i] - sl, dr = mixR[i] - sr;
      this.err += dl * dl + dr * dr;
      this.ref += mixL[i] * mixL[i] + mixR[i] * mixR[i];
    }
  }
  /** dB of residual energy relative to the mix; null for silence. */
  get db() {
    if (!(this.ref > 0)) return null;
    return 10 * Math.log10((this.err + 1e-30) / this.ref);
  }
}

export function describeNull(db) {
  if (db == null || !Number.isFinite(db)) return '';
  const v = Math.round(db);
  const verdict = db <= -60 ? 'stems add back to the original' : db <= -35 ? 'close to the original' : 'some of the original is missing from the stems';
  return `Null test ${v} dB (${verdict}).`;
}
