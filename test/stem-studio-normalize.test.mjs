import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToTarget } from '../public/stem-studio/normalize.js';
import { measureLoudness } from '../public/stem-studio/dsp/loudness.js';

const sr = 44100;
function mk(amp, crest) { const n = sr * 12, L = new Float32Array(n), R = new Float32Array(n); let s = 5;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const nz = s / 2147483647 - 0.5; const t = i / sr; const hit = (t % 0.5) < 0.01 ? crest : 0;
    L[i] = amp * (Math.sin(2 * Math.PI * 200 * t) * 0.6 + nz * 0.4 + hit); R[i] = amp * (Math.sin(2 * Math.PI * 203 * t) * 0.6 + nz * 0.4 - hit); } return [L, R]; }

test('quiet material is brought to -14 LUFS within 0.1 LU, true peak under -1 dBTP', () => {
  const [L, R] = mk(0.05, 0); const r = normalizeToTarget(L, R, sr, { lufs: -14, tp: -1 });
  const m = measureLoudness(r.L, r.R, sr); assert.ok(Math.abs(m.integrated - -14) <= 0.1, `${m.integrated}`); assert.ok(m.truePeakDb <= -0.99, `${m.truePeakDb}`); assert.ok(r.reachedTarget);
});
test('peaky material at -9 LUFS engages the limiter and reports honestly', () => {
  const [L, R] = mk(0.12, 3); const r = normalizeToTarget(L, R, sr, { lufs: -9, tp: -0.3 });
  const m = measureLoudness(r.L, r.R, sr); assert.ok(r.limited, 'limiter engaged'); assert.ok(m.truePeakDb <= -0.29, `${m.truePeakDb}`);
  assert.ok(Math.abs(r.after.integrated - m.integrated) < 1e-9);
  assert.equal(r.reachedTarget, Math.abs(m.integrated - -9) <= 0.1 && m.truePeakDb <= -0.29);
  assert.ok(Math.abs(m.integrated - -9) < 1.5, `got ${m.integrated}`);
});
test('silence is returned untouched', () => { const z = new Float32Array(sr * 5); const r = normalizeToTarget(z, z, sr, { lufs: -14 }); assert.equal(r.gainDb, 0); assert.equal(r.L, z); });
