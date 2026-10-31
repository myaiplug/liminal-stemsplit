/**
 * Segmented stereo STFT processing for the artifact fixers.
 * A segment (plus context on both sides) is analysed into whole-segment spectrogram arrays so a fixer can look at
 * neighbouring frames and other stems with plain array maths, then re-synthesised and the central part copied back.
 * The framing is identical for every signal analysed with the same (a0, a1), so cross-stem masks line up.
 */
import { stftFrames, istftFrames, numFrames } from '../../roformer-web/dsp.js';

export const NFFT = 2048, HOP = 512;

export function analyze(L, R, nFft = NFFT, hop = HOP) {
  const T = numFrames(L.length, hop), F = nFft / 2 + 1;
  const S = { T, F, nFft, hop, length: L.length, reL: new Float32Array(T * F), imL: new Float32Array(T * F), reR: new Float32Array(T * F), imR: new Float32Array(T * F) };
  stftFrames(L, R, nFft, hop, (t, a, b, c, d) => { const o = t * F; S.reL.set(a, o); S.imL.set(b, o); S.reR.set(c, o); S.imR.set(d, o); });
  return S;
}

export function synth(S) {
  const outL = new Float32Array(S.length), outR = new Float32Array(S.length), F = S.F;
  istftFrames((t, a, b, c, d) => { const o = t * F; for (let k = 0; k < F; k++) { a[k] = S.reL[o + k]; b[k] = S.imL[o + k]; c[k] = S.reR[o + k]; d[k] = S.imR[o + k]; } }, S.nFft, S.hop, S.T, S.length, outL, outR);
  return [outL, outR];
}

/** magnitude (per channel) as Float32 T*F */
export function mags(S) {
  const n = S.T * S.F, mL = new Float32Array(n), mR = new Float32Array(n);
  for (let i = 0; i < n; i++) { mL[i] = Math.hypot(S.reL[i], S.imL[i]); mR[i] = Math.hypot(S.reR[i], S.imR[i]); }
  return [mL, mR];
}

/**
 * Run `fn(S, a0, a1)` over `[L,R]` in segments. `fn` mutates the spectrogram in place.
 * @returns {[Float32Array, Float32Array]} processed copy (inputs untouched)
 */
export function processInSegments(L, R, sr, fn, { segSec = 20, ctxSec = 1, nFft = NFFT, hop = HOP, onProgress } = {}) {
  const N = L.length, seg = Math.round(segSec * sr), ctx = Math.round(ctxSec * sr);
  const oL = new Float32Array(N), oR = new Float32Array(N);
  for (let a = 0; a < N; a += seg) {
    const b = Math.min(N, a + seg), a0 = Math.max(0, a - ctx), a1 = Math.min(N, b + ctx);
    const S = analyze(L.subarray(a0, a1), R.subarray(a0, a1), nFft, hop);
    fn(S, a0, a1);
    const [yl, yr] = synth(S);
    oL.set(yl.subarray(a - a0, b - a0), a); oR.set(yr.subarray(a - a0, b - a0), a);
    onProgress?.(b / N);
  }
  return [oL, oR];
}

export const binHz = (k, sr, nFft = NFFT) => (k * sr) / nFft;
export const hzBin = (hz, sr, nFft = NFFT) => Math.round((hz * nFft) / sr);
