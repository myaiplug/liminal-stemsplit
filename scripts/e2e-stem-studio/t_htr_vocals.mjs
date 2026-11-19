// Browser e2e (CPU / wasm): Vocals tab lead/backing split and the HT-RoFormer drum model, through the UI.
// Needs the two ONNX files linked locally (see README) and serve.mjs running on :8123.
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const FIX = '/workspace/studio-fixtures/mini/', SHOTS = process.env.SHOTS || '/workspace/studio-shots';
const which = process.argv[2] || 'both';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1400 } })).newPage(); page.setDefaultTimeout(1800000);
const errs = []; page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); }); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('PAGEERR ' + e.stack));
const q = '?karaokemodel=/stem-studio/vocals/models/model_fp16.onnx&drummodel_htr=/stem-studio/drums/models/drumsep_htr_core_f16w.onnx';
await page.goto('http://localhost:8123/stem-studio.html' + q); await page.waitForFunction(() => window.__studioUi, null, { timeout: 20000 });
await page.setInputFiles('.drop input', ['bass', 'drums', 'other', 'vocals'].map((n) => FIX + n + '.wav')); await page.waitForFunction(() => window.__studio.tracks.length >= 4);
const pick = (name) => page.locator('button.nm', { hasText: name }).first().click();
const tracks = () => page.evaluate(() => __studio.tracks.map((t) => ({ name: t.name, kind: t.kind, parent: t.parent ?? null, mute: !!t.mute })));
const res = {};
if (which !== 'drums') {
  await pick('vocals'); await page.click('#tab-vocals'); await page.waitForSelector('#vk-go');
  await page.screenshot({ path: `${SHOTS}/vocals-tab.png`, fullPage: false });
  const t0 = Date.now(); await page.click('#vk-go');
  await page.waitForFunction(() => __studio.tracks.some((t) => t.kind === 'backing'), null, { timeout: 1800000 });
  res.vocals = { secs: (Date.now() - t0) / 1000, tracks: await tracks() };
  await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/vocals-split-done.png` });
}
if (which !== 'vocals') {
  await pick('drums'); await page.click('#tab-drums'); await page.waitForSelector('#dm-go');
  await page.check('#dm-ml'); await page.waitForFunction(() => !document.getElementById('dmm-htr').disabled, null, { timeout: 30000 }); await page.check('#dmm-htr');
  await page.screenshot({ path: `${SHOTS}/drums-htr-option.png` });
  const t0 = Date.now(); await page.click('#dm-go');
  await page.waitForFunction(() => __studio.tracks.some((t) => t.kind === 'perc'), null, { timeout: 1800000 });
  res.drums = { secs: (Date.now() - t0) / 1000, tracks: await tracks() };
  await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/drums-htr-done.png` });
}
res.errs = errs; console.log(JSON.stringify(res, null, 1)); await browser.close();
