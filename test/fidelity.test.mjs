// Model-free tests for stem fidelity: residual "other" stem and the null-test readout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { residualInto, NullMeter, describeNull } from '../public/roformer-web/fidelity.js';
import { bs6Adapter, miniAdapter } from '../public/roformer-web/adapters.js';
import { separateTrack } from '../public/roformer-web/separator.js';

function noise(n, seed = 1, amp = 0.8) {
  let s = seed; const a = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = (s / 2 ** 32 - 0.5) * amp; }
  return a;
}

test('residualInto makes the catch-all stem equal mix minus the others', () => {
  const n = 500, L = noise(n, 1), R = noise(n, 2);
  const stems = { vocals: [noise(n, 3, 0.2), noise(n, 4, 0.2)], other: [noise(n, 5), noise(n, 6)] };
  residualInto(stems, L, R, 'other');
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(stems.vocals[0][i] + stems.other[0][i] - L[i]) < 1e-6);
    assert.ok(Math.abs(stems.vocals[1][i] + stems.other[1][i] - R[i]) < 1e-6);
  }
});

test('residualInto leaves stems alone when the target does not exist', () => {
  const stems = { a: [new Float32Array([1]), new Float32Array([1])] };
  residualInto(stems, new Float32Array([5]), new Float32Array([5]), 'other');
  assert.equal(stems.a[0][0], 1);
});

test('NullMeter: perfect sum is far below -100 dB, a missing stem is near 0 dB', () => {
  const n = 2000, L = noise(n, 1), R = noise(n, 2);
  const half = (x) => x.map((v) => v / 2);
  const m = new NullMeter();
  m.add(L, R, [[half(L), half(R)], [half(L), half(R)]]);
  assert.ok(m.db < -100, `db ${m.db}`);
  const m2 = new NullMeter();
  m2.add(L, R, [[half(L), half(R)]]); // half the signal missing -> error is -6 dB of the mix
  assert.ok(Math.abs(m2.db - -6.02) < 0.05, `db ${m2.db}`);
  assert.equal(new NullMeter().db, null);
});

test('describeNull words', () => {
  assert.equal(describeNull(null), '');
  assert.match(describeNull(-80), /add back/);
  assert.match(describeNull(-40), /close/);
  assert.match(describeNull(-20), /missing/);
});

test('bs6 adapter: "other" is the residual, so six stems add back to the input (even if the network drops everything)', () => {
  const C = bs6Adapter.chunkSamples, l = noise(C, 7), r = noise(C, 8);
  const { feeds, ctx } = bs6Adapter.prepare(l.slice(), r.slice());
  const len = feeds.spec_real.data.length;
  // A broken network that outputs silence for every stem.
  const out = { out_spec_real: new Float32Array(6 * len), out_spec_imag: new Float32Array(6 * len) };
  const stems = bs6Adapter.finish(out, ctx);
  assert.deepEqual(Object.keys(stems).sort(), ['bass', 'drums', 'guitar', 'other', 'piano', 'vocals']);
  const m = new NullMeter();
  m.add(l, r, Object.values(stems));
  assert.ok(m.db < -100, `db ${m.db}`);
  assert.ok(Math.abs(stems.other[0][1000] - l[1000]) < 1e-6);
});

test('mini adapter: "other" is the residual', () => {
  const C = miniAdapter.chunkSamples, l = noise(C, 9), r = noise(C, 10);
  const { ctx } = miniAdapter.prepare(l.slice(), r.slice());
  const mask = new Float32Array(4 * ctx.T * ctx.Fk * 4); // all-zero masks
  const stems = miniAdapter.finish({ mask }, ctx);
  const m = new NullMeter();
  m.add(l, r, Object.values(stems));
  assert.ok(m.db < -100, `db ${m.db}`);
});

test('separateTrack reports nullDb across overlapping chunks', async () => {
  const N = 5000, C = 1200, L = noise(N, 3), R = noise(N, 4);
  const exact = { chunkSamples: C, prepare: (a, b) => ({ feeds: {}, ctx: { a, b } }), finish: (_o, c) => ({ x: [c.a.map((v) => v * 0.5), c.b.map((v) => v * 0.5)], y: [c.a.map((v) => v * 0.5), c.b.map((v) => v * 0.5)] }) };
  const r1 = await separateTrack({ adapter: exact, run: async () => ({}), left: L, right: R, overlap: 0.25 });
  assert.ok(r1.nullDb < -100, `exact ${r1.nullDb}`);
  const lossy = { ...exact, finish: (_o, c) => ({ x: [c.a.map((v) => v * 0.5), c.b.map((v) => v * 0.5)] }) };
  const r2 = await separateTrack({ adapter: lossy, run: async () => ({}), left: L, right: R, overlap: 0.25 });
  assert.ok(Math.abs(r2.nullDb - -6.02) < 0.1, `lossy ${r2.nullDb}`);
});

test('every roformer-web module is in the offline precache list', () => {
  const sw = fs.readFileSync(new URL('../public/browser-split-sw.js', import.meta.url), 'utf8');
  const dir = new URL('../public/roformer-web/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.ok(sw.includes(`'roformer-web/${f}'`), `${f} missing from SHELL in browser-split-sw.js`);
  }
});
