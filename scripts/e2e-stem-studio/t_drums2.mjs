import { open, importMini } from './lib.mjs';
const { browser, page, errs } = await open(); await importMini(page);
const R = await page.evaluate(async () => {
  const eng = window.__studio; const { DrumSplitter, splitDrumTrack } = await import('/stem-studio/drums/drum-split.js'); const { presetsFor } = await import('/stem-studio/engine.js');
  const mixOf = async () => { const x = await eng.exportAll({ format: 'float32', normalize: 'off', tail: false, mix: true, zip: false }); return x; };
  const pre = await mixOf(); const mixName = pre.files.find((f) => /mix/i.test(f.name)).name;
  const decode = (f) => { const d = new DataView(f.data.buffer, f.data.byteOffset); let p = 12, fmt, data; while (p < f.data.length) { const id = String.fromCharCode(...f.data.subarray(p, p + 4)), n = d.getUint32(p + 4, true); if (id === 'data') { data = new Float32Array(f.data.buffer.slice(f.data.byteOffset + p + 8, f.data.byteOffset + p + 8 + n)); } p += 8 + n + (n & 1); } return data; };
  const a = decode(pre.files.find((f) => f.name === mixName));
  const sp = new DrumSplitter(); const drums = eng.tracks.find((t) => t.name === 'drums');
  await splitDrumTrack(eng, sp, drums, { mode: 'dsp', hats: true, sub808: true, fc: 120 });
  for (const t of eng.tracks) { const ps = presetsFor(t.kind); if (t.parent && ps.length) eng.applyPreset(t, ps[0].id); }
  eng.tracks.forEach((t) => { if (t.parent) { t.chain = []; } }); // chain-free export first: should equal original mix
  const post = await mixOf(); const b = decode(post.files.find((f) => f.name === mixName));
  let d = 0, s = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; s += a[i] ** 2; }
  return { files: post.files.map((f) => f.name), report: post.report, mixSnrDb: 10 * Math.log10(s / (d + 1e-30)) };
});
console.log("mixSnrDb", R.mixSnrDb);
// session save/restore with split tracks
const before = await page.evaluate(async () => { const e = window.__studio; await e.saveSession('drum split'); return e.tracks.map((t) => [t.name, t.kind, t.mute, e.trackById(t.parent)?.name || null]); });
await page.reload(); await page.waitForFunction(() => window.__studioUi); await page.waitForSelector('.sessions li');
await page.click('.sessions li button:has-text("Open")'); await page.waitForFunction(() => window.__studio.tracks.length === 12 && !document.querySelector('.live:not([hidden])'), null, { timeout: 60000 });
const after = await page.evaluate(() => window.__studio.tracks.map((t) => [t.name, t.kind, t.mute, window.__studio.trackById(t.parent)?.name || null]));
console.log('session restore equal:', JSON.stringify(before) === JSON.stringify(after)); console.log(JSON.stringify(after));
console.log('errors', errs); await browser.close();
