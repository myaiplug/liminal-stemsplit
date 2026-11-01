import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, editedLength, normalizeEdits, mapTime } from '../public/stem-studio/edits.js';

const sr = 44100, N = sr * 10;
const ramp = () => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = 0.5; return [a, a.slice()]; };

test('no edits returns the same arrays', () => { const c = ramp(); assert.equal(applyEdits(c, sr, null), c); assert.equal(applyEdits(c, sr, { trim: { start: 0, end: 10 }, ops: [] }), c); });
test('trim gives exact sample length', () => {
  const c = ramp(); const o = applyEdits(c, sr, { trim: { start: 2, end: 7.5 } });
  assert.equal(o[0].length, Math.round(5.5 * sr)); assert.equal(editedLength(N, sr, { trim: { start: 2, end: 7.5 } }), o[0].length);
});
test('cut removes the region and closes the gap (length exact), fades the join', () => {
  const o = applyEdits(ramp(), sr, { ops: [{ type: 'cut', start: 3, end: 4 }] });
  assert.equal(o[0].length, N - sr);
  const j = 3 * sr; assert.ok(o[0][j - 1] < 0.01 && o[0][j] < 0.01, 'join faded to ~0'); assert.equal(o[0][j - 1000], 0.5); assert.equal(o[0][j + 1000], 0.5);
});
test('silence keeps length and mutes region', () => {
  const o = applyEdits(ramp(), sr, { ops: [{ type: 'silence', start: 1, end: 2 }] });
  assert.equal(o[0].length, N); assert.equal(o[0][sr + 5000], 0); assert.equal(o[0][sr * 2 + 5000], 0.5); assert.equal(o[0][sr - 5000], 0.5);
});
test('trim + cut + silence combined', () => {
  const e = { trim: { start: 1, end: 9 }, ops: [{ type: 'cut', start: 2, end: 3 }, { type: 'silence', start: 5, end: 6 }] };
  const o = applyEdits(ramp(), sr, e); assert.equal(o[0].length, 7 * sr);
  assert.equal(mapTime(2.5, sr, N, e), null); assert.ok(Math.abs(mapTime(4, sr, N, e) - 2) < 1e-6);
});
test('normalize clamps and drops empty ops', () => {
  const n = normalizeEdits({ trim: { start: -3, end: 99 }, ops: [{ type: 'cut', start: 5, end: 5 }, { type: 'x', start: 8, end: 12 }] }, 10);
  assert.equal(n.trim, null); assert.equal(n.ops.length, 1); assert.equal(n.ops[0].type, 'silence'); assert.equal(n.ops[0].end, 10);
});
