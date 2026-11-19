import test from 'node:test';
import assert from 'node:assert/strict';
import { htrStarts, htrWeight, packSpec, decodeStems, separateHtr, HTR_CHUNK, HTR_BINS, HTR_FRAMES, HTR_STEMS } from '../public/stem-studio/drums/htr.js';
import { karaStarts, karaChunk, packFeatures, decodeLead, separateLeadBacking, KARA_FEAT } from '../public/stem-studio/vocals/karaoke.js';
import { buildParts } from '../public/stem-studio/drums/pipeline.js';
import { drumModelHtr, DRUM_HTR_DEFAULT_URL } from '../public/stem-studio/drums/drum-models.js';
import { karaokeModel, KARAOKE_HF_COMMIT } from '../public/stem-studio/vocals/karaoke-models.js';

const snr = (a, b) => { let n = 0, d = 0; for (let i = 0; i < a.length; i++) { n += b[i] * b[i]; d += (a[i] - b[i]) ** 2; } return 10 * Math.log10(n / (d + 1e-30)); };
const sig = (N, f1 = 0.013, f2 = 0.007) => { const L = new Float32Array(N), R = new Float32Array(N); for (let i = 0; i < N; i++) { L[i] = Math.sin(i * f1) * 0.5; R[i] = Math.cos(i * f2) * 0.4; } return [L, R]; };

test('HT-RoFormer geometry matches the model card (chunk multiple of 1024, 261 frames, 6 stems)', () => {
  assert.equal(HTR_CHUNK % 1024, 0); assert.equal(HTR_FRAMES, 261); assert.equal(HTR_STEMS.length, 6);
  assert.deepEqual(htrStarts(100), [0]);
  const s = htrStarts(HTR_CHUNK * 3); assert.equal(s[0], 0); assert.equal(s.at(-1), HTR_CHUNK * 2); assert.ok(s.every((a, i) => !i || a - s[i - 1] <= HTR_CHUNK / 2));
  const w = htrWeight(0, HTR_CHUNK * 3); assert.equal(w[0], 1); assert.equal(w.at(-1), 0);
});

test('HT-RoFormer host STFT -> unit mask on stem 0 -> iSTFT reproduces the window; other stems silent', () => {
  const [L, R] = sig(HTR_CHUNK), spec = packSpec(L, R);
  assert.equal(spec.length, 2 * HTR_BINS * HTR_FRAMES * 2);
  const S = 6, mask = new Float32Array(S * 2 * HTR_BINS * HTR_FRAMES * 2), residual = new Float32Array(S * 2 * HTR_CHUNK);
  for (let b = 0; b < 2 * HTR_BINS; b++) for (let t = 0; t < HTR_FRAMES; t++) mask[(b * HTR_FRAMES + t) * 2] = 1; // stem 0, real 1
  const out = decodeStems(spec, mask, residual);
  assert.ok(snr(out[0][0], L) > 100, 'L ' + snr(out[0][0], L)); assert.ok(snr(out[0][1], R) > 100);
  assert.ok(out[1][0].every((v) => v === 0));
});

test('HT-RoFormer mask bin packing is 2*f + channel (mask only on channel 1 leaves L silent)', () => {
  const [L, R] = sig(HTR_CHUNK), spec = packSpec(L, R);
  const mask = new Float32Array(6 * 2 * HTR_BINS * HTR_FRAMES * 2), residual = new Float32Array(6 * 2 * HTR_CHUNK);
  for (let f = 0; f < HTR_BINS; f++) for (let t = 0; t < HTR_FRAMES; t++) mask[((2 * f + 1) * HTR_FRAMES + t) * 2] = 1;
  const out = decodeStems(spec, mask, residual);
  assert.ok(out[0][0].reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 1e-6); assert.ok(snr(out[0][1], R) > 100);
});

test('HT-RoFormer overlap-add with a residual-only mock model reproduces stems exactly', async () => {
  const N = HTR_CHUNK * 2 + 12345, [L, R] = sig(N); let calls = 0;
  const run = async (audio) => { calls++; const residual = new Float32Array(6 * 2 * HTR_CHUNK); for (let s = 0; s < 6; s++) for (let c = 0; c < 2; c++) for (let i = 0; i < HTR_CHUNK; i++) residual[(s * 2 + c) * HTR_CHUNK + i] = audio[c * HTR_CHUNK + i] / (s + 2); return { mask: new Float32Array(6 * 2 * HTR_BINS * HTR_FRAMES * 2), residual }; };
  const prog = []; const out = await separateHtr({ L, R, run, onProgress: (f) => prog.push(f) });
  assert.equal(calls, htrStarts(N).length); assert.equal(prog.at(-1), 1);
  for (let s = 0; s < 6; s++) { assert.equal(out[s][0].length, N); assert.ok(snr(out[s][0], L.map((v) => v / (s + 2))) > 100); assert.ok(snr(out[s][1], R.map((v) => v / (s + 2))) > 100); }
});

test('buildParts with HT-RoFormer output: model hats + percussion, children sum to the drums', () => {
  const N = 4000, sr = 44100, mk = (k) => { const a = new Float32Array(N), b = new Float32Array(N); for (let i = 0; i < N; i++) { a[i] = Math.sin(i * 0.01 * (k + 1)) * 0.1; b[i] = Math.cos(i * 0.02 * (k + 1)) * 0.1; } return [a, b]; };
  const ml = { kick: mk(0), snare: mk(1), hihat: mk(2), toms: mk(3), cymbals: mk(4), other: mk(5) };
  const drums = [new Float32Array(N), new Float32Array(N)];
  for (const v of Object.values(ml)) for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) drums[c][i] += v[c][i];
  for (let i = 0; i < N; i++) drums[0][i] += 0.001; // leftover the model did not claim
  const { parts } = buildParts({ drums, ml, sr, sub808: false });
  const keys = parts.map((p) => p.key);
  for (const k of ['kick', 'snare', 'hats', 'toms', 'cymbals', 'perc', 'remainder']) assert.ok(keys.includes(k), k);
  assert.equal(parts.find((p) => p.key === 'hats').audio, ml.hihat);
  const sum = [new Float32Array(N), new Float32Array(N)];
  for (const p of parts.filter((x) => x.parent === 'drums')) for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) sum[c][i] += p.audio[c][i];
  assert.ok(snr(sum[0], drums[0]) > 100); assert.ok(snr(sum[1], drums[1]) > 100);
});

test('HT-RoFormer browser model is not hosted by default (no licence) and is flagged', () => {
  assert.equal(DRUM_HTR_DEFAULT_URL, null);
  const m = drumModelHtr(); assert.equal(m.configured, false); assert.equal(m.license.spdx, 'NONE'); assert.equal(m.files[0].sha256.length, 64);
});

test('karaoke feature packing: t*4100 + (2f+ch)*2 + ri, and a unit mask round-trips', () => {
  const chunk = karaChunk(101), [L, R] = sig(chunk), { feats, T } = packFeatures(L, R);
  assert.equal(T, 101); assert.equal(feats.length, T * KARA_FEAT);
  const mask = new Float32Array(2050 * T * 2); for (let b = 0; b < 2050; b++) for (let t = 0; t < T; t++) mask[(b * T + t) * 2] = 1;
  const [lL, lR] = decodeLead(feats, mask, T, chunk);
  assert.ok(snr(lL, L) > 100); assert.ok(snr(lR, R) > 100);
});

test('karaoke lead + backing always equals the input (half mask, several windows)', async () => {
  const N = karaChunk() * 2 + 777, [L, R] = sig(N);
  const run = async (feats, T) => { const m = new Float32Array(2050 * T * 2); for (let i = 0; i < m.length; i += 2) m[i] = 0.5; return m; };
  const { lead, backing } = await separateLeadBacking({ L, R, run });
  for (let c = 0; c < 2; c++) { const x = c ? R : L; let e = 0; for (let i = 0; i < N; i++) e = Math.max(e, Math.abs(lead[c][i] + backing[c][i] - x[i])); assert.ok(e < 1e-6, 'sum ' + e); assert.ok(snr(lead[c], x.map((v) => v * 0.5)) > 60); }
  assert.ok(karaStarts(N, karaChunk()).length >= 4);
});

test('karaoke model is pinned to an immutable HF commit with a SHA-256', () => {
  const m = karaokeModel(); assert.equal(KARAOKE_HF_COMMIT.length, 40); assert.ok(m.files[0].url.includes(`/resolve/${KARAOKE_HF_COMMIT}/`)); assert.equal(m.files[0].sha256.length, 64);
});
