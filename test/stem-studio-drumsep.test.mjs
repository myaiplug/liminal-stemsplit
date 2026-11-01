import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareWindow, decodeWindow, windowStarts, separateLong, NBINS } from '../public/stem-studio/drums/hdemucs.js';

const fx = (n) => { const b = fs.readFileSync(new URL(`./fixtures/drumsep/${n}.f32`, import.meta.url)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const snr = (a, b) => { let n = 0, d = 0; for (let i = 0; i < a.length; i++) { n += b[i] * b[i]; d += (a[i] - b[i]) ** 2; } return 10 * Math.log10(n / (d + 1e-30)); };
const W = 5000;

test('JS STFT matches torch (HDemucs _spec: nfft 4096, hop 1024, normalized, reflect, [2:2+le])', () => {
  const x = fx('x'), p = prepareWindow(x.subarray(0, W), x.subarray(W), 0, W);
  assert.equal(p.le, 5);
  assert.ok(snr(p.mag, fx('mag')) > 100, 'mag snr ' + snr(p.mag, fx('mag')));
});
test('JS iSTFT + time branch matches torch (HDemucs _ispec)', () => {
  const y = fx('y'), out = decodeWindow(fx('mag'), fx('time'), 1, W);
  assert.ok(snr(out[0][0], y.subarray(0, W)) > 100); assert.ok(snr(out[0][1], y.subarray(W)) > 100);
});
test('window plan covers the track, last window flush with the end', () => {
  assert.deepEqual(windowStarts(100, 441, 0.5), [0]);
  const s = windowStarts(1000, 400, 0.5); assert.equal(s[0], 0); assert.equal(s.at(-1), 600); assert.ok(s.every((a, i) => i === 0 || a > s[i - 1]));
  for (let N = 401; N < 3000; N += 137) { const st = windowStarts(N, 400, 0.5); assert.equal(st.at(-1) + 400, N); for (let i = 1; i < st.length; i++) assert.ok(st[i] - st[i - 1] <= 400); }
});
test('overlap-add over many windows reproduces a stem exactly (mock model: stem k = mix/(k+2))', async () => {
  const N = 23456, L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = Math.sin(i * 0.013) * 0.5; R[i] = Math.cos(i * 0.007) * 0.4; }
  let calls = 0;
  const run = async (mix, mag, le) => {
    calls++; assert.equal(mag.length, 4 * NBINS * le);
    const S = 3, time = new Float32Array(S * 2 * W); for (let s = 0; s < S; s++) for (let i = 0; i < 2 * W; i++) time[s * 2 * W + i] = mix[i] / (s + 2);
    return { freq: new Float32Array(S * 4 * NBINS * le), time };
  };
  const prog = []; const out = await separateLong({ L, R, run, W, S: 3, overlap: 0.5, onProgress: (f) => prog.push(f) });
  assert.ok(calls >= 5); assert.equal(prog.at(-1), 1);
  for (let s = 0; s < 3; s++) { assert.equal(out[s][0].length, N); assert.ok(snr(out[s][0], L.map((v) => v / (s + 2))) > 120); assert.ok(snr(out[s][1], R.map((v) => v / (s + 2))) > 120); }
});
test('cancellation throws CancelledError', async () => {
  const L = new Float32Array(20000), R = L.slice();
  await assert.rejects(separateLong({ L, R, W, run: async () => { throw new Error('should not run'); }, isCancelled: () => true }), { name: 'CancelledError' });
});
