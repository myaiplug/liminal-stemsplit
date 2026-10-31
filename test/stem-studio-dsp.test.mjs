import test from 'node:test';
import assert from 'node:assert/strict';
import { Chain, FX_TYPES, createFx } from '../public/stem-studio/dsp/chain.js';
import { Limiter } from '../public/stem-studio/dsp/fx-dynamics.js';
import { FFT } from '../public/roformer-web/dsp.js';

const SR = 48000;
const sine = (f, n, a = 0.5, sr = SR) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
function run(config, L, R = L.slice(), block = 128) {
  const c = new Chain(SR, config); const l = L.slice(), r = R.slice();
  for (let i = 0; i < l.length; i += block) { const n = Math.min(block, l.length - i); c.process(l.subarray(i, i + n), r.subarray(i, i + n), n); }
  return { l, r, chain: c };
}
function peakFreq(x, sr = SR, N = 16384, start = 8000) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  FFT.get(N).transform(re, im);
  let best = 0, bk = 0; for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > best) { best = m; bk = k; } }
  return { f: (bk * sr) / N, mag: best };
}

test('peq peak: +6 dB at centre frequency, ~0 dB far away', () => {
  const x = sine(1000, SR), y = run([{ type: 'peq', params: { type: 'peak', freq: 1000, gain: 6, q: 1 } }], x).l;
  assert.ok(Math.abs(db(rms(y, 24000)) - db(rms(x, 24000)) - 6) < 0.1);
  const x2 = sine(100, SR), y2 = run([{ type: 'peq', params: { type: 'peak', freq: 1000, gain: 6, q: 1 } }], x2).l;
  assert.ok(Math.abs(db(rms(y2, 24000)) - db(rms(x2, 24000))) < 0.3);
});

test('first-order high-pass has 6 dB/oct slope and -3 dB at cutoff', () => {
  const at = (f) => { const x = sine(f, SR); const y = run([{ type: 'filter', params: { hp: 1000 } }], x).l; return db(rms(y, 24000)) - db(rms(x, 24000)); };
  assert.ok(Math.abs(at(1000) + 3.01) < 0.15, `cutoff ${at(1000)}`);
  assert.ok(Math.abs(at(250) - at(500) + 6) < 1.2, 'one octave below ~ -6 dB more');
});

test('gate: attenuates below threshold, passes above', () => {
  const quiet = sine(500, SR, 0.002), loud = sine(500, SR, 0.5);
  const q = run([{ type: 'gate', params: { threshold: -40, ratio: 4, attack: 2, release: 100 } }], quiet).l;
  const l = run([{ type: 'gate', params: { threshold: -40, ratio: 4, attack: 2, release: 100 } }], loud).l;
  assert.ok(db(rms(q, 24000)) < db(rms(quiet, 24000)) - 6);
  assert.ok(Math.abs(db(rms(l, 24000)) - db(rms(loud, 24000))) < 0.05);
});

test('compressor: gain reduction follows the (thr, ratio) law (no makeup)', () => {
  const x = sine(300, SR, 0.5); // -6 dBFS peak
  const y = run([{ type: 'compressor', params: { threshold: -20, ratio: 4, makeup: 0, autoMakeup: false, attack: 1, release: 50 } }], x).l;
  const red = db(rms(x, 30000)) - db(rms(y, 30000));
  assert.ok(Math.abs(red - 10.5) < 1.0, `reduction ${red}`); // 14 dB over -> 14*(1-1/4) = 10.5 dB
});

test('compressor auto-makeup matches the desktop rule (70% of the static reduction at 0 dB)', () => {
  const c = createFx('compressor', SR, { threshold: -20, ratio: 4 });
  assert.ok(Math.abs(c.makeupDb - 10.5) < 1e-9);
  assert.equal(createFx('compressor', SR, { threshold: -20, ratio: 4, makeup: 3 }).makeupDb, 3);
});

test('limiter: never exceeds the ceiling, delays by `latency` samples', () => {
  const N = SR; const L = new Float32Array(N), R = new Float32Array(N);
  let s = 1; for (let i = 0; i < N; i++) { s = (s * 16807) % 2147483647; L[i] = (s / 2147483647 - 0.5) * 4; R[i] = L[i] * 0.7; }
  const lim = new Limiter(SR, { threshold: -3, release: 80 }); const l = L.slice(), r = R.slice();
  for (let i = 0; i < N; i += 100) lim.process(l.subarray(i, i + 100), r.subarray(i, i + 100), Math.min(100, N - i));
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
  assert.ok(pk <= Math.pow(10, -3 / 20) + 1e-6, `peak ${pk}`);
  const imp = new Float32Array(2000); imp[500] = 0.1; const z = new Float32Array(2000);
  const l2 = new Limiter(SR, { threshold: -3 }); l2.process(imp, z, 2000);
  assert.ok(Math.abs(imp[500 + l2.latency] - 0.1) < 1e-6);
});

test('pitch shift +12 st doubles the frequency and keeps level; 0 st is a bypass with no latency', () => {
  const x = sine(440, SR * 2, 0.5);
  const { l, chain } = run([{ type: 'pitch', params: { semitones: 12 } }], x);
  const { f } = peakFreq(l, SR, 16384, 30000);
  assert.ok(Math.abs(f - 880) < 6, `peak ${f}`);
  assert.ok(Math.abs(db(rms(l, 30000, 90000)) - db(rms(x, 30000, 90000))) < 1.5);
  assert.ok(chain.latency > 1000);
  assert.equal(new Chain(SR, [{ type: 'pitch', params: { semitones: 0 } }]).latency, 0);
  const d = run([{ type: 'pitch', params: { semitones: -12 } }], x).l;
  assert.ok(Math.abs(peakFreq(d, SR, 16384, 30000).f - 220) < 4);
});

test('delay: echo arrives at `time`, feedback repeats decay', () => {
  const x = new Float32Array(SR); x[1000] = 1;
  const y = run([{ type: 'delay', params: { time: 100, feedback: 50, mix: 100 } }], x).l;
  const d = 4800;
  assert.ok(Math.abs(y[1000 + d] - 1) < 1e-6);
  assert.ok(Math.abs(y[1000 + 2 * d]) > 0.1 && Math.abs(y[1000 + 2 * d]) < 0.5);
});

test('reverb adds a decaying tail; width 0 collapses wet to mono', () => {
  const x = new Float32Array(SR * 2); x[100] = 1;
  const { l, r } = run([{ type: 'reverb', params: { room_size: 70, damping: 40, wet: 30, width: 100 } }], x);
  assert.ok(rms(l, 20000, 30000) > 1e-4);
  assert.ok(rms(l, 20000, 30000) > rms(l, 80000, 90000));
  const m = run([{ type: 'reverb', params: { room_size: 70, damping: 40, wet: 30, width: 0 } }], x);
  for (let i = 20000; i < 20100; i++) assert.ok(Math.abs(m.l[i] - m.r[i]) < 1e-7);
});

test('stereo width: 0% collapses highs to mono, bass below 120 Hz is always mono', () => {
  const L = sine(3000, SR), R = new Float32Array(SR); // hard-left: mid = side
  const m = run([{ type: 'stereo-width', params: { width: 0 } }], L, R);
  assert.ok(rms(m.l, 24000) > 0.15 && Math.abs(rms(m.l, 24000) - rms(m.r, 24000)) < 1e-4);
  assert.ok(Math.abs(m.l[30000] - m.r[30000]) < 1e-6);
  const w = run([{ type: 'stereo-width', params: { width: 200 } }], L, R);
  assert.ok(rms(w.l, 24000) > rms(m.l, 24000) * 1.5 && rms(w.r, 24000) > 0.1, 'wider than mono');
});

test('every effect type produces finite, non-silent audio and bypass is latency-aligned', () => {
  const x = sine(220, SR, 0.3); for (let i = 0; i < x.length; i += 6000) x[i] += 0.4; // some transients
  const defaults = { gate: { threshold: -50 }, dereverb: { threshold: -50 }, deesser: {}, compressor: {}, eq: { low: 4, high: 3 }, saturation: {}, reverb: {}, delay: {}, chorus: {}, loudness: { gain: 3 }, 'stereo-width': { width: 130 }, filter: { hp: 100 }, phaser: {}, pitch: { semitones: 3 }, peq: { type: 'peak', gain: 3 }, gain: { gain: 2 }, limiter: {}, drive: {}, bitcrush: { bits: 8 } };
  for (const type of Object.keys(FX_TYPES)) {
    const { l, r } = run([{ type, params: defaults[type] || {} }], x);
    for (let i = 0; i < l.length; i++) if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) assert.fail(`${type} produced NaN at ${i}`);
    assert.ok(rms(l, 20000) > 1e-3, `${type} silent`);
  }
  // bypass: dry path equals input delayed by the chain latency
  const c = new Chain(SR, [{ type: 'pitch', params: { semitones: 5 } }, { type: 'compressor', params: { threshold: -30 } }]);
  c.setBypass(true); c.bypassMix = 1;
  const l = x.slice(0, 20000), r = x.slice(0, 20000);
  for (let i = 0; i < l.length; i += 128) c.process(l.subarray(i, i + 128), r.subarray(i, i + 128), Math.min(128, l.length - i));
  const lat = c.latency;
  assert.ok(lat > 0);
  for (let i = lat + 200; i < 19000; i += 997) assert.ok(Math.abs(l[i] - x[i - lat]) < 1e-6);
});

test('comp delay aligns two chains of different latency', () => {
  const x = new Float32Array(20000); x[3000] = 0.5;
  const a = new Chain(SR, [{ type: 'limiter', params: { threshold: -1 } }]);
  const b = new Chain(SR, [], { comp: a.latency });
  const la = x.slice(), ra = x.slice(), lb = x.slice(), rb = x.slice();
  for (let i = 0; i < x.length; i += 100) { a.process(la.subarray(i, i + 100), ra.subarray(i, i + 100), 100); b.process(lb.subarray(i, i + 100), rb.subarray(i, i + 100), 100); }
  assert.equal(la.indexOf(Math.max(...la)), lb.indexOf(Math.max(...lb)));
});
