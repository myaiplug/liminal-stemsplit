/**
 * Drum post-processing that needs no ML: hi-hat vs cymbal-wash split (HPSS), 808/sub derivation, and a DSP-only fallback
 * splitter. Everything here is *complementary*: the outputs of each function sum back to the input (up to float rounding),
 * so the session mix does not change when the user splits further.
 */
import { analyze, synth, mags } from './../dsp/spectral.js';
import { Biquad, biquadCoefs } from './../dsp/core.js';

const NF = 2048, HP = 1024;
const sum = (a, b) => a.map((c, ch) => { const o = new Float32Array(c.length); for (let i = 0; i < o.length; i++) o[i] = c[i] + b[ch][i]; return o; });
const sub = (a, b) => a.map((c, ch) => { const o = new Float32Array(c.length); for (let i = 0; i < o.length; i++) o[i] = c[i] - b[ch][i]; return o; });

/** Zero-phase 4th-order low-pass (Butterworth section run forward and backward). */
export function zeroPhaseLowpass(x, sr, fc) {
  const y = Float32Array.from(x), bq = new Biquad(1);
  const pass = () => { bq.set(biquadCoefs('lowpass', sr, fc, Math.SQRT1_2)); bq.reset(); bq.process(y, y.length, 0); };
  pass(); y.reverse(); pass(); y.reverse();
  return y;
}

/* ------------------------------------------------------------------ HPSS */
function medianFilter(src, out, T, F, kt, kf) {
  // out[t,f] = median over a (2*kt+1) window along time (kt>0) or frequency (kf>0)
  const win = new Float32Array(2 * Math.max(kt, kf) + 1);
  if (kt > 0) {
    for (let f = 0; f < F; f++) for (let t = 0; t < T; t++) {
      let n = 0;
      for (let d = -kt; d <= kt; d++) { const u = t + d; if (u >= 0 && u < T) win[n++] = src[u * F + f]; }
      out[t * F + f] = kth(win, n);
    }
  } else {
    for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) {
      let n = 0; const o = t * F;
      for (let d = -kf; d <= kf; d++) { const u = f + d; if (u >= 0 && u < F) win[n++] = src[o + u]; }
      out[o + f] = kth(win, n);
    }
  }
}
function kth(w, n) { // median by partial insertion sort (n <= ~33)
  for (let i = 1; i < n; i++) { const v = w[i]; let j = i - 1; while (j >= 0 && w[j] > v) { w[j + 1] = w[j]; j--; } w[j + 1] = v; }
  return w[n >> 1];
}
/**
 * Percussive fraction per time-frequency cell.
 * Magnitude is first averaged over +-kf bins (cymbal wash is noise-like, so single bins fluctuate wildly while the
 * band level is smooth), then the sustained floor H is the running median along time. What sticks out above that floor
 * is the percussive part P = max(m - H, 0); mask = P^2 / (P^2 + H^2) (Wiener-style soft mask).
 */
export function percussiveMask(S, { kt = 8, kf = 6, power = 2 } = {}) {
  const [mL, mR] = mags(S), T = S.T, F = S.F, n = T * F, m = new Float32Array(n);
  for (let t = 0; t < T; t++) {
    const o = t * F; let acc = 0, cnt = 0;
    for (let f = 0; f <= kf && f < F; f++) { acc += 0.5 * (mL[o + f] + mR[o + f]); cnt++; }
    for (let f = 0; f < F; f++) {
      m[o + f] = acc / cnt;
      const add = f + kf + 1, del = f - kf;
      if (add < F) { acc += 0.5 * (mL[o + add] + mR[o + add]); cnt++; }
      if (del >= 0) { acc -= 0.5 * (mL[o + del] + mR[o + del]); cnt--; }
    }
  }
  const H = new Float32Array(n), mask = new Float32Array(n);
  medianFilter(m, H, T, F, kt, 0);
  for (let i = 0; i < n; i++) { const p = Math.max(m[i] - H[i], 0) ** power, h = H[i] ** power; mask[i] = p / (p + h + 1e-20); }
  return mask;
}

/**
 * Run `maskFn(S)` -> array of K masks (T*F, summing to 1 per cell) over a long signal in segments, return K stereo outputs.
 */
export function maskSplit(L, R, sr, K, maskFn, { segSec = 20, ctxSec = 1, onProgress } = {}) {
  const N = L.length, seg = Math.round(segSec * sr), ctx = Math.round(ctxSec * sr);
  const out = Array.from({ length: K }, () => [new Float32Array(N), new Float32Array(N)]);
  for (let a = 0; a < N; a += seg) {
    const b = Math.min(N, a + seg), a0 = Math.max(0, a - ctx), a1 = Math.min(N, b + ctx);
    const S = analyze(L.subarray(a0, a1), R.subarray(a0, a1), NF, HP), masks = maskFn(S), n = S.T * S.F;
    for (let k = 0; k < K; k++) {
      const M = masks[k], X = { ...S, reL: new Float32Array(n), imL: new Float32Array(n), reR: new Float32Array(n), imR: new Float32Array(n) };
      for (let i = 0; i < n; i++) { const g = M[i]; X.reL[i] = S.reL[i] * g; X.imL[i] = S.imL[i] * g; X.reR[i] = S.reR[i] * g; X.imR[i] = S.imR[i] * g; }
      const [yl, yr] = synth(X); out[k][0].set(yl.subarray(a - a0, b - a0), a); out[k][1].set(yr.subarray(a - a0, b - a0), a);
    }
    onProgress?.(b / N);
  }
  return out;
}

/** time-smooth a mask a little so it does not flutter (3-frame mean) */
function smoothTime(m, T, F) { const o = new Float32Array(m.length); for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) { const a = m[Math.max(0, t - 1) * F + f], b = m[t * F + f], c = m[Math.min(T - 1, t + 1) * F + f]; o[t * F + f] = (a + 2 * b + c) * 0.25; } return o; }

/**
 * Split the model's "cymbals" stem into closed hi-hats (percussive part) and crash/ride wash (sustained part).
 * Heuristic: a hat is a short broadband tick, a crash/ride rings. A crash's initial hit lands in "hats"; hats played
 * over a ringing cymbal are only partly separable.
 */
export function splitHats(L, R, sr, opts = {}) {
  const [hats] = maskSplit(L, R, sr, 2, (S) => { const p = smoothTime(percussiveMask(S, opts), S.T, S.F), q = p.map((v) => 1 - v); return [p, q]; }, opts);
  const cym = sub([L, R], hats);
  return { hats, cymbals: cym };
}

/* ------------------------------------------------------------------ 808 */
/** smoothed RMS envelope (one-pole on the square, `ms` time constant) */
function envelope(x, sr, ms = 12) {
  const a = Math.exp(-1 / (sr * ms / 1000)), e = new Float32Array(x.length); let v = 0;
  for (let i = 0; i < x.length; i++) { v = a * v + (1 - a) * x[i] * x[i]; e[i] = Math.sqrt(v); }
  return e;
}
/**
 * Find hits in a low-passed kick-like signal and measure how long each one rings.
 * @returns {{start:number,peak:number,end:number,tailMs:number}[]}  sample indexes
 */
export function findKickEvents(low, sr, { minLevelDb = -35, dropDb = -20 } = {}) {
  const env = envelope(low, sr, 12); let gp = 0; for (let i = 0; i < env.length; i++) if (env[i] > gp) gp = env[i];
  const thr = gp * 10 ** (minLevelDb / 20), drop = 10 ** (dropDb / 20), ev = [], back = Math.round(0.015 * sr), N = env.length;
  let i = 0;
  while (i < N) {
    if (env[i] < thr) { i++; continue; }
    let pk = i, j = i, runMin = Infinity, minAt = i, decayed = false;
    for (; j < N; j++) {
      const v = env[j]; if (j <= pk || v > env[pk]) { if (v >= env[pk]) { pk = j; runMin = Infinity; } }
      if (v < runMin) { runMin = v; minAt = j; }
      if (v < env[pk] * drop) { decayed = true; break; } // decayed by dropDb
      if (j > pk && v > runMin * 1.8 && v > env[pk] * 0.15) { j = minAt; break; } // a new hit starts on top of the tail
    }
    const end = Math.min(N, j), tailMs = ((end - pk) / sr) * 1000;
    ev.push({ start: Math.max(0, i - back), peak: pk, end, tailMs });
    i = Math.max(end, i + 1);
    if (decayed) while (i < N && env[i] >= thr) i++; // skip the residual tail below the drop level
  }
  return ev;
}

/**
 * Derive an "808 / sub" stem.
 *  - from the bass stem: everything below `fc` (zero-phase, so bass = sub + rest exactly)
 *  - from the kick stem: the low band of hits that ring longer than `minTailMs` (808-style kicks); short punchy kicks stay in the kick.
 * Returns the three stereo signals; sub808 + bassRest = bass, kickRest + (kick part of sub808) = kick.
 */
export function derive808({ bass = null, kick = null, sr, fc = 120, minTailMs = 220, fromKick = true }) {
  const N = (bass || kick)[0].length, zero = () => [new Float32Array(N), new Float32Array(N)];
  const out = { sub808: zero(), bassRest: bass ? [bass[0].slice(), bass[1].slice()] : null, kickRest: kick ? [kick[0].slice(), kick[1].slice()] : null, events: [], fc };
  if (bass) for (let c = 0; c < 2; c++) { const lo = zeroPhaseLowpass(bass[c], sr, fc); out.sub808[c].set(lo); for (let i = 0; i < N; i++) out.bassRest[c][i] = bass[c][i] - lo[i]; }
  if (kick && fromKick) {
    const lowC = [zeroPhaseLowpass(kick[0], sr, fc * 1.2), zeroPhaseLowpass(kick[1], sr, fc * 1.2)], mono = new Float32Array(N);
    for (let i = 0; i < N; i++) mono[i] = 0.5 * (lowC[0][i] + lowC[1][i]);
    const ev = findKickEvents(mono, sr), fade = Math.round(0.006 * sr), mask = new Float32Array(N);
    for (const e of ev) {
      const is808 = e.tailMs >= minTailMs; out.events.push({ ...e, startS: e.start / sr, tailMs: Math.round(e.tailMs), is808 });
      if (!is808) continue;
      const a = e.start, b = Math.min(N, e.end + fade);
      for (let i = a; i < b; i++) { const up = Math.min(1, (i - a) / fade), dn = Math.min(1, (b - 1 - i) / fade); mask[i] = Math.max(mask[i], 0.5 - 0.5 * Math.cos(Math.PI * Math.min(up, dn))); }
    }
    for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) { const m = lowC[c][i] * mask[i]; out.sub808[c][i] += m; out.kickRest[c][i] -= m; }
  }
  return out;
}

/* ------------------------------------------------------------------ DSP-only fallback */
/**
 * Rough splitter used when the ML model is not available: kick = lows, snare/clap = mid transients, hats = high transients,
 * cymbals = high sustain, toms/body = mid sustain. Sums to the input.
 */
export function dspDrumSplit(L, R, sr, { kickHz = 150, hatHz = 6000, onProgress } = {}) {
  const parts = maskSplit(L, R, sr, 5, (S) => {
    const p = smoothTime(percussiveMask(S, { kt: 8, kf: 10 }), S.T, S.F), K = 5, T = S.T, F = S.F, m = Array.from({ length: K }, () => new Float32Array(T * F));
    const lowW = new Float32Array(F), hiW = new Float32Array(F);
    for (let f = 0; f < F; f++) { const hz = Math.max(1, (f * sr) / S.nFft); lowW[f] = 1 / (1 + (hz / kickHz) ** 4); hiW[f] = 1 / (1 + (hatHz / hz) ** 4); }
    for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) {
      const i = t * F + f, lo = lowW[f], hi = Math.min(hiW[f], 1 - lo), mid = 1 - lo - hi, pp = p[i];
      m[0][i] = lo; m[1][i] = mid * pp; m[4][i] = mid * (1 - pp); m[2][i] = hi * pp; m[3][i] = hi * (1 - pp);
    }
    return m;
  }, { onProgress });
  return { kick: parts[0], snare: parts[1], hats: parts[2], cymbals: parts[3], toms: parts[4] };
}
export { sum, sub };
