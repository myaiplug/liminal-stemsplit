/**
 * Pre/post-processing for the DrumSep (Hybrid Demucs) ONNX graph, in plain JS.
 *
 * The ONNX graph takes (mix [1,2,W], mag [1,4,2048,le]) where `mag` is the complex STFT of the (reflect-padded)
 * window with channels (L.re, L.im, R.re, R.im), and returns (freq_out [1,S,4,2048,le], time_out [1,S,2,W]).
 * Stem k = iSTFT(freq_out[k]) + time_out[k]. The STFT conventions below replicate demucs.hdemucs.HDemucs._spec /
 * _ispec (nfft 4096, hop 1024, hann, normalized, reflect padding) and were checked against torch (see the tests).
 *
 * Environment-agnostic: runs in the worker, on the main thread and in Node.
 */
import { stftFrames, istftFrames } from '../../roformer-web/dsp.js';

export const SR = 44100;
export const NFFT = 4096, HOP = 1024, NBINS = 2048, PAD = (HOP >> 1) * 3;
export const STEM_NAMES = ['kick', 'snare', 'cymbals', 'toms'];
const SCALE = Math.sqrt(NFFT); // torch normalized=True

export const framesFor = (W) => Math.ceil(W / HOP);

function reflectPad(src, W, pad, padR) {
  const out = new Float32Array(pad + W + padR);
  out.set(src.subarray(0, W), pad);
  for (let i = 0; i < pad; i++) out[pad - 1 - i] = src[Math.min(W - 1, i + 1)];
  for (let i = 0; i < padR; i++) out[pad + W + i] = src[Math.max(0, W - 2 - i)];
  return out;
}

/** Build the two model inputs for samples [s0, s0+W) of a stereo signal (zero-padded past the end). */
export function prepareWindow(L, R, s0, W) {
  const le = framesFor(W), n = Math.max(0, Math.min(W, L.length - s0));
  const mix = new Float32Array(2 * W);
  mix.set(L.subarray(s0, s0 + n), 0); mix.set(R.subarray(s0, s0 + n), W);
  const padR = PAD + le * HOP - W;
  const xl = reflectPad(mix.subarray(0, W), W, PAD, padR), xr = reflectPad(mix.subarray(W), W, PAD, padR);
  const mag = new Float32Array(4 * NBINS * le), inv = 1 / SCALE;
  stftFrames(xl, xr, NFFT, HOP, (t, reL, imL, reR, imR) => {
    const u = t - 2; if (u < 0 || u >= le) return;
    for (let k = 0; k < NBINS; k++) {
      mag[(0 * NBINS + k) * le + u] = reL[k] * inv; mag[(1 * NBINS + k) * le + u] = imL[k] * inv;
      mag[(2 * NBINS + k) * le + u] = reR[k] * inv; mag[(3 * NBINS + k) * le + u] = imR[k] * inv;
    }
  });
  return { mix, mag, le, W };
}

/**
 * Turn the model outputs into time-domain stems.
 * @param {Float32Array} freq  [S,4,2048,le] flattened (batch 1)
 * @param {Float32Array} time  [S,2,W] flattened
 * @returns {Array<[Float32Array, Float32Array]>}
 */
export function decodeWindow(freq, time, S, W) {
  const le = framesFor(W), T = le + 4, outLen = HOP * le + 2 * PAD, out = [];
  for (let s = 0; s < S; s++) {
    const base = s * 4 * NBINS * le;
    const yL = new Float32Array(outLen), yR = new Float32Array(outLen);
    istftFrames((t, reL, imL, reR, imR) => {
      const u = t - 2;
      if (u < 0 || u >= le) { reL.fill(0); imL.fill(0); reR.fill(0); imR.fill(0); return; }
      for (let k = 0; k < NBINS; k++) {
        reL[k] = freq[base + (0 * NBINS + k) * le + u] * SCALE; imL[k] = freq[base + (1 * NBINS + k) * le + u] * SCALE;
        reR[k] = freq[base + (2 * NBINS + k) * le + u] * SCALE; imR[k] = freq[base + (3 * NBINS + k) * le + u] * SCALE;
      }
      reL[NBINS] = 0; imL[NBINS] = 0; reR[NBINS] = 0; imR[NBINS] = 0;
    }, NFFT, HOP, T, outLen, yL, yR);
    const L = new Float32Array(W), R = new Float32Array(W), tb = s * 2 * W;
    for (let i = 0; i < W; i++) { L[i] = yL[PAD + i] + time[tb + i]; R[i] = yR[PAD + i] + time[tb + W + i]; }
    out.push([L, R]);
  }
  return out;
}

/** Window start positions covering [0,N): hop = W*(1-overlap), last window flush with the end. */
export function windowStarts(N, W, overlap = 0.5) {
  if (N <= W) return [0];
  const hop = Math.max(1, Math.round(W * (1 - overlap))), s = [];
  for (let a = 0; a + W < N; a += hop) s.push(a);
  s.push(N - W);
  return s;
}

/** Overlap-add weight for sample i of a window starting at s0 (no fade at the outer edges of the track). */
function weightAt(i, s0, W, N, fadeLen) {
  let w = 1;
  if (s0 > 0 && i < fadeLen) w = 0.5 * (1 - Math.cos((Math.PI * (i + 0.5)) / fadeLen));
  const j = W - 1 - i;
  if (s0 + W < N && j < fadeLen) w = Math.min(w, 0.5 * (1 - Math.cos((Math.PI * (j + 0.5)) / fadeLen)));
  return w;
}

/**
 * Separate a whole drum stem.
 * @param {{L:Float32Array,R:Float32Array,run:(mix:Float32Array,mag:Float32Array,le:number)=>Promise<{freq:Float32Array,time:Float32Array}>,
 *          W:number,S?:number,overlap?:number,onProgress?:(f:number)=>void,isCancelled?:()=>boolean}} o
 * @returns {Promise<Array<[Float32Array, Float32Array]>>} S stereo stems (same length as the input)
 */
export async function separateLong({ L, R, run, W, S = STEM_NAMES.length, overlap = 0.5, onProgress, isCancelled }) {
  const N = L.length, starts = windowStarts(N, W, overlap), fade = Math.round(W * overlap);
  const acc = Array.from({ length: S }, () => [new Float32Array(N), new Float32Array(N)]);
  const wsum = new Float32Array(N);
  for (let wi = 0; wi < starts.length; wi++) {
    if (isCancelled?.()) { const e = new Error('cancelled'); e.name = 'CancelledError'; throw e; }
    const s0 = starts[wi], { mix, mag, le } = prepareWindow(L, R, s0, W);
    const { freq, time } = await run(mix, mag, le);
    const st = decodeWindow(freq, time, S, W), n = Math.min(W, N - s0);
    for (let i = 0; i < n; i++) {
      const w = weightAt(i, s0, W, N, fade); wsum[s0 + i] += w;
      for (let k = 0; k < S; k++) { acc[k][0][s0 + i] += st[k][0][i] * w; acc[k][1][s0 + i] += st[k][1][i] * w; }
    }
    onProgress?.((wi + 1) / starts.length);
  }
  for (let i = 0; i < N; i++) { const inv = wsum[i] > 1e-9 ? 1 / wsum[i] : 0; for (let k = 0; k < S; k++) { acc[k][0][i] *= inv; acc[k][1][i] *= inv; } }
  return acc;
}
