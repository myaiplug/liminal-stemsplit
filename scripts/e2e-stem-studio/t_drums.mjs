import { open, importMini } from './lib.mjs';
const { browser, page, errs } = await open(); await importMini(page);
const sel = () => page.evaluate(() => { const e = window.__studio; e.selected = e.tracks.find((t) => t.name.toLowerCase() === 'drums').id; e.emit('tracks'); });
await page.evaluate(() => { const e = window.__studio, N = e.tracks[0].orig[0].length, o = new Float64Array(N); for (const t of e.tracks) for (let i = 0; i < N; i++) o[i] += t.orig[0][i]; window.__ref = o; });
await sel(); await page.click('#tab-drums'); await page.waitForSelector('#dm-go'); await page.waitForTimeout(1500);
console.log('probe note:', await page.$eval('.warn-note', (e) => e.hidden ? '(hidden)' : e.textContent).catch(() => 'none'));
await page.screenshot({ path: '/workspace/studio-shots/drums-tab-before.png' });
async function runSplit(mode) {
  await sel(); await page.click('#tab-drums'); await page.waitForSelector('#dm-go');
  await page.check(mode === 'ml' ? '#dm-ml' : '#dm-dsp'); const t0 = Date.now();
  await page.click('#dm-go'); await page.waitForFunction(() => window.__studio.tracks.length > 4 && !document.querySelector('.live:not([hidden])'), null, { timeout: 700000 });
  console.log(mode, 'done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const r = await page.evaluate(() => { const e = window.__studio, N = e.tracks[0].orig[0].length, o = new Float64Array(N); for (const t of e.tracks) if (!t.mute) for (let i = 0; i < N; i++) o[i] += t.orig[0][i]; let d = 0, s = 0; for (let i = 0; i < N; i++) { d += (o[i] - window.__ref[i]) ** 2; s += window.__ref[i] ** 2; } return { names: e.tracks.map((t) => `${t.name}${t.mute ? '(muted)' : ''}`), snrDb: 10 * Math.log10(s / (d + 1e-30)), rms: e.tracks.map((t) => [t.name, +Math.sqrt(t.orig[0].reduce((s, v) => s + v * v, 0) / N).toFixed(4)]) }; });
  console.log(JSON.stringify(r)); await page.screenshot({ path: `/workspace/studio-shots/drums-${mode}.png`, fullPage: true }); const ed = await page.$('.insp'); await page.evaluate(() => document.querySelector('.insp').scrollIntoView()); await page.screenshot({ path: `/workspace/studio-shots/drums-${mode}-editor.png` });
}
await runSplit('dsp');
await page.click('text=Undo split'); await page.waitForFunction(() => window.__studio.tracks.length === 4); console.log('undo ok', await page.evaluate(() => window.__studio.tracks.map((t) => t.name + (t.mute ? '(m)' : ''))));
await runSplit('ml');
console.log('errors:', errs.slice(0, 5)); await browser.close();
