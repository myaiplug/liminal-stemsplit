import { open, importMini, getFile } from './lib.mjs'; import fs from 'node:fs';
const { browser, page, errs } = await open(); await importMini(page); fs.mkdirSync('out/exp', { recursive: true });
// set up edits + FX + gains deterministic
await page.evaluate(async () => {
  const eng = window.__studio; const get = (n) => eng.tracks.find((t) => t.name === n);
  eng.applyPreset(get('drums'), eng.tracks.length && (await import('/stem-studio/engine.js')).presetsFor('drums')[0].id);
  eng.applyPreset(get('vocals'), (await import('/stem-studio/engine.js')).presetsFor('vocals')[0].id);
  eng.setMix(get('bass'), { gain: -3 }); eng.setMix(get('other'), { pan: 0.4 });
});
const run = async (name, opts) => {
  const r = await page.evaluate(async (o) => { const eng = window.__studio; const x = await eng.exportAll(o); window.__last = x; return { report: x.report, files: x.files.map((f) => ({ name: f.name, size: f.data.length, mime: f.mime })), inner: (x.inner || []).map((f) => f.name) }; }, opts);
  for (let i = 0; i < r.files.length; i++) fs.writeFileSync(`out/exp/${name}__${r.files[i].name}`, await getFile(page, `window.__last.files[${i}].data`));
  fs.writeFileSync(`out/exp/${name}.json`, JSON.stringify(r)); console.log(name, r.files.map((f) => f.name + ':' + f.size).join(' '));
  return r;
};
await run('pcm24', { format: 'pcm24', normalize: 'off', tail: false, mix: true, zip: false, title: 'E2E Title', artist: 'E2E Artist' });
await run('f32', { format: 'float32', normalize: 'off', tail: false, mix: true, zip: false });
await run('mixnorm', { format: 'float32', normalize: 'mix', target: { lufs: -14, tp: -1 }, tail: false, mix: true, zip: false });
await run('eachnorm', { format: 'float32', normalize: 'each', target: { lufs: -14, tp: -1 }, tail: false, mix: true, zip: false });
await run('club', { format: 'float32', normalize: 'mix', target: { lufs: -9, tp: -0.3 }, tail: false, mix: true, zip: false });
await run('mp3', { format: 'mp3', normalize: 'off', tail: false, mix: true, zip: false, mp3kbps: 192, title: 'MP3 T', artist: 'MP3 A', ids: [] });
await run('zip', { format: 'pcm24', normalize: 'off', tail: true, mix: true, zip: true });
// edits: trim 2-12 s, cut 4-5 s (=> 9 s), silence 6-7 s kept
await page.evaluate(() => { const eng = window.__studio; const ids = eng.tracks.map((t) => t.id); eng.trimTo(ids, 2, 12); eng.addCut(ids, 4, 5, 'cut'); eng.addCut(ids, 6, 7, 'silence'); });
await run('edits', { format: 'pcm24', normalize: 'off', tail: false, mix: true, zip: false });
console.log('errs', errs.filter((e) => !e.includes('404'))); await browser.close();
