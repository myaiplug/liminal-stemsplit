/**
 * Artifact detection + repair for separated stems (pure JS, runs in the studio worker).
 *
 * The desktop app has no dedicated artifact detector (it only gates/expands in the time domain), so these detectors
 * are Stem Studio's own. They follow the audible failure modes of source separation:
 *   clicks   - isolated 1-30 sample spikes (chunk joins, clipping)           fix: de-click (cubic repair)
 *   noise    - a low-level noise bed / residue between phrases or hits        fix: spectral gate / denoise
 *   holes    - spectral "swiss cheese" dropouts inside otherwise loud regions fix: smoothing / hole fill
 *   watery   - isolated time-frequency blips (musical-noise "bubbling")       fix: temporal smoothing
 *   phasey   - out-of-phase stereo content that cancels when summed to mono   fix: phase alignment
 *   bleed    - another stem's content ghosting into this one                  fix: cross-stem masking
 * Every analysis returns plain-language issues with a severity and a ready-to-run fix descriptor.
 */
import { analyze, synth, mags, processInSegments, NFFT, HOP, hzBin } from './dsp/spectral.js';
import { FFT } from '../roformer-web/dsp.js';

const SIGN = (x) => (x < 0 ? -1 : 1);
const dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));
export const SEVERITY = ['ok', 'minor', 'moderate', 'major'];
const sev = (v, [a, b, c]) => (v >= c ? 3 : v >= b ? 2 : v >= a ? 1 : 0);
const SINE_REF = NFFT / 4; // |X| of a full-scale sine through a Hann window -> dBFS-of-a-sine scale
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ clicks */

/** returns [{n (sample index), len, peak}] for one channel */
export function findClicks(x, sr, { sensitivity = 1 } = {}) {
  const N = x.length, e = new Float32Array(N);
  for (let i = 3; i < N; i++) e[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; // 3rd difference: kills smooth audio, keeps spikes
  const B = 1024, nb = Math.ceil(N / B), med = new Float32Array(nb), tmp = new Float32Array(B);
  for (let b = 0; b < nb; b++) { const a = b * B, m = Math.min(B, N - a); for (let i = 0; i < m; i++) tmp[i] = Math.abs(e[a + i]); med[b] = tmp.subarray(0, m).sort()[m >> 1]; }
  const absFloor = 0.004 / sensitivity; // -48 dBFS
  const out = []; const look0 = Math.round(sr * 0.0005), look1 = Math.round(sr * 0.002);
  for (let i = 4; i < N - look1 - 2; i++) {
    const a = Math.abs(e[i]); if (a < absFloor) continue;
    const m = Math.max(med[(i / B) | 0], med[Math.max(0, ((i / B) | 0) - 1)], med[Math.min(nb - 1, ((i / B) | 0) + 1)]);
    if (a < (14 / sensitivity) * Math.max(m, 1e-5)) continue;
    // local max of the residual in its neighbourhood
    let isMax = true; for (let j = 1; j <= 3 && isMax; j++) if (Math.abs(e[i - j]) > a || Math.abs(e[i + j]) > a) isMax = false; if (!isMax) continue;
    // a real transient keeps ringing in the high band afterwards; a click does not
    let after = 0; for (let j = look0; j < look1; j++) after = Math.max(after, Math.abs(e[i + j]));
    if (after > 0.2 * a) continue;
    out.push({ n: i, peak: a }); i += 6;
  }
  return out;
}

/** repair spikes by replacing a short span with a cubic Hermite curve through the surrounding good samples */
export function repairClicks(x, clicks, sr) {
  const y = Float32Array.from(x), N = x.length; let fixed = 0;
  for (const c of clicks) {
    const a = Math.max(3, c.n - 4), b = Math.min(N - 4, c.n + 4); // 3rd diff spike at i corrupts samples i-3..i
    const p0 = a - 1, p1 = b + 1; if (p1 - p0 < 2) continue;
    const y0 = y[p0], y1 = y[p1], m0 = (y[p0] - y[p0 - 2]) / 2, m1 = (y[p1 + 2 > N - 1 ? N - 1 : p1 + 2] - y[p1]) / 2, L = p1 - p0;
    for (let i = a; i <= b; i++) {
      const t = (i - p0) / L, t2 = t * t, t3 = t2 * t;
      y[i] = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * L * m1;
    }
    fixed++;
  }
  return { out: y, fixed };
}

/* ------------------------------------------------------------------ frame levels / noise bed */

function frameDb(L, R, block = 2048, hop = 1024) {
  const n = Math.max(1, Math.floor((L.length - block) / hop) + 1), out = new Float32Array(n);
  for (let t = 0; t < n; t++) { let s = 0; const a = t * hop; for (let i = 0; i < block; i++) { const l = L[a + i], r = R[a + i]; s += l * l + r * r; } out[t] = 10 * Math.log10(s / (2 * block) + 1e-14); }
  return out;
}
const pct = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** per-bin noise power profile from the quietest frames (>= 3 s of material needed) */
export function noiseProfile(L, R, sr, { quietFrac = 0.12 } = {}) {
  const fd = frameDb(L, R), thr = pct(fd, quietFrac);
  const F = NFFT / 2 + 1, prof = new Float64Array(F); let count = 0;
  const hop = 1024, block = 2048;
  // frames chosen on the time-domain pass; their spectra are averaged
  const pick = []; for (let t = 0; t < fd.length; t++) if (fd[t] <= thr) pick.push(t);
  const maxPick = 400, stride = Math.max(1, Math.floor(pick.length / maxPick));
  const win = new Float64Array(block); for (let i = 0; i < block; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / block));
  const fftMod = analyzeOne; const re = new Float64Array(block);
  for (let q = 0; q < pick.length; q += stride) {
    const a = pick[q] * hop; for (let i = 0; i < block; i++) re[i] = ((L[a + i] + R[a + i]) / 2) * win[i];
    const sp = fftMod(re); for (let k = 0; k < F; k++) prof[k] += sp[k]; count++;
  }
  if (count) for (let k = 0; k < F; k++) prof[k] /= count;
  return { power: Float32Array.from(prof), levelDb: thr, frames: count };
}
function analyzeOne(x) { const n = x.length, f = FFT.get(n), im = new Float64Array(n), re = Float64Array.from(x); f.transform(re, im); const F = n / 2 + 1, p = new Float64Array(F); for (let k = 0; k < F; k++) { const m = Math.hypot(re[k], im[k]) / SINE_REF; p[k] = m * m; } return p; }

/** spectral gate / denoise: Wiener-style subtraction of the measured profile + a soft gate on frames at the noise level */
export function spectralDenoise(L, R, sr, { profile, reductionDb = 18, overSub = 1.6, gateDb = 12, floorDb = -30 } = {}) {
  const prof = profile.power, F = NFFT / 2 + 1, gFloor = Math.pow(10, -Math.abs(reductionDb) / 20);
  let profTotal = 0; for (let k = 0; k < F; k++) profTotal += prof[k]; profTotal = Math.max(profTotal, 1e-14);
  return processInSegments(L, R, sr, (S) => {
    const { T } = S; const g = new Float32Array(T * F);
    for (let t = 0; t < T; t++) {
      const o = t * F; let eTot = 0;
      for (let k = 0; k < F; k++) {
        const mL = Math.hypot(S.reL[o + k], S.imL[o + k]) / SINE_REF, mR = Math.hypot(S.reR[o + k], S.imR[o + k]) / SINE_REF;
        const p = (mL * mL + mR * mR) / 2; eTot += p;
        const n2 = overSub * prof[k];
        g[o + k] = p > 1e-20 ? Math.sqrt(Math.max(0, p - n2) / p) : 0;
      }
      // soft gate when the whole frame sits near the noise level
      const ratioDb = 10 * Math.log10(eTot / profTotal + 1e-12);
      const gate = ratioDb >= gateDb ? 1 : Math.pow(10, (-(gateDb - Math.max(ratioDb, 0)) * (Math.abs(floorDb) / gateDb)) / 20);
      for (let k = 0; k < F; k++) g[o + k] = Math.max(gFloor, g[o + k]) * (ratioDb >= gateDb ? 1 : gate);
    }
    smoothMask(g, T, F);
    applyMaskStereo(S, g);
  });
}

/** attack-fast / release-slow smoothing over time and a 3-tap smoothing over frequency (kills "musical noise") */
export function smoothMask(g, T, F, rel = 0.6) {
  for (let t = 1; t < T; t++) { const o = t * F, p = o - F; for (let k = 0; k < F; k++) { const a = g[o + k], b = g[p + k]; g[o + k] = a < b ? a : a + rel * (b - a); } }
  const row = new Float32Array(F);
  for (let t = 0; t < T; t++) { const o = t * F; for (let k = 1; k < F - 1; k++) row[k] = 0.25 * g[o + k - 1] + 0.5 * g[o + k] + 0.25 * g[o + k + 1]; row[0] = g[o]; row[F - 1] = g[o + F - 1]; for (let k = 0; k < F; k++) g[o + k] = row[k]; }
}
export function applyMaskStereo(S, g) { const n = S.T * S.F; for (let i = 0; i < n; i++) { const m = g[i]; S.reL[i] *= m; S.imL[i] *= m; S.reR[i] *= m; S.imR[i] *= m; } }

/* ------------------------------------------------------------------ segment analysis (holes, watery, phasey) */

function midMag(S) {
  const n = S.T * S.F, m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.hypot(S.reL[i] + S.reR[i], S.imL[i] + S.imR[i]) / (2 * SINE_REF);
  return m;
}
const FLOOR = Math.pow(10, -62 / 20);

/** holes & blips counted over one segment's mid spectrogram (analysis-hop grid) */
function holeStats(M, T, F, k0, k1) {
  let cand = 0, holes = 0, blipCand = 0, blips = 0; const holeFrames = [];
  for (let t = 3; t < T - 3; t++) {
    const o = t * F; let hf = 0;
    for (let k = k0 + 6; k < k1 - 6; k++) {
      const cur = M[o + k]; const a = M[o - 3 * F + k], b = M[o + 3 * F + k];
      if (a > FLOOR * 4 && b > FLOOR * 4) {
        const fm = (M[o + k - 3] + M[o + k - 4] + M[o + k + 3] + M[o + k + 4]) / 4;
        if (fm > FLOOR * 4) {
          cand++;
          const tn = (M[o - 3 * F + k] + M[o - 2 * F + k] + M[o + 2 * F + k] + M[o + 3 * F + k]) / 4;
          if (cur < 0.1 * tn && cur < 0.25 * fm) { holes++; hf++; }
        }
      }
      // blip: isolated local maximum, +12 dB above both time neighbours and both frequency neighbours
      if (cur > FLOOR * 6) {
        blipCand++;
        const nb = Math.max(M[o - 2 * F + k], M[o + 2 * F + k], M[o + k - 2], M[o + k + 2]);
        if (cur > 4 * nb && cur > M[o - F + k] && cur > M[o + F + k] && cur > M[o + k - 1] && cur > M[o + k + 1]) blips++;
      }
    }
    holeFrames.push(hf);
  }
  return { cand, holes, blipCand, blips, holeFrames };
}

function phaseStats(S, k0, k1) {
  let eTot = 0, eAnti = 0, eSide = 0, eMid = 0; const { T, F } = S;
  for (let t = 0; t < T; t++) {
    const o = t * F;
    for (let k = k0; k < k1; k++) {
      const lr = S.reL[o + k], li = S.imL[o + k], rr = S.reR[o + k], ri = S.imR[o + k];
      const pl = lr * lr + li * li, pr = rr * rr + ri * ri, tot = pl + pr; if (tot < 1e-6) continue;
      const cross = lr * rr + li * ri; // Re(L conj R)
      eTot += tot; eMid += ((lr + rr) ** 2 + (li + ri) ** 2) / 2; eSide += ((lr - rr) ** 2 + (li - ri) ** 2) / 2;
      const c = cross / (Math.sqrt(pl * pr) + 1e-12);
      if (c < -0.5 && Math.min(pl, pr) > 0.1 * Math.max(pl, pr)) eAnti += tot;
    }
  }
  return { eTot, eAnti, eSide, eMid };
}

/* ------------------------------------------------------------------ bleed */

/**
 * Ghost statistics for target stem A against interfering stem B over one segment: among the bins where B is clearly active
 * (cntB), how many hold a quieter copy of it in A (n) and how tightly the A/B level difference clusters (sd, sd2).
 * A leaked copy keeps a near-constant level offset; independent musical overlap does not.
 */
export function bleedStats(MA, MB, T, F, k0, k1) {
  let n = 0, sd = 0, sd2 = 0, cntB = 0; const ACTIVE = FLOOR * 10;
  for (let t = 0; t < T; t++) {
    const o = t * F;
    for (let k = k0; k < k1; k++) {
      const a = MA[o + k], b = MB[o + k];
      if (b < ACTIVE) continue;
      cntB++;
      if (b > 3 * a && a > b * 0.01 && a > FLOOR * 0.5) { const d = 20 * Math.log10(a / b); n++; sd += d; sd2 += d * d; }
    }
  }
  return { n, sd, sd2, cntB };
}

/** soft cross-stem mask for target A given interfering stem B magnitudes */
export function bleedMask(MA, MB, T, F, { strength = 0.7, gamma = 0.15, floorDb = -18 } = {}) {
  const g = new Float32Array(T * F), gMin = Math.pow(10, -Math.abs(floorDb) * strength / 20) , gam = gamma;
  for (let i = 0; i < g.length; i++) {
    const a2 = MA[i] * MA[i], b2 = MB[i] * MB[i];
    // Wiener-like: where B is far above A, A is probably B leaking in
    let m = a2 / (a2 + gam * b2 + 1e-20);
    m = b2 > 2.5 * a2 ? Math.pow(m, 0.5 + 0.5 * strength) : 1; // only act where B dominates (>= 4 dB)
    g[i] = Math.max(gMin, Math.min(1, m));
  }
  smoothMask(g, T, F, 0.5);
  return g;
}

/* ------------------------------------------------------------------ top-level analysis */

/**
 * @param {{name:string, kind:string, L:Float32Array, R:Float32Array}} stem
 * @param {{name:string, L, R}[]} others  other stems (for bleed)
 * @returns {{issues:Array, metrics:Object}}
 */
export function analyzeStem(stem, sr, others = [], { onProgress } = {}) {
  const { L, R } = stem, N = L.length, dur = N / sr, issues = [], metrics = {};
  const peakDb = dB(Math.max(...[L, R].map((c) => { let m = 0; for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; } return m; })));
  metrics.peakDb = peakDb;
  if (peakDb < -70 || dur < 0.5) return { issues, metrics: { ...metrics, silent: true } };

  // clicks ------------------------------------------------------
  const cl = findClicks(L, sr).map((c) => ({ ...c, ch: 0 })).concat(findClicks(R, sr).map((c) => ({ ...c, ch: 1 })));
  metrics.clicks = cl.length; onProgress?.(0.15);
  if (cl.length) {
    const rate = cl.length / dur;
    issues.push({ id: 'clicks', type: 'clicks', severity: SEVERITY[Math.max(1, sev(rate, [0.02, 0.2, 1]))], value: cl.length,
      title: `${cl.length} click${cl.length > 1 ? 's' : ''} / pops`,
      plain: `Found ${cl.length} short spikes (first at ${fmtTime(cl[0].n / sr)}). They sound like crackles or pops and usually come from chunk joins or clipping in the split.`,
      where: cl.slice(0, 50).map((c) => ({ start: c.n / sr - 0.01, end: c.n / sr + 0.01 })),
      fix: { type: 'declick', label: 'Remove clicks', params: { sensitivity: 1 } } });
  }

  // noise bed ---------------------------------------------------
  const fd = frameDb(L, R); const p10 = pct(fd, 0.1), p95 = pct(fd, 0.95), p50 = pct(fd, 0.5);
  metrics.floorDb = p10; metrics.loudDb = p95; metrics.dynamicDb = p95 - p10;
  const bedFrac = fd.filter((v) => v < p95 - 25 && v > -80).length / fd.length; metrics.noiseBedFrac = bedFrac;
  let flat = 0;
  if (p95 - p10 > 22 && p10 > -62 && p10 < p95 - 22 && bedFrac > 0.03) {
    // a noise bed is broadband and stationary; the quiet bars of a bass line or pad are tonal (flatness ~0.0002 on a real Mini bass stem)
    const pr = noiseProfile(L, R, sr), a = hzBin(100, sr), b = hzBin(14000, sr); let lg = 0, sm = 0;
    for (let k = a; k < b; k++) { const v = pr.power[k] + 1e-20; lg += Math.log(v); sm += v; }
    flat = Math.exp(lg / (b - a)) / (sm / (b - a));
  }
  metrics.noiseFlatness = flat;
  if (flat > 0.02) {
    issues.push({ id: 'noise', type: 'noise', severity: SEVERITY[sev(p10, [-62, -52, -42])] === 'ok' ? 'minor' : SEVERITY[sev(p10, [-62, -52, -42])], value: p10,
      title: `Noise bed at ${p10.toFixed(0)} dBFS`,
      plain: `The quietest passages sit at about ${p10.toFixed(0)} dBFS instead of silence (${(bedFrac * 100).toFixed(0)}% of the track is more than 25 dB below the loud parts). That's separation residue or hiss you can hear between phrases and hits.`,
      where: [],
      fix: { type: 'denoise', label: 'Spectral gate / denoise', params: { reductionDb: 18, overSub: 1.6, gateDb: 12, floorDb: -30 }, needsProfile: true } });
  }
  onProgress?.(0.3);

  // spectral stats (holes / watery / phase / bleed) ----------------
  const seg = Math.round(30 * sr), ctx = Math.round(0.5 * sr);
  const k0 = hzBin(150, sr), k1 = Math.min(NFFT / 2 - 8, hzBin(10000, sr)), kh0 = hzBin(1500, sr), kh1 = Math.min(NFFT / 2 - 8, hzBin(12000, sr));
  const H = { cand: 0, holes: 0 }, W = { cand: 0, blips: 0 }, P = { eTot: 0, eAnti: 0, eSide: 0, eMid: 0 };
  const B = others.map(() => ({ n: 0, sd: 0, sd2: 0, cntB: 0 }));
  let hv = 0; const holeTimes = [];
  for (let a = 0; a < N; a += seg) {
    const b = Math.min(N, a + seg), a0 = Math.max(0, a - ctx), a1 = Math.min(N, b + ctx);
    const S = analyze(L.subarray(a0, a1), R.subarray(a0, a1), NFFT, 1024);
    const M = midMag(S), { T, F } = S;
    const hs = holeStats(M, T, F, k0, k1); H.cand += hs.cand; H.holes += hs.holes;
    const ws = holeStats(M, T, F, kh0, kh1); W.cand += ws.blipCand; W.blips += ws.blips;
    hs.holeFrames.forEach((c, i) => { if (c > 40) holeTimes.push((a0 + (i + 3) * 1024) / sr); });
    const ps = phaseStats(S, hzBin(200, sr), hzBin(8000, sr)); for (const key of Object.keys(P)) P[key] += ps[key];
    others.forEach((o, i) => {
      const So = analyze(o.L.subarray(a0, a1), o.R.subarray(a0, a1), NFFT, 1024), MB = midMag(So);
      const st = bleedStats(M, MB, T, F, hzBin(100, sr), hzBin(9000, sr));
      for (const key of ['n', 'sd', 'sd2', 'cntB']) B[i][key] += st[key];
    });
    onProgress?.(0.3 + 0.65 * (b / N)); hv++;
  }
  void hv;
  const holeFrac = H.cand ? H.holes / H.cand : 0; metrics.holeFrac = holeFrac;
  if (H.cand > 800 && holeFrac > 0.022) {
    issues.push({ id: 'holes', type: 'holes', severity: SEVERITY[sev(holeFrac, [0.022, 0.04, 0.08])], value: holeFrac,
      title: `Spectral holes (${(holeFrac * 100).toFixed(1)}%)`,
      plain: `${(holeFrac * 100).toFixed(1)}% of the mid-range spectrum has sudden dropouts inside otherwise loud passages. They make the stem sound thin, "swiss cheese" or gappy.`,
      where: holeTimes.slice(0, 50).map((t) => ({ start: t - 0.05, end: t + 0.05 })),
      fix: { type: 'fillholes', label: 'Fill & smooth holes', params: { strength: 0.8 } } });
  }
  const blipDensity = W.cand ? W.blips / W.cand : 0; metrics.blipDensity = blipDensity;
  if (W.cand > 800 && blipDensity > 0.006) {
    issues.push({ id: 'watery', type: 'watery', severity: SEVERITY[sev(blipDensity, [0.006, 0.012, 0.025])], value: blipDensity,
      title: 'Watery / bubbly high end',
      plain: `The upper mids and highs are full of tiny isolated blips (${(blipDensity * 100).toFixed(1)}% of bins). That's the "underwater" or bubbling sound common in separations.`,
      where: [],
      fix: { type: 'smooth', label: 'Smooth over time', params: { strength: 0.6 } } });
  }
  const side = P.eMid > 0 ? P.eSide / (P.eMid + P.eSide) : 0, anti = P.eTot ? P.eAnti / P.eTot : 0;
  const monoLoss = P.eTot > 0 ? 10 * Math.log10(((P.eMid / (P.eMid + P.eSide)) + 1e-9) / 0.5) : 0; // 0 dB when mid=side energy, i.e. uncorrelated
  metrics.antiphaseFrac = anti; metrics.sideFrac = side; metrics.monoLossDb = monoLoss;
  if (P.eTot > 0 && anti > 0.10) {
    issues.push({ id: 'phasey', type: 'phasey', severity: SEVERITY[sev(anti, [0.10, 0.2, 0.35])], value: anti,
      title: 'Phasey stereo',
      plain: `${(anti * 100).toFixed(0)}% of the stereo energy is out of phase between left and right. It sounds hollow, and parts disappear when the mix is played in mono (phones, club systems).`,
      where: [], fix: { type: 'phase', label: 'Align phase', params: { strength: 0.8 } } });
  }
  others.forEach((o, i) => {
    const b = B[i]; (metrics.bleedRaw ||= []).push({ name: o.name, n: b.n, cntB: b.cntB }); if (b.cntB < 300 || b.n < 80) return;
    const mean = b.sd / b.n, sdv = Math.sqrt(Math.max(0, b.sd2 / b.n - mean * mean)), ghost = b.n / b.cntB;
    (metrics.bleed ||= []).push({ name: o.name, levelDb: mean, spreadDb: sdv, ghostFrac: ghost });
    const score = ghost * Math.max(0, 1 - sdv / 10) * 100; // 0..100
    if (ghost > 0.3 && sdv < 6.5 && mean > -40 && score > 12) {
      issues.push({ id: `bleed:${o.name}`, type: 'bleed', severity: SEVERITY[sev(score, [12, 22, 35])], value: score,
        title: `${cap(o.name)} bleeding into ${stem.name}`,
        plain: `A quieter copy of the ${o.name} stem (about ${mean.toFixed(0)} dB down) shows up in ${(ghost * 100).toFixed(0)}% of the places where ${o.name} is playing. Expect ghost hits or smeared notes.`,
        where: [], fix: { type: 'bleed', label: `Reduce ${o.name} bleed`, params: { strength: 0.7, against: o.name } } });
    }
  });
  onProgress?.(1);
  return { issues, metrics };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ fixes */

/** @param {{type:string, params:Object}} fix @param {{L,R}} stem  @param {{name,L,R}[]} others @returns {{L,R,summary:string}} */
export function applyFix(fix, stem, sr, others = [], { onProgress } = {}) {
  const { L, R } = stem, p = fix.params || {};
  switch (fix.type) {
    case 'declick': {
      const cl = findClicks(L, sr, p), cr = findClicks(R, sr, p);
      const a = repairClicks(L, cl, sr), b = repairClicks(R, cr, sr);
      return { L: a.out, R: b.out, summary: `Repaired ${a.fixed + b.fixed} clicks.` };
    }
    case 'denoise': {
      const profile = p.profile || noiseProfile(L, R, sr);
      const [yl, yr] = spectralDenoise(L, R, sr, { ...p, profile });
      return { L: yl, R: yr, summary: `Gated the noise bed (profile from the quietest ${profile.frames} frames, ${profile.levelDb.toFixed(0)} dBFS).` };
    }
    case 'fillholes': {
      const s = p.strength ?? 0.8;
      const [yl, yr] = processInSegments(L, R, sr, (S) => fillHoles(S, s, sr), { onProgress });
      return { L: yl, R: yr, summary: 'Filled spectral dropouts from neighbouring frames.' };
    }
    case 'smooth': {
      const s = p.strength ?? 0.6;
      const [yl, yr] = processInSegments(L, R, sr, (S) => smoothTime(S, s), { onProgress });
      return { L: yl, R: yr, summary: 'Smoothed the high-end magnitude over time.' };
    }
    case 'phase': {
      const s = p.strength ?? 0.8;
      const [yl, yr] = processInSegments(L, R, sr, (S) => alignPhase(S, s), { onProgress });
      return { L: yl, R: yr, summary: 'Rotated anti-phase bins so left and right sum cleanly.' };
    }
    case 'bleed': {
      const o = others.find((x) => x.name === p.against); if (!o) return { L, R, summary: 'Reference stem not found.' };
      const [yl, yr] = processInSegments(L, R, sr, (S, a0, a1) => {
        const So = analyze(o.L.subarray(a0, a1), o.R.subarray(a0, a1), NFFT, HOP);
        const [mAL, mAR] = mags(S), [mBL, mBR] = mags(So), n = S.T * S.F, MA = new Float32Array(n), MB = new Float32Array(n);
        for (let i = 0; i < n; i++) { MA[i] = (mAL[i] + mAR[i]) / (2 * SINE_REF); MB[i] = (mBL[i] + mBR[i]) / (2 * SINE_REF); }
        applyMaskStereo(S, bleedMask(MA, MB, S.T, S.F, { strength: p.strength ?? 0.7 }));
      }, { onProgress });
      return { L: yl, R: yr, summary: `Masked ${p.against} content out of this stem (cross-stem mask).` };
    }
    default: throw new Error(`Unknown fix: ${fix.type}`);
  }
}

function fillHoles(S, strength, sr) {
  const { T, F } = S, M = new Float32Array(T * F);
  for (let i = 0; i < M.length; i++) M[i] = Math.hypot(S.reL[i] + S.reR[i], S.imL[i] + S.imR[i]) / (2 * SINE_REF);
  const g = new Float32Array(T * F).fill(1);
  // neighbours sit at the same distance in *time* as the detector uses (3 analysis frames at hop 1024 = 70 ms)
  const d2 = Math.max(2, Math.round((0.0697 * sr) / S.hop)), d1 = Math.max(1, Math.round(d2 * 0.66));
  for (let t = d2; t < T - d2; t++) {
    const o = t * F;
    for (let k = 8; k < F - 8; k++) {
      const cur = M[o + k], a = Math.min(M[o - d2 * F + k], M[o - d1 * F + k]), b = Math.min(M[o + d2 * F + k], M[o + d1 * F + k]);
      const tn = (a + b) / 2, fm = (M[o + k - 3] + M[o + k - 4] + M[o + k + 3] + M[o + k + 4]) / 4;
      if (a > FLOOR * 4 && b > FLOOR * 4 && fm > FLOOR * 4 && cur < 0.2 * tn && cur < 0.35 * fm) {
        const target = Math.min(tn, fm) * 0.6; g[o + k] = Math.pow(target / Math.max(cur, 1e-9), strength);
      }
    }
  }
  // gain is capped (+18 dB) and spread to neighbours so the fill blends in
  for (let i = 0; i < g.length; i++) if (g[i] > 8) g[i] = 8;
  const row = new Float32Array(F);
  for (let t = 0; t < T; t++) { const o = t * F; for (let k = 1; k < F - 1; k++) row[k] = Math.max(g[o + k], 0.6 * Math.max(g[o + k - 1], g[o + k + 1])); row[0] = g[o]; row[F - 1] = g[o + F - 1]; for (let k = 1; k < F - 1; k++) g[o + k] = Math.max(1, row[k]); }
  applyMaskStereo(S, g);
}

function smoothTime(S, strength) {
  const { T, F } = S, kLo = Math.round((1500 / 22050) * (F - 1)), W = [0.1, 0.2, 0.4, 0.2, 0.1];
  const mL = new Float32Array(T * F), mR = new Float32Array(T * F);
  for (let i = 0; i < mL.length; i++) { mL[i] = Math.hypot(S.reL[i], S.imL[i]); mR[i] = Math.hypot(S.reR[i], S.imR[i]); }
  const g = new Float32Array(T * F).fill(1);
  for (let t = 2; t < T - 2; t++) {
    const o = t * F;
    for (let k = kLo; k < F - 2; k++) {
      const m = (mL[o + k] + mR[o + k]) / 2; if (m < 1e-9) continue;
      let sm = 0; for (let j = -2; j <= 2; j++) { const q = (t + j) * F + k; sm += W[j + 2] * (mL[q] + mR[q]) / 2; }
      // only tame isolated peaks: never raise the level
      if (m > sm) g[o + k] = Math.pow(sm / m, strength);
    }
  }
  applyMaskStereo(S, g);
}

function alignPhase(S, strength) {
  const { T, F } = S;
  for (let i = 0; i < T * F; i++) {
    const lr = S.reL[i], li = S.imL[i], rr = S.reR[i], ri = S.imR[i];
    const pl = lr * lr + li * li, pr = rr * rr + ri * ri; if (pl + pr < 1e-12) continue;
    const c = (lr * rr + li * ri) / (Math.sqrt(pl * pr) + 1e-12);
    if (c < -0.5 && Math.min(pl, pr) > 0.1 * Math.max(pl, pr)) {
      const a = strength * Math.min(1, (-c - 0.5) / 0.3); // 0..strength, ramps in so there is no hard switching
      // rotate the right channel's phase towards a polarity flip (|R| preserved, no hard switching)
      const th = Math.PI * a, cs = Math.cos(th), sn = Math.sin(th);
      S.reR[i] = rr * cs - ri * sn; S.imR[i] = rr * sn + ri * cs;
    }
  }
}

export { synth, SINE_REF };
