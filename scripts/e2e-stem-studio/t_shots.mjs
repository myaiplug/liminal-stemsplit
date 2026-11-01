import { open, importMini } from './lib.mjs'; import fs from 'node:fs';
const { browser, page, errs } = await open(); await importMini(page);
const sh = (n, o = {}) => page.screenshot({ path: `/workspace/studio-shots/${n}.png`, ...o });
await page.evaluate(() => { const e = window.__studio; e.selected = e.tracks.find((t) => t.name === 'vocals').id; e.emit('tracks'); });
await sh('00-landing-loaded', { fullPage: true });
for (const [tab, name] of [['fx', '01-fx'], ['clean', '02-clean'], ['loud', '03-loudness']]) { await page.click(`#tab-${tab}`); if (tab === 'loud') { await page.click('text=Measure >> nth=0').catch(() => {}); await page.waitForTimeout(1500); } await page.evaluate(() => document.querySelector('.insp').scrollIntoView()); await sh(name); }
await page.click('#tab-fx'); const ex = await page.$('text=Render & export'); await ex?.scrollIntoViewIfNeeded(); await sh('04-export');
// axe
const axe = fs.readFileSync('/workspace/axe/node_modules/axe-core/axe.min.js', 'utf8'); await page.evaluate(axe);
const res = await page.evaluate(async () => { const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, ex: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) })); });
console.log('axe violations:', JSON.stringify(res, null, 1));
// mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage(); await mp.goto('http://localhost:8123/stem-studio.html'); await mp.waitForFunction(() => window.__studioUi);
await mp.setInputFiles('.drop input', ['bass', 'drums', 'other', 'vocals'].map((n) => `/workspace/studio-fixtures/mini/${n}.wav`)); await mp.waitForFunction(() => window.__studio.tracks.length >= 4);
await mp.screenshot({ path: '/workspace/studio-shots/05-mobile-top.png' }); await mp.locator('.insp').scrollIntoViewIfNeeded(); await mp.waitForTimeout(500); await mp.screenshot({ path: '/workspace/studio-shots/06-mobile-inspector.png' }); await mp.locator('.lane').first().scrollIntoViewIfNeeded(); await mp.waitForTimeout(300); await mp.screenshot({ path: '/workspace/studio-shots/07-mobile-lanes.png' });
console.log('mobile hscroll:', await mp.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
console.log('errors', errs); await browser.close();
