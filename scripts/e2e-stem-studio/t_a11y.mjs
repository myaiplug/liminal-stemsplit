import { open, importMini } from './lib.mjs'; import fs from 'node:fs';
const { browser, page } = await open(); await importMini(page);
await page.evaluate(fs.readFileSync('/workspace/axe/node_modules/axe-core/axe.min.js', 'utf8'));
const r = await page.evaluate(async () => { const x = await axe.run(document, { runOnly: ['color-contrast', 'nested-interactive'] }); return x.violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, t: n.target.join(' '), s: n.any[0]?.message?.slice(0, 140) || n.failureSummary.slice(0, 200), html: n.html.slice(0, 120) }))); });
const seen = new Set(); for (const v of r) { const k = v.id + v.t.replace(/:nth-child\(\d+\)/g, ''); if (seen.has(k)) continue; seen.add(k); console.log(v.id, '|', v.t, '|', v.s, '|', v.html); }
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage(); await mp.goto('http://localhost:8123/stem-studio.html'); await mp.waitForFunction(() => window.__studioUi);
await mp.setInputFiles('.drop input', ['bass', 'drums', 'other', 'vocals'].map((n) => `/workspace/studio-fixtures/mini/${n}.wav`)); await mp.waitForFunction(() => window.__studio.tracks.length >= 4);
console.log(await mp.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 392 && getComputedStyle(e).position !== 'fixed').slice(0, 12).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))));
await browser.close();
