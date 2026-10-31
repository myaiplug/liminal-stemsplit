// Model-free unit tests for roformer-web (DSP, chunking, WAV, model config).
// Run: node --test <this file>
import test from 'node:test';
import assert from 'node:assert/strict';
import { stftFrames, istftFrames, numFrames } from '../public/roformer-web/dsp.js';
import { planChunks, separateTrack } from '../public/roformer-web/separator.js';
import { encodeWav, wavHeader, wavPieces, wavBlob, zipBlob, parseWav } from '../public/roformer-web/wav.js';
import { MemorySink } from '../public/roformer-web/sinks.js';
import * as fflate from '../public/roformer-web/vendor/fflate/fflate.mjs';
import { MODELS, MODEL_ORDER } from '../public/roformer-web/models.js';

function noise(n, seed = 1) {
  let s = seed; const a = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = (s / 2 ** 32 - 0.5) * 0.8; }
  return a;
}

test('STFT -> iSTFT reconstructs the signal', () => {
  const N = 20000, nFft = 2048, hop = 512, T = numFrames(N, hop), F = nFft / 2 + 1;
  const l = noise(N, 1), r = noise(N, 2);
  const store = [];
  stftFrames(l, r, nFft, hop, (t, a, b, c, d) => store.push([a.slice(), b.slice(), c.slice(), d.slice()]));
  assert.equal(store.length, T);
  const oL = new Float32Array(N), oR = new Float32Array(N);
  istftFrames((t, a, b, c, d) => { const f = store[t]; a.set(f[0]); b.set(f[1]); c.set(f[2]); d.set(f[3]); }, nFft, hop, T, N, oL, oR);
  let err = 0;
  for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(oL[i] - l[i]), Math.abs(oR[i] - r[i]));
  assert.ok(err < 1e-4, `max error ${err}`);
  assert.equal(F, store[0][0].length);
});

test('planChunks covers the whole track with an end-aligned last chunk', () => {
  for (const [n, c, o] of [[100, 40, 10], [617400, 176400, 44100], [50, 100, 10], [100, 100, 10]]) {
    const s = planChunks(n, c, o);
    assert.equal(s[0], 0);
    assert.ok(s.at(-1) + c >= n || n < c);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1] && s[i] - s[i - 1] <= c - o);
  }
});

test('separateTrack overlap-add with an identity adapter returns the input', async () => {
  const N = 5000, C = 1200;
  const l = noise(N, 3), r = noise(N, 4);
  const adapter = {
    chunkSamples: C,
    prepare: (a, b) => ({ feeds: {}, ctx: { a, b } }),
    finish: (_o, ctx) => ({ all: [ctx.a, ctx.b] }),
  };
  const { stems, chunks } = await separateTrack({ adapter, run: async () => ({}), left: l, right: r, overlap: 0.25 });
  assert.ok(chunks > 3);
  let err = 0;
  for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(stems.all[0][i] - l[i]), Math.abs(stems.all[1][i] - r[i]));
  assert.ok(err < 1e-5, `max error ${err}`);
});

test('encodeWav writes valid RIFF headers for each format', () => {
  const ch = [noise(100, 1), noise(100, 2)];
  for (const [fmt, bytes, tag] of [['pcm16', 2, 1], ['pcm24', 3, 1], ['float32', 4, 3]]) {
    const u8 = new Uint8Array(encodeWav(ch, 44100, fmt) instanceof ArrayBuffer ? encodeWav(ch, 44100, fmt) : encodeWav(ch, 44100, fmt).buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    assert.equal(String.fromCharCode(...u8.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...u8.slice(8, 12)), 'WAVE');
    assert.equal(dv.getUint16(20, true), tag);
    assert.equal(dv.getUint16(22, true), 2);
    assert.equal(dv.getUint32(24, true), 44100);
    assert.equal(u8.length, 44 + 100 * 2 * bytes);
  }
});

test('model config is complete and pinned', () => {
  assert.deepEqual(MODEL_ORDER.slice().sort(), ['bs6', 'duality', 'mini']);
  for (const id of MODEL_ORDER) {
    const m = MODELS[id];
    assert.ok(m.label && m.description && m.stems.length >= 2 && m.license.spdx);
    assert.equal(m.sizeBytes, m.files.reduce((a, f) => a + f.bytes, 0));
    for (const f of m.files) {
      assert.match(f.url, /^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//, `${id}: URL must pin a commit`);
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

function fakeSink(N) { const m = new MemorySink(N); return m; }

test('streaming separation is identical for different sinks and chunk plans (stem = input)', async () => {
  const N = 7777, C = 1500;
  const l = noise(N, 5), r = noise(N, 6);
  const adapter = { chunkSamples: C, prepare: (a, b) => ({ feeds: {}, ctx: { a, b } }), finish: (_o, ctx) => ({ a: [ctx.a, ctx.b], b: [ctx.a.map((x) => -x), ctx.b.map((x) => -x)] }) };
  const sink = fakeSink(N);
  const res = await separateTrack({ adapter, run: async () => ({}), left: l, right: r, overlap: 0.5, sink });
  assert.equal(res.sink, sink);
  assert.deepEqual(sink.names().sort(), ['a', 'b']);
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(sink.data.a[0][i] - l[i]) < 1e-5 && Math.abs(sink.data.b[1][i] + r[i]) < 1e-5, `sample ${i}`);
  }
});

test('wavPieces/wavBlob stream a valid WAV that parseWav reads back', async () => {
  const N = 3000, l = noise(N, 7), r = noise(N, 8);
  const sink = new MemorySink(N); sink.write('x', 0, 0, l); sink.write('x', 1, 0, r);
  for (const [fmt, tol] of [['pcm16', 1e-3], ['pcm24', 1e-5], ['float32', 0]]) {
    const blob = wavBlob(sink, 'x', N, 48000, fmt);
    const buf = await blob.arrayBuffer();
    assert.equal(buf.byteLength, 44 + N * 2 * { pcm16: 2, pcm24: 3, float32: 4 }[fmt]);
    const w = parseWav(buf);
    assert.equal(w.sampleRate, 48000); assert.equal(w.channels.length, 2); assert.equal(w.channels[0].length, N);
    let e = 0; for (let i = 0; i < N; i++) e = Math.max(e, Math.abs(w.channels[0][i] - l[i]), Math.abs(w.channels[1][i] - r[i]));
    assert.ok(e <= tol + 1e-9, `${fmt} err ${e}`);
  }
  assert.equal(wavHeader(10, 2, 44100, 'pcm16').length, 44);
  assert.ok([...wavPieces(sink, 'x', N, 44100, 'pcm16')].length >= 2);
});

test('zipBlob produces a readable archive with one WAV per stem', async () => {
  const N = 2000, sink = new MemorySink(N);
  for (const n of ['vocals', 'drums']) { sink.write(n, 0, 0, noise(N, 9)); sink.write(n, 1, 0, noise(N, 10)); }
  const blob = zipBlob(fflate, sink, ['vocals', 'drums'], N, 44100, 'pcm16', 'My: Song?');
  const files = fflate.unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['My_ Song_ - drums.wav', 'My_ Song_ - vocals.wav']);
  for (const f of Object.values(files)) assert.equal(f.length, 44 + N * 4);
});
