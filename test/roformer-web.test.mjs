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

// ---- progress experience (round 3)
import { TapSink, PEAK_BLOCK } from '../public/roformer-web/sinks.js';
import { overallFraction, stageWeights, computePeaks, fmtClock, fmtEta } from '../public/roformer-web/progress.js';
import { TIPS } from '../public/roformer-web/tips.js';

test('overall progress is monotonic across stages and reaches 1', () => {
  for (const dl of [true, false]) {
    const w = stageWeights(dl);
    assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    let last = -1;
    for (const [stage, f] of [['decode', 0], ['decode', 1], ['download', 0], ['download', 0.5], ['download', 1], ['load', 0.3], ['separate', 0], ['separate', 0.5], ['separate', 1], ['done', 1]]) {
      const v = overallFraction(stage, f, dl);
      assert.ok(v >= last - 1e-9, `${stage} ${f} ${v} < ${last}`);
      last = v;
    }
    assert.equal(overallFraction('done', 1, dl), 1);
  }
  assert.equal(overallFraction('download', 0.5, false), overallFraction('decode', 1, false));
});

test('formatting helpers and peaks', () => {
  assert.equal(fmtClock(75), '1:15'); assert.equal(fmtEta(125000), '2m 05s'); assert.equal(fmtEta(9000), '9s');
  const l = new Float32Array(1000), r = new Float32Array(1000); l[10] = 0.5; r[990] = -0.9;
  const p = computePeaks(l, r, 10);
  assert.equal(p.length, 10); assert.ok(p[0] >= 0.49 && p[9] >= 0.89 && p[5] === 0);
});

test('tips: >= 20 original, unique ids, links only reference known keys', () => {
  assert.ok(TIPS.length >= 20);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
  for (const t of TIPS) assert.ok(t.text.length > 30 && t.text.length < 260);
  assert.deepEqual([...new Set(TIPS.filter((t) => t.link).map((t) => t.link))].sort(), ['breaths', 'clean', 'panlaw', 'tune808']);
});

test('TapSink passes data through and reports peaks + half-rate mono preview', async () => {
  const N = 44100 * 3 + 7; const inner = new MemorySink(N); const msgs = [];
  const tap = new TapSink(inner, (m) => msgs.push(m), { sampleRate: 44100, previewSeconds: 2 });
  const seg = [[0, 50001], [50001, 44100 * 3 + 7 - 50001]];
  for (const [off, len] of seg) {
    const l = new Float32Array(len).fill(0.4), r = new Float32Array(len).fill(0.2);
    await tap.write('v', 0, off, l); await tap.write('v', 1, off, r);
  }
  assert.deepEqual(tap.names(), ['v']); assert.ok(Math.abs(tap.read('v', 0, 100, 3)[0] - 0.4) < 1e-6);
  assert.equal(msgs.length, 2);                      // one message per region (after the 2nd channel)
  assert.ok(msgs[0].peaks.length >= 1 && Math.abs(msgs[0].peaks[0] - 0.4) < 1e-6);
  const cover = new Float32Array(Math.floor(44100 / 2 * 2));
  for (const m of msgs) if (m.preview) cover.set(m.preview.subarray(0, Math.max(0, Math.min(m.preview.length, cover.length - m.previewStart))), m.previewStart);
  for (const i of [0, 1, 25000, 25001, cover.length - 1]) assert.ok(Math.abs(cover[i] - 0.3) < 1e-5, `sample ${i} = ${cover[i]}`); // (0.4+0.2)/2, including across the odd region boundary
  assert.equal(msgs[1].previewStart === undefined || msgs[1].previewStart < cover.length, true);
  assert.equal(Math.ceil(N / PEAK_BLOCK), tap.blocks);
});
