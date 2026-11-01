import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHats, derive808, findKickEvents, dspDrumSplit, zeroPhaseLowpass } from '../public/stem-studio/drums/drum-dsp.js';

const sr = 44100;
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
const maxErr = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

function hatsAndCrash(sec = 4) {
  const N = sr * sec, x = new Float32Array(N), r = rng(5), hatsOnly = new Float32Array(N), crashOnly = new Float32Array(N);
  let hp = 0;
  for (let b = 0; b < 8; b++) { // closed hats: 20 ms highpassed-noise bursts every 250 ms
    const s0 = Math.round(b * 0.25 * sr); for (let i = 0; i < 0.02 * sr; i++) { const n = r(), v = (n - hp) * Math.exp(-i / (0.004 * sr)) * 0.5; hp = n; hatsOnly[s0 + i] += v; }
  }
  const s0 = Math.round(2 * sr); for (let i = 0; i < 1.5 * sr; i++) crashOnly[s0 + i] += r() * Math.exp(-i / (0.5 * sr)) * 0.3; // crash wash at t=2s
  for (let i = 0; i < N; i++) x[i] = hatsOnly[i] + crashOnly[i];
  return { x, hatsOnly, crashOnly };
}

test('splitHats: outputs sum to the input and the ticks end up in hats, the long wash in cymbals', () => {
  const { x, hatsOnly, crashOnly } = hatsAndCrash();
  const { hats, cymbals } = splitHats(x, x.slice(), sr);
  for (let c = 0; c < 2; c++) assert.ok(maxErr(x, hats[c].map((v, i) => v + cymbals[c][i])) < 1e-6);
  // hats-only portion (first 1.5 s, before the crash): most energy lands in hats
  const seg = (a) => a.subarray(0, Math.round(1.8 * sr));
  assert.ok(rms(seg(hats[0])) > 3 * rms(seg(cymbals[0])), `hat region: hats ${rms(seg(hats[0]))} cym ${rms(seg(cymbals[0]))}`);
  // the late crash tail (2.6 s..3.4 s) goes mostly to cymbals
  const tail = (a) => a.subarray(Math.round(2.6 * sr), Math.round(3.4 * sr));
  assert.ok(rms(tail(cymbals[0])) > 2 * rms(tail(hats[0])), `tail: cym ${rms(tail(cymbals[0]))} hats ${rms(tail(hats[0]))}`);
});

function kicks() {
  const N = sr * 4, k = new Float32Array(N), truth808 = new Float32Array(N);
  const hit = (t, f, decayMs, amp, dst) => { const s0 = Math.round(t * sr); for (let i = 0; s0 + i < N && i < 1.2 * sr; i++) dst[s0 + i] += amp * Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (sr * decayMs / 1000)); };
  hit(0.2, 55, 70, 0.8, k); hit(1.2, 45, 400, 0.8, k); hit(1.2, 45, 400, 0.8, truth808); hit(2.9, 60, 60, 0.8, k);
  return { k, truth808 };
}
test('findKickEvents measures ring time: short kicks vs 808-style tail', () => {
  const { k } = kicks(); const ev = findKickEvents(k, sr);
  assert.equal(ev.length, 3, JSON.stringify(ev.map((e) => e.tailMs)));
  assert.ok(ev[0].tailMs < 180 && ev[2].tailMs < 180 && ev[1].tailMs > 300, JSON.stringify(ev.map((e) => Math.round(e.tailMs))));
});
test('derive808 moves only the long-ringing kick into 808 and conserves the sum', () => {
  const { k, truth808 } = kicks(); const kick = [k, k.slice()], bass = [new Float32Array(k.length), new Float32Array(k.length)];
  for (let i = 0; i < k.length; i++) { bass[0][i] = bass[1][i] = 0.3 * Math.sin(2 * Math.PI * 40 * i / sr) + 0.2 * Math.sin(2 * Math.PI * 400 * i / sr); }
  const r = derive808({ bass, kick, sr });
  assert.deepEqual(r.events.map((e) => e.is808), [false, true, false]);
  for (let c = 0; c < 2; c++) {
    const lo = zeroPhaseLowpass(bass[c], sr, 120);
    assert.ok(maxErr(bass[c], r.bassRest[c].map((v, i) => v + lo[i])) < 1e-5);
    const kRebuilt = r.kickRest[c].map((v, i) => v + (r.sub808[c][i] - lo[i]));
    assert.ok(maxErr(kick[c], kRebuilt) < 1e-5, 'kick conserved');
  }
  // the 808 hit at 1.2 s moved out of the kick: its rest is far quieter there; the short kicks stay
  const win = (a, t0, t1) => a.subarray(Math.round(t0 * sr), Math.round(t1 * sr));
  assert.ok(rms(win(r.kickRest[0], 1.3, 1.9)) < 0.15 * rms(win(k, 1.3, 1.9)));
  assert.ok(rms(win(r.kickRest[0], 0.2, 0.3)) > 0.9 * rms(win(k, 0.2, 0.3)));
  // bass low band is in the 808, the 400 Hz part stays in the bass
  assert.ok(rms(win(r.bassRest[0], 0.5, 1)) < 0.2 && rms(win(r.bassRest[0], 0.5, 1)) > 0.12);
});
test('dspDrumSplit partitions the signal (sum = input)', () => {
  const { x } = hatsAndCrash(3); const o = dspDrumSplit(x, x.slice(), sr); let tot = new Float32Array(x.length);
  for (const p of Object.values(o)) for (let i = 0; i < x.length; i++) tot[i] += p[0][i];
  assert.ok(maxErr(x, tot) < 1e-5, 'sum err ' + maxErr(x, tot));
});

import { buildParts } from '../public/stem-studio/drums/pipeline.js';
test('buildParts: drums and bass are conserved exactly (ML-style input with a remainder)', () => {
  const { x } = hatsAndCrash(3), { k } = kicks(), N = Math.min(x.length, k.length), r = rng(9);
  const mk = (f) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = f(i); return [a, a.slice()]; };
  const kick = mk((i) => k[i]), snare = mk((i) => 0.05 * r()), toms = mk(() => 0), cym = mk((i) => x[i]);
  const drums = mk((i) => kick[0][i] + snare[0][i] + cym[0][i] + 0.01 * Math.sin(i * 0.01)); // 0.01 sine = remainder
  const bass = mk((i) => 0.3 * Math.sin(2 * Math.PI * 40 * i / sr) + 0.2 * Math.sin(2 * Math.PI * 400 * i / sr));
  const { parts } = buildParts({ drums, bass, ml: { kick, snare, cymbals: cym, toms }, sr });
  const by = Object.fromEntries(parts.map((p) => [p.key, p]));
  assert.ok(by.kick && by.snare && by.toms && by.hats && by.cymbals && by.sub808 && by.bassRest && by.remainder);
  for (let c = 0; c < 2; c++) {
    const dsum = new Float32Array(N), bsum = new Float32Array(N);
    for (const p of parts) { if (p.parent === 'drums' && p.key !== 'sub808') for (let i = 0; i < N; i++) dsum[i] += p.audio[c][i]; if (p.key === 'bassRest') for (let i = 0; i < N; i++) bsum[i] += p.audio[c][i]; }
    // drums children (without 808) + the kick low band moved to 808 = drums ; 808 - bass low band = that kick part
    const lo = by.sub808.audio[c].map((v, i) => v + by.bassRest.audio[c][i] - bass[c][i]); // kick part moved into 808
    for (let i = 0; i < N; i += 7) assert.ok(Math.abs(dsum[i] + lo[i] - drums[c][i]) < 1e-4, `drums @${i}`);
  }
  assert.ok(by.remainder.rmsDb < -20 && by.remainder.rmsDb > -80);
});
