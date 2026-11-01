import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoudnessMeter, measureLoudness, kWeightCoefs } from '../public/stem-studio/dsp/loudness.js';
import { encodeWav, parseWav } from '../public/roformer-web/wav.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

function music(sr, sec) { // sections of varying loudness, tonal + noisy, stereo, with a few hot peaks
  const n = Math.round(sr * sec), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, sect = Math.floor(t / 4), amp = [0.5, 0.05, 0.25, 0.01, 0.4, 0.12, 0.3, 0.03][sect % 8];
    const tone = Math.sin(2 * Math.PI * 110 * t) + 0.5 * Math.sin(2 * Math.PI * 1760 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 7000 * t);
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t);
    L[i] = amp * (0.5 * tone * env + 0.6 * rnd());
    R[i] = amp * (0.45 * tone * env + 0.6 * rnd());
  }
  L[Math.floor(n / 3)] += 0.5; R[Math.floor(n / 3) + 1] -= 0.5; // short peaks (intersample overs)
  return [L, R];
}
function ffmpegEbu(file) {
  const r = spawnSync('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const t = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => parseFloat(t.match(re)[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

test('K-weighting coefficients equal the BS.1770 reference values at 48 kHz', () => {
  const [s, r] = kWeightCoefs(48000);
  const ref = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
  [s, r].forEach((c, k) => c.forEach((v, i) => assert.ok(Math.abs(v - ref[k][i]) < 1e-9, `${k}/${i}`)));
});

test('1 kHz sine at -20 dBFS (stereo) reads -20 LUFS... -0.691 K-weighting offset', () => {
  const sr = 48000, n = sr * 6, a = Math.pow(10, -20 / 20), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = a * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const r = measureLoudness(L, L, sr);
  // EBU Tech 3341: stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS (peak-level sine on both channels => 3.01 dB sum - 3.01 dB RMS)
  assert.ok(Math.abs(r.integrated - -20) < 0.05, `I=${r.integrated}`);
  assert.ok(Math.abs(r.truePeakDb - -20) < 0.1, `TP=${r.truePeakDb}`);
  assert.ok(r.lra < 0.05);
});

test('true peak finds inter-sample overs a sample-peak meter misses (fs/4 sine at 45 degrees)', () => {
  const sr = 44100, n = sr * 3, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * (sr / 4) * i / sr + Math.PI / 4);
  const r = measureLoudness(L, L, sr);
  assert.ok(Math.abs(r.samplePeakDb - -3.01) < 0.02, `sample ${r.samplePeakDb}`);
  assert.ok(Math.abs(r.truePeakDb - 0) < 0.1, `true ${r.truePeakDb}`);
});

test('silence is -Infinity LUFS and does not throw', () => {
  const z = new Float32Array(48000 * 5); const r = measureLoudness(z, z, 48000);
  assert.equal(r.integrated, -Infinity); assert.equal(r.lra, 0);
});

test('streaming in odd block sizes equals one-shot', () => {
  const [L, R] = music(44100, 20); const a = measureLoudness(L, R, 44100);
  const m = new LoudnessMeter(44100); for (let i = 0; i < L.length; i += 997) { const n = Math.min(997, L.length - i); m.push(L.subarray(i, i + n), R.subarray(i, i + n), n); }
  const b = m.result(); assert.ok(Math.abs(a.integrated - b.integrated) < 1e-9 && Math.abs(a.truePeakDb - b.truePeakDb) < 1e-9 && Math.abs(a.lra - b.lra) < 1e-9);
});

test('gating: quiet passages below -10 LU relative gate do not drag integrated loudness down', () => {
  const sr = 48000, loud = new Float32Array(sr * 10), quiet = new Float32Array(sr * 10);
  for (let i = 0; i < loud.length; i++) { loud[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / sr); quiet[i] = 0.002 * Math.sin(2 * Math.PI * 440 * i / sr); }
  const both = new Float32Array(sr * 20); both.set(loud); both.set(quiet, sr * 10);
  const a = measureLoudness(loud, loud, sr).integrated, b = measureLoudness(both, both, sr).integrated;
  assert.ok(Math.abs(a - b) < 0.15, `${a} vs ${b}`);
});

test('matches ffmpeg ebur128 (I, LRA, true peak) within 0.1 LU / 0.1 dB at 44.1, 48 and 96 kHz', { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'loud-'));
  for (const sr of [44100, 48000, 96000]) {
    const [L, R] = music(sr, 36); const f = join(dir, `m${sr}.wav`);
    writeFileSync(f, new Uint8Array(encodeWav([L, R], sr, 'float32')));
    const ref = ffmpegEbu(f), mine = measureLoudness(L, R, sr);
    assert.ok(Math.abs(mine.integrated - ref.I) <= 0.1, `${sr} I mine=${mine.integrated.toFixed(3)} ffmpeg=${ref.I}`);
    assert.ok(Math.abs(mine.lra - ref.LRA) <= 0.15, `${sr} LRA mine=${mine.lra.toFixed(3)} ffmpeg=${ref.LRA}`);
    assert.ok(Math.abs(mine.truePeakDb - ref.TP) <= 0.1, `${sr} TP mine=${mine.truePeakDb.toFixed(3)} ffmpeg=${ref.TP}`);
  }
});

test('matches ffmpeg on the real clip fixture (when present)', { skip: !hasFfmpeg || !existsSync('/workspace/studio-fixtures/clip20.wav') }, () => {
  const f = '/workspace/studio-fixtures/clip20.wav'; const w = parseWav(readFileSync(f).buffer.slice(0));
  const ref = ffmpegEbu(f), mine = measureLoudness(w.channels[0], w.channels[1] || w.channels[0], w.sampleRate);
  assert.ok(Math.abs(mine.integrated - ref.I) <= 0.1, `I ${mine.integrated} vs ${ref.I}`);
  assert.ok(Math.abs(mine.truePeakDb - ref.TP) <= 0.1, `TP ${mine.truePeakDb} vs ${ref.TP}`);
});
