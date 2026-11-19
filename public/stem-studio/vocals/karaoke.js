/**
 * Host half of the Mel-Band RoFormer karaoke model (aufr33/viperx, ONNX re-export by Acapellas, MIT model card):
 *   input  stft_features [1, T, 4100], frames-major: t*4100 + (2*f + ch)*2 + (0 re | 1 im)
 *   output mask          [1, 1, 2050, T, 2], one LEAD-vocal mask, packed bin 2*f + ch
 *   STFT 44.1 kHz, n_fft 2048, hop 441, center (reflect), periodic Hann  (= roformer-web/dsp.js stftFrames)
 * lead = istft(mask * X); backing = input - lead, so lead + backing is always exactly the input.
 *
 * The frame count per window is free (dynamic axis). Attention memory grows with T^2, so the browser default is 401
 * frames (4 s) with 50 % overlap and linear cross-fades; desktop measurements: 401 vs 801 frames differ by 30.6 dB SNR.
 */
import { stftFrames, istftFrames } from '../../roformer-web/dsp.js';

export const KARA_NFFT = 2048;
export const KARA_HOP = 441;
export const KARA_BINS = 1025;
export const KARA_FEAT = 4100;
export const KARA_SR = 44100;
export const KARA_DEFAULT_FRAMES = 401;

class CancelledError extends Error { constructor() { super('cancelled'); this.name = 'CancelledError'; } }

export const karaChunk = (frames = KARA_DEFAULT_FRAMES) => KARA_HOP * (frames - 1);

export function karaStarts(total, chunk) {
  if (total <= chunk) return [0];
  const step = Math.floor(chunk / 2), s = [];
  for (let a = 0; a + chunk <= total; a += step) s.push(a);
  if (s.at(-1) !== total - chunk) s.push(total - chunk);
  return s;
}

export function karaWeight(start, total, chunk, fade = Math.floor(chunk / 10)) {
  const w = new Float32Array(chunk).fill(1);
  for (let i = 0; i < fade; i++) { const r = fade > 1 ? i / (fade - 1) : 1; if (start > 0) w[i] = r; if (start + chunk < total) w[chunk - 1 - i] = r; }
  return w;
}

/** (L, R) window of `chunk` samples -> { feats Float32Array(T*4100), T } */
export function packFeatures(L, R) {
  let feats = null, T = 0;
  const res = stftFrames(L, R, KARA_NFFT, KARA_HOP, (t, reL, imL, reR, imR) => {
    if (!feats) { T = Math.floor(L.length / KARA_HOP) + 1; feats = new Float32Array(T * KARA_FEAT); }
    const o = t * KARA_FEAT;
    for (let f = 0; f < KARA_BINS; f++) {
      const iL = o + (2 * f) * 2, iR = o + (2 * f + 1) * 2;
      feats[iL] = reL[f]; feats[iL + 1] = imL[f]; feats[iR] = reR[f]; feats[iR + 1] = imR[f];
    }
  });
  return { feats, T: res.T };
}

/** lead = istft(mask * X) for one window. mask is the raw [1,1,2050,T,2] output. */
export function decodeLead(feats, mask, T, chunk) {
  const L = new Float32Array(chunk), R = new Float32Array(chunk);
  istftFrames((t, reL, imL, reR, imR) => {
    const o = t * KARA_FEAT;
    for (let f = 0; f < KARA_BINS; f++) {
      for (let ch = 0; ch < 2; ch++) {
        const b = 2 * f + ch, xi = o + b * 2, mi = (b * T + t) * 2;
        const xr = feats[xi], xim = feats[xi + 1], mr = mask[mi], mm = mask[mi + 1];
        const re = xr * mr - xim * mm, im = xr * mm + xim * mr;
        if (ch === 0) { reL[f] = re; imL[f] = im; } else { reR[f] = re; imR[f] = im; }
      }
    }
  }, KARA_NFFT, KARA_HOP, T, chunk, L, R);
  return [L, R];
}

/**
 * run(feats Float32Array(T*4100), T) -> mask Float32Array(2050*T*2)
 * Returns { lead: [L, R], backing: [L, R] } (Float32Array, input length).
 */
export async function separateLeadBacking({ L, R, run, frames = KARA_DEFAULT_FRAMES, onProgress = () => {}, isCancelled = () => false }) {
  const N = L.length, chunk = karaChunk(frames), total = Math.max(N, chunk);
  const starts = karaStarts(total, chunk), padded = Math.max(starts.at(-1) + chunk, total);
  const aL = new Float32Array(padded), aR = new Float32Array(padded), ws = new Float32Array(padded);
  for (let k = 0; k < starts.length; k++) {
    if (isCancelled()) throw new CancelledError();
    const a = starts[k], wl = new Float32Array(chunk), wr = new Float32Array(chunk);
    wl.set(L.subarray(a, Math.min(N, a + chunk))); wr.set(R.subarray(a, Math.min(N, a + chunk)));
    const { feats, T } = packFeatures(wl, wr);
    const mask = await run(feats, T);
    if (isCancelled()) throw new CancelledError();
    const [lL, lR] = decodeLead(feats, mask, T, chunk), w = karaWeight(a, padded, chunk);
    for (let i = 0; i < chunk; i++) { aL[a + i] += lL[i] * w[i]; aR[a + i] += lR[i] * w[i]; ws[a + i] += w[i]; }
    onProgress((k + 1) / starts.length);
  }
  const lead = [new Float32Array(N), new Float32Array(N)], backing = [new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) {
    const d = ws[i] > 1e-8 ? ws[i] : 1;
    lead[0][i] = aL[i] / d; lead[1][i] = aR[i] / d;
    backing[0][i] = L[i] - lead[0][i]; backing[1][i] = R[i] - lead[1][i];
  }
  return { lead, backing };
}
