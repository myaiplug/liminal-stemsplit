import { open, importMini } from './lib.mjs';
const { browser, page, errs } = await open(); await importMini(page);
// ---- latency alignment
const lat = await page.evaluate(async () => {
  const eng = window.__studio, sr = eng.sr, n = sr * 2, at = 20000; const out = {};
  const imp = new Float32Array(n); imp[at] = 0.9;
  const tone = new Float32Array(n); for (let i = 30000; i < 30000 + 8000; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr) * Math.min(1, (i - 30000) / 40);
  const peakAt = (x) => { let m = 0, k = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > m) { m = Math.abs(x[i]); k = i; } return k; };
  const onset = (x) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.02) return i; return -1; };
  for (const [name, chain, sig] of [
    ['limiter(lookahead)', [{ type: 'limiter', enabled: true, params: { threshold: -6, release: 80 } }], imp],
    ['maximizer', [{ type: 'loudness', enabled: true, params: { gain: 6, ceiling: -1 } }], imp],
    ['pitch +0', [{ type: 'pitch', enabled: true, params: { semitones: 0 } }], tone],
    ['pitch+limiter', [{ type: 'pitch', enabled: true, params: { semitones: 0 } }, { type: 'limiter', enabled: true, params: { threshold: -6, release: 80 } }], tone],
  ]) {
    const t = await eng.addTrack({ name: 'lat', L: sig, R: sig, sr, kind: 'other' });
    eng.setFx(t, chain); const dry = await eng.renderTrack(t, { bypass: true }); const wet = await eng.renderTrack(t);
    const f = sig === imp ? peakAt : onset;
    out[name] = { lat: wet.lat, dry: f(dry.L), wet: f(wet.L), src: f(sig) }; await eng.removeTrack(t.id);
  }
  return out;
});
console.log('latency alignment (sample index of impulse peak / tone onset):'); for (const [k, v] of Object.entries(lat)) console.log(' ', k.padEnd(20), JSON.stringify(v));
// ---- artifacts via UI
await page.click('.lane:nth-child(2) .nm >> nth=0').catch(() => {});
await page.evaluate(() => { const e = window.__studio; e.selected = e.tracks.find((t) => t.name === 'other').id; e.emit('tracks'); });
await page.waitForTimeout(500);
await page.click('#tab-clean'); await page.click('text=Scan for artifacts'); await page.waitForSelector('.issue, .ok-note', { timeout: 60000 });
const issues = await page.$$eval('.issue h4', (e) => e.map((x) => x.textContent)); console.log('issues(other):', issues);
await page.screenshot({ path: '/workspace/studio-shots/clean-tab.png', fullPage: false });
const fixBtn = await page.$('.issue .btn.pri:not([disabled])');
if (fixBtn) { await fixBtn.click(); await page.waitForSelector('text=Applied fixes', { timeout: 60000 }); console.log('fix applied; hearing toggle:', await page.textContent('[aria-pressed][class="btn"]').catch(() => '')); }
const rmsInfo = await page.evaluate(async () => { const e = window.__studio, t = e.trackById(e.selected); const w = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }; return { fixes: t.fixes.map((f) => f.label + ': ' + f.summary), before: w(t.orig[0]), after: t.fixed ? w(t.fixed[0]) : null }; });
console.log(JSON.stringify(rmsInfo));
// ---- session save / restore
const before = await page.evaluate(async () => { const e = window.__studio; e.applyPreset(e.tracks[1], (await import('/stem-studio/engine.js')).presetsFor('drums')[0].id); e.setMix(e.tracks[0], { gain: -5.5, pan: -0.3 }); e.trimTo(e.tracks.map((t) => t.id), 1, 15); await e.saveSession('E2E session'); const sig = []; for (const t of e.tracks) { const r = await e.renderTrack(t); let h = 0; for (let i = 0; i < r.L.length; i += 7) h = (h * 31 + Math.round(r.L[i] * 1e6)) | 0; sig.push([t.name, r.L.length, h]); } return { sig, id: e.project.id }; });
await page.reload(); await page.waitForFunction(() => window.__studioUi); await page.waitForSelector('.sessions li');
console.log('sessions listed:', await page.$$eval('.sessions li', (e) => e.map((x) => x.textContent.slice(0, 60))));
await page.click('.sessions li button:has-text("Open")'); await page.waitForFunction(() => window.__studio.tracks.length === 4 && !document.querySelector('.live:not([hidden])'));
await page.waitForTimeout(1000);
const after = await page.evaluate(async () => { const e = window.__studio; const sig = []; for (const t of e.tracks) { const r = await e.renderTrack(t); let h = 0; for (let i = 0; i < r.L.length; i += 7) h = (h * 31 + Math.round(r.L[i] * 1e6)) | 0; sig.push([t.name, r.L.length, h]); } return { sig, gain: e.tracks[0].gain, pan: e.tracks[0].pan, fixes: e.tracks.map((t) => t.fixes.length) }; });
console.log('restore equal:', JSON.stringify(before.sig) === JSON.stringify(after.sig), JSON.stringify(after.sig.map((s) => s[1])), 'gain/pan', after.gain, after.pan, 'fixes', after.fixes);
console.log('before', JSON.stringify(before.sig)); console.log('after ', JSON.stringify(after.sig));
console.log('errs', errs.filter((e) => !e.includes('404'))); await browser.close();
