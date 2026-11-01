/**
 * Loudness normalisation to a target (LUFS) with a true-peak ceiling (dBTP).
 * gain = target - integrated; if the 4x-oversampled peak would exceed the ceiling a look-ahead limiter
 * is applied and the threshold is walked down until the measured true peak is inside the ceiling; if the
 * limiter cost loudness the gain is nudged up (a few passes) so the target is still met when possible.
 * The result reports what was actually achieved - it never claims a target it missed.
 */
import { measureLoudness } from './dsp/loudness.js';
import { Limiter } from './dsp/fx-dynamics.js';

const db2lin = (d) => Math.pow(10, d / 20);

export function limitCopy(L, R, sr, thresholdDb, releaseMs = 120) {
  const lim = new Limiter(sr, { threshold: thresholdDb, release: releaseMs });
  const lat = lim.latency, n = L.length;
  const oL = new Float32Array(n + lat), oR = new Float32Array(n + lat);
  oL.set(L); oR.set(R);
  const B = 4096;
  for (let i = 0; i < oL.length; i += B) { const m = Math.min(B, oL.length - i); lim.process(oL.subarray(i, i + m), oR.subarray(i, i + m), m); }
  return [oL.slice(lat, lat + n), oR.slice(lat, lat + n)];
}

/** @returns {{L,R,gainDb,limited,before,after,reachedTarget}} */
export function normalizeToTarget(L, R, sr, { lufs, tp = -1, maxGainDb = 40 } = {}) {
  const before = measureLoudness(L, R, sr);
  if (!Number.isFinite(before.integrated)) return { L, R, gainDb: 0, limited: false, before, after: before, reachedTarget: false, note: 'Silent or too quiet to measure.' };
  let gainDb = Math.max(-maxGainDb, Math.min(maxGainDb, lufs - before.integrated));
  let outL, outR, after, limited = false, thr = tp - 0.3;
  const gained = (g) => { const k = db2lin(g); const a = new Float32Array(L.length), b = new Float32Array(L.length); for (let i = 0; i < a.length; i++) { a[i] = L[i] * k; b[i] = R[i] * k; } return [a, b]; };
  for (let pass = 0; pass < 4; pass++) {
    [outL, outR] = gained(gainDb);
    after = measureLoudness(outL, outR, sr);
    if (after.truePeakDb > tp + 0.001) {
      limited = true; thr = Math.min(thr, tp - 0.3);
      for (let it = 0; it < 8; it++) {
        const [a, b] = limitCopy(...gained(gainDb), sr, thr);
        outL = a; outR = b; after = measureLoudness(outL, outR, sr);
        if (after.truePeakDb <= tp + 0.001) break;
        thr -= (after.truePeakDb - tp) + 0.05;
      }
    }
    const deficit = lufs - after.integrated;
    if (Math.abs(deficit) <= 0.05 || !limited || deficit < 0) break; // on target (or limiter-bound and over target: fine)
    gainDb += deficit; // limiter ate loudness; push gain and re-limit
  }
  return { L: outL, R: outR, gainDb, limited, before, after, reachedTarget: Math.abs(after.integrated - lufs) <= 0.1 && after.truePeakDb <= tp + 0.01 };
}
