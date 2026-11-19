/**
 * Host half of the HT-RoFormer drum separator (Sucial/drumsep-ht-roformer) for the browser.
 *
 * The ONNX graph (scripts/drumsep/htr_export.py) is the model WITHOUT torch.stft / torch.istft:
 *   inputs  audio [1, 2, 266240]               raw stereo window (the graph standardises it itself)
 *           spec  [1, 2, 1025, 261, 2]          torch.stft(n_fft 2048, hop 1024, hann periodic, center, reflect) as (re, im)
 *   outputs mask     [1, 6, 2050, 261, 2]       complex mask per stem, packed bin = 2*f + channel
 *           residual [1, 6, 2, 266240]          time-branch output (already de-standardised)
 *   stem = istft(mask * spec) + residual        (exactly what HybridTransformerRoFormer.forward returns)
 *
 * Chunking follows the model card / MSST: chunk 266,240 samples, overlap 2 (step = chunk/2), linear fade chunk/10 on
 * interior boundaries only.
 */
import { stftFrames, istftFrames } from '../../roformer-web/dsp.js';

export const HTR_CHUNK = 266240;
export const HTR_NFFT = 2048;
export const HTR_HOP = 1024;
export const HTR_BINS = 1025;
export const HTR_FRAMES = HTR_CHUNK / HTR_HOP + 1; // 261
export const HTR_STEMS = ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'other'];

class CancelledError extends Error { constructor() { super('cancelled'); this.name = 'CancelledError'; } }

/** chunk start offsets over `total` samples (total already padded to >= chunk) */
export function htrStarts(total, chunk = HTR_CHUNK, step = chunk / 2) {
  if (total <= chunk) return [0];
  const s = [];
  for (let a = 0; a + chunk <= total; a += step) s.push(a);
  if (s.at(-1) !== total - chunk) s.push(total - chunk);
  return s;
}

/** linear fade on interior boundaries; first / last chunk keep weight 1 at the track edges */
export function htrWeight(start, total, chunk = HTR_CHUNK, fade = Math.floor(chunk / 10)) {
  const w = new Float32Array(chunk).fill(1);
  for (let i = 0; i < fade; i++) {
    const r = fade > 1 ? i / (fade - 1) : 1;
    if (start > 0) w[i] = r;
    if (start + chunk < total) w[chunk - 1 - i] = r;
  }
  return w;
}

/** (L, R) window -> spec Float32Array laid out [ch][f][t][re,im] */
export function packSpec(L, R) {
  const F = HTR_BINS, T = HTR_FRAMES, out = new Float32Array(2 * F * T * 2);
  stftFrames(L, R, HTR_NFFT, HTR_HOP, (t, reL, imL, reR, imR) => {
    for (let f = 0; f < F; f++) {
      const iL = ((0 * F + f) * T + t) * 2, iR = ((1 * F + f) * T + t) * 2;
      out[iL] = reL[f]; out[iL + 1] = imL[f]; out[iR] = reR[f]; out[iR + 1] = imR[f];
    }
  });
  return out;
}

/** mask * spec -> iSTFT, + residual. Returns [stem][ch] Float32Array(chunk). */
export function decodeStems(spec, mask, residual, S = HTR_STEMS.length, chunk = HTR_CHUNK) {
  const F = HTR_BINS, T = HTR_FRAMES, out = [];
  for (let s = 0; s < S; s++) {
    const L = new Float32Array(chunk), R = new Float32Array(chunk);
    istftFrames((t, reL, imL, reR, imR) => {
      for (let f = 0; f < F; f++) {
        for (let ch = 0; ch < 2; ch++) {
          const si = ((ch * F + f) * T + t) * 2, mi = (((s * 2 * F) + 2 * f + ch) * T + t) * 2;
          const xr = spec[si], xi = spec[si + 1], mr = mask[mi], mm = mask[mi + 1];
          const re = xr * mr - xi * mm, im = xr * mm + xi * mr;
          if (ch === 0) { reL[f] = re; imL[f] = im; } else { reR[f] = re; imR[f] = im; }
        }
      }
    }, HTR_NFFT, HTR_HOP, T, chunk, L, R);
    const rL = (s * 2) * chunk, rR = (s * 2 + 1) * chunk;
    for (let i = 0; i < chunk; i++) { L[i] += residual[rL + i]; R[i] += residual[rR + i]; }
    out.push([L, R]);
  }
  return out;
}

/**
 * Full-length separation.  run(audio Float32Array(2*chunk), spec Float32Array) -> {mask, residual}
 * Returns [stem][ch] Float32Array(N) in HTR_STEMS order.
 */
export async function separateHtr({ L, R, run, onProgress = () => {}, isCancelled = () => false, chunk = HTR_CHUNK }) {
  const N = L.length, total = Math.max(N, chunk);
  const starts = htrStarts(total, chunk), padded = Math.max(starts.at(-1) + chunk, total);
  const S = HTR_STEMS.length;
  const acc = Array.from({ length: S }, () => [new Float32Array(padded), new Float32Array(padded)]);
  const wsum = new Float32Array(padded);
  for (let k = 0; k < starts.length; k++) {
    if (isCancelled()) throw new CancelledError();
    const a = starts[k], wl = new Float32Array(chunk), wr = new Float32Array(chunk);
    wl.set(L.subarray(a, Math.min(N, a + chunk))); wr.set(R.subarray(a, Math.min(N, a + chunk)));
    const audio = new Float32Array(2 * chunk); audio.set(wl, 0); audio.set(wr, chunk);
    const spec = packSpec(wl, wr);
    const { mask, residual } = await run(audio, spec);
    if (isCancelled()) throw new CancelledError();
    const stems = decodeStems(spec, mask, residual, S, chunk), w = htrWeight(a, padded, chunk);
    for (let s = 0; s < S; s++) for (let c = 0; c < 2; c++) { const dst = acc[s][c], src = stems[s][c]; for (let i = 0; i < chunk; i++) dst[a + i] += src[i] * w[i]; }
    for (let i = 0; i < chunk; i++) wsum[a + i] += w[i];
    onProgress((k + 1) / starts.length);
  }
  return acc.map(([aL, aR]) => {
    const oL = new Float32Array(N), oR = new Float32Array(N);
    for (let i = 0; i < N; i++) { const d = wsum[i] > 1e-8 ? wsum[i] : 1; oL[i] = aL[i] / d; oR[i] = aR[i] / d; }
    return [oL, oR];
  });
}
