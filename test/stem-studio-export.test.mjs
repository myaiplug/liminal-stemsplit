import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { encodeTaggedWav, buildId3, buildTags, zipFiles, BRAND_LIMINAL, safeName } from '../public/stem-studio/export.js';
import { parseWav } from '../public/roformer-web/wav.js';
import * as fflate from '../public/roformer-web/vendor/fflate/fflate.mjs';

const sr = 48000, n = 4800, L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) { L[i] = 0.5 * Math.sin(i / 20); R[i] = -0.25 * Math.sin(i / 11); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-exp-'));
const have = (c) => spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0 || spawnSync(c, ['--help'], { stdio: 'ignore' }).status === 0;

test('WAV: parses back at the same rate/length for every format; 24-bit and float are accurate', () => {
  for (const [fmt, tol] of [['pcm16', 1 / 32768], ['pcm24', 1 / 8388608], ['float32', 1e-9]]) {
    const w = encodeTaggedWav([L, R], sr, fmt, { title: 'T' });
    const p = parseWav(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength));
    assert.equal(p.sampleRate, sr); assert.equal(p.channels[0].length, n);
    let e = 0; for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(p.channels[0][i] - L[i]), Math.abs(p.channels[1][i] - R[i]));
    assert.ok(e <= tol * 0.51 + 1e-12, `${fmt} err ${e}`);
  }
});
test('WAV chunk layout is valid (even padding, sizes add up)', () => {
  const w = encodeTaggedWav([L], 44100, 'pcm24', { title: 'Odd', artist: 'Ä', comment: 'x' }); const dv = new DataView(w.buffer, w.byteOffset);
  assert.equal(dv.getUint32(4, true) + 8, w.length);
  let o = 12; const ids = []; while (o < w.length) { ids.push(String.fromCharCode(...w.subarray(o, o + 4))); const s = dv.getUint32(o + 4, true); o += 8 + s + (s & 1); }
  assert.equal(o, w.length); assert.deepEqual(ids.filter((i) => ['fmt ', 'data', 'LIST', 'iXML', 'id3 '].includes(i)), ['fmt ', 'data', 'LIST', 'iXML', 'id3 ']);
});
test('metadata is readable by ffprobe (INFO) and mutagen (ID3 + iXML present)', { skip: !have('ffprobe') }, () => {
  const f = path.join(tmp, 'a.wav'); fs.writeFileSync(f, encodeTaggedWav([L, R], sr, 'float32', { title: 'My Song', artist: 'Beez', stem: 'vocals' }));
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
  assert.equal(j.streams[0].sample_rate, String(sr)); assert.equal(j.streams[0].codec_name, 'pcm_f32le'); assert.equal(j.streams[0].channels, 2);
  const t = j.format.tags; assert.match(t.comment, /Made with NoDAW Liminal/); assert.equal(t.title, 'My Song'); assert.equal(t.artist, 'Beez'); assert.match(t.encoder, /Stem Studio/);
  assert.ok(Math.abs(parseFloat(j.format.duration) - n / sr) < 1e-6);
  const py = '/workspace/venv/bin/python';
  if (fs.existsSync(py)) {
    const out = execFileSync(py, ['-c', `import mutagen.wave as w,sys\nf=w.WAVE(sys.argv[1]);print(f.info.sample_rate,f.info.bits_per_sample);print(f.tags.getall('COMM')[0].text[0]);print(f.tags.getall('TXXX:MADE_WITH')[0].text[0]);print(f.tags.getall('WOAS')[0].url)\nd=open(sys.argv[1],'rb').read();print(b'<MADE_WITH>Made with NoDAW Liminal</MADE_WITH>' in d)`, f]).toString().trim().split('\n');
    assert.equal(out[0], `${sr} 32`); assert.match(out[1], /Made with NoDAW Liminal/); assert.equal(out[2], 'Made with NoDAW Liminal'); assert.equal(out[3], BRAND_LIMINAL.url); assert.equal(out[4], 'True');
  }
});
test('ID3v2.3 header + frames; buildTags brands with another site', () => {
  const t = buildTags({ title: 'x' }, { ...BRAND_LIMINAL, name: 'NoDAW CoProducer', credit: 'Made with NoDAW CoProducer', url: 'https://example.test/' });
  const id3 = buildId3(t); assert.equal(String.fromCharCode(...id3.subarray(0, 3)), 'ID3'); assert.equal(id3[3], 3);
  const sz = (id3[6] << 21) | (id3[7] << 14) | (id3[8] << 7) | id3[9]; assert.equal(sz, id3.length - 10);
  assert.match(t.comment, /CoProducer/);
});
test('ZIP round-trips stored entries; safeName strips path chars', () => {
  const z = zipFiles(fflate, [{ name: 'a/b.wav', data: Uint8Array.of(1, 2, 3) }, { name: 'c.txt', data: Uint8Array.of(9) }]);
  const u = fflate.unzipSync(z); assert.deepEqual([...u['a/b.wav']], [1, 2, 3]); assert.deepEqual([...u['c.txt']], [9]);
  assert.equal(safeName('../../etc/pass:wd'), '.._.._etc_pass_wd'); assert.equal(safeName(''), 'stem');
});

test('MP3 export: lamejs output carries ID3 credit and decodes at the right rate/duration', async () => {
  const vm = await import('node:vm');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../public/stem-studio/vendor/lamejs/lame.min.js', import.meta.url), 'utf8') + ';this.lamejs = lamejs;', ctx);
  const { encodeMp3 } = await import('../public/stem-studio/export.js');
  const m = await encodeMp3(ctx.lamejs, [L, R], 44100, 192, { title: 'MP3 T', stem: 'bass' });
  const f = path.join(tmp, 'a.mp3'); fs.writeFileSync(f, m);
  if (!have('ffprobe')) return;
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
  assert.equal(j.streams[0].codec_name, 'mp3'); assert.equal(j.streams[0].sample_rate, '44100');
  assert.match(j.format.tags.comment || j.format.tags.COMM || '', /Made with NoDAW Liminal/); assert.equal(j.format.tags.title, 'MP3 T');
  assert.ok(Math.abs(parseFloat(j.format.duration) - n / 44100) < 0.06);
});
