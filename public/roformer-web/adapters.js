/**
 * Per-model pre/post-processing. All three ONNX graphs take STFT-domain
 * tensors (STFT/iSTFT are NOT inside the graphs), but with different layouts:
 *
 *  bs6      in : spec_real, spec_imag  [1, 2, 1025, 345]       (n_fft 2048, hop 512)
 *           out: out_spec_real/imag    [1, 6, 2, 1025, 345]    (already masked)
 *  mini     in : stft                  [1, 690, 8196]          (n_fft 4096, hop 512,
 *                                         layout [frame][bin 2049][ch][re,im])
 *           out: mask                  [1, 4, 690, 4100]       ([stem][frame][bin 1025][ch][re,im],
 *                                         applied to a separate n_fft 2048 STFT)
 *  duality  in : stft_repr             [1, 2050, 1100, 2]      (n_fft 2048, hop 441,
 *                                         layout [bin*2+ch][frame][re,im])
 *           out: masks                 [1, 2050, 1100, 2]      (complex mask, same layout)
 *
 * Every adapter exposes:
 *   chunkSamples
 *   prepare(left, right)  -> { feeds: {name: {data: Float32Array, dims: number[]}}, ctx }
 *   finish(outputs, ctx)  -> { [stemName]: [Float32Array left, Float32Array right] }
 *     (outputs maps name -> Float32Array)
 */

import { stftFrames, istftFrames, numFrames } from './dsp.js';
import { residualInto } from './fidelity.js';

function alloc2(n) { return [new Float32Array(n), new Float32Array(n)]; }

// ---------------------------------------------------------------- BS-RoFormer-SW (6 stems)
export const bs6Adapter = {
  chunkSamples: 176400,
  nFft: 2048,
  hop: 512,
  F: 1025,
  T: 345,
  names: ['bass', 'drums', 'other', 'vocals', 'guitar', 'piano'], // model output order
  inputNames: ['spec_real', 'spec_imag'],

  prepare(left, right) {
    const { nFft, hop, F, T } = this;
    const re = new Float32Array(2 * F * T);
    const im = new Float32Array(2 * F * T);
    const plane = F * T;
    const got = stftFrames(left, right, nFft, hop, (t, reL, imL, reR, imR) => {
      for (let k = 0; k < F; k++) {
        const i = k * T + t;
        re[i] = reL[k]; im[i] = imL[k];
        re[plane + i] = reR[k]; im[plane + i] = imR[k];
      }
    });
    if (got.T !== T) throw new Error(`bs6: expected ${T} frames, got ${got.T}`);
    return {
      feeds: {
        spec_real: { data: re, dims: [1, 2, F, T] },
        spec_imag: { data: im, dims: [1, 2, F, T] },
      },
      ctx: { left, right },
    };
  },

  finish(outputs, ctx) {
    const { nFft, hop, F, T, chunkSamples, names } = this;
    const outRe = outputs.out_spec_real, outIm = outputs.out_spec_imag;
    const plane = F * T;
    const stems = {};
    names.forEach((name, s) => {
      const [l, r] = alloc2(chunkSamples);
      istftFrames((t, reL, imL, reR, imR) => {
        const base = s * 2 * plane;
        for (let k = 0; k < F; k++) {
          const i = base + k * T + t;
          reL[k] = outRe[i]; imL[k] = outIm[i];
          reR[k] = outRe[plane + i]; imR[k] = outIm[plane + i];
        }
      }, nFft, hop, T, chunkSamples, l, r);
      stems[name] = [l, r];
    });
    // The network's own "other" misses whatever the masks lose. Rebuild it as
    // mix - (the other five) so the six stems add back to the input.
    return ctx ? residualInto(stems, ctx.left, ctx.right, 'other') : stems;
  },
};

// ---------------------------------------------------------------- Mini-BS-RoFormer V2.5 (4 stems)
export const miniAdapter = {
  chunkSamples: 352800,
  hop: 512,
  fftModel: 4096, // STFT the network looks at
  fftMask: 2048,  // STFT the predicted masks are applied to / iSTFT size
  names: ['bass', 'drums', 'other', 'vocals'],
  inputNames: ['stft'],

  prepare(left, right) {
    const { hop, fftModel, fftMask, chunkSamples } = this;
    const T = numFrames(chunkSamples, hop); // 690
    const Fm = fftModel / 2 + 1; // 2049
    const Fk = fftMask / 2 + 1;  // 1025
    const input = new Float32Array(T * Fm * 4);
    stftFrames(left, right, fftModel, hop, (t, reL, imL, reR, imR) => {
      let o = t * Fm * 4;
      for (let k = 0; k < Fm; k++) {
        input[o++] = reL[k]; input[o++] = imL[k];
        input[o++] = reR[k]; input[o++] = imR[k];
      }
    });
    // Keep the 2048-point STFT: the masks multiply it. Layout [ch][t][k].
    const specRe = [new Float32Array(T * Fk), new Float32Array(T * Fk)];
    const specIm = [new Float32Array(T * Fk), new Float32Array(T * Fk)];
    stftFrames(left, right, fftMask, hop, (t, reL, imL, reR, imR) => {
      const o = t * Fk;
      for (let k = 0; k < Fk; k++) {
        specRe[0][o + k] = reL[k]; specIm[0][o + k] = imL[k];
        specRe[1][o + k] = reR[k]; specIm[1][o + k] = imR[k];
      }
    });
    return {
      feeds: { stft: { data: input, dims: [1, T, Fm * 4] } },
      ctx: { T, Fk, specRe, specIm, left, right },
    };
  },

  finish(outputs, ctx) {
    const { hop, fftMask, chunkSamples, names } = this;
    const { T, Fk, specRe, specIm } = ctx;
    const mask = outputs.mask; // [1, 4, T, Fk*4]
    const stems = {};
    names.forEach((name, s) => {
      const [l, r] = alloc2(chunkSamples);
      istftFrames((t, reL, imL, reR, imR) => {
        const mBase = (s * T + t) * Fk * 4;
        const sBase = t * Fk;
        for (let k = 0; k < Fk; k++) {
          const m = mBase + k * 4;
          const aL = specRe[0][sBase + k], bL = specIm[0][sBase + k];
          const aR = specRe[1][sBase + k], bR = specIm[1][sBase + k];
          const mlr = mask[m], mli = mask[m + 1], mrr = mask[m + 2], mri = mask[m + 3];
          reL[k] = aL * mlr - bL * mli; imL[k] = aL * mli + bL * mlr;
          reR[k] = aR * mrr - bR * mri; imR[k] = aR * mri + bR * mrr;
        }
      }, fftMask, hop, T, chunkSamples, l, r);
      stems[name] = [l, r];
    });
    return residualInto(stems, ctx.left, ctx.right, 'other');
  },
};

// ---------------------------------------------------------------- Mel-Band RoFormer Duality student (vocals / instrumental)
export const dualityAdapter = {
  chunkSamples: 484659,
  nFft: 2048,
  hop: 441,
  F: 1025,
  T: 1100,
  names: ['vocals', 'instrumental'],
  inputNames: ['stft_repr'],

  prepare(left, right) {
    const { nFft, hop, F, T } = this;
    const input = new Float32Array(2 * F * T * 2);
    const got = stftFrames(left, right, nFft, hop, (t, reL, imL, reR, imR) => {
      for (let k = 0; k < F; k++) {
        const a = ((k * 2) * T + t) * 2;
        const b = ((k * 2 + 1) * T + t) * 2;
        input[a] = reL[k]; input[a + 1] = imL[k];
        input[b] = reR[k]; input[b + 1] = imR[k];
      }
    });
    if (got.T !== T) throw new Error(`duality: expected ${T} frames, got ${got.T}`);
    return {
      feeds: { stft_repr: { data: input, dims: [1, 2 * F, T, 2] } },
      ctx: { input, left, right },
    };
  },

  finish(outputs, ctx) {
    const { nFft, hop, F, T, chunkSamples } = this;
    const masks = outputs.masks;
    const input = ctx.input;
    const [vl, vr] = alloc2(chunkSamples);
    istftFrames((t, reL, imL, reR, imR) => {
      for (let k = 0; k < F; k++) {
        const a = ((k * 2) * T + t) * 2;
        const b = ((k * 2 + 1) * T + t) * 2;
        const xr = input[a], xi = input[a + 1], mr = masks[a], mi = masks[a + 1];
        reL[k] = xr * mr - xi * mi; imL[k] = xr * mi + xi * mr;
        const yr = input[b], yi = input[b + 1], nr = masks[b], ni = masks[b + 1];
        reR[k] = yr * nr - yi * ni; imR[k] = yr * ni + yi * nr;
      }
    }, nFft, hop, T, chunkSamples, vl, vr);
    // Instrumental = mixture - vocals (time domain), so the pair always sums to the input.
    const il = new Float32Array(chunkSamples), ir = new Float32Array(chunkSamples);
    for (let i = 0; i < chunkSamples; i++) {
      il[i] = ctx.left[i] - vl[i];
      ir[i] = ctx.right[i] - vr[i];
    }
    return { vocals: [vl, vr], instrumental: [il, ir] };
  },
};

export const ADAPTERS = { bs6: bs6Adapter, mini: miniAdapter, duality: dualityAdapter };
