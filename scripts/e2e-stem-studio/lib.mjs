import { chromium } from 'playwright-core'; import fs from 'node:fs';
export const FIX = '/workspace/studio-fixtures/mini/';
export async function open({ viewport = { width: 1400, height: 1100 }, profile } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport, acceptDownloads: true }); const page = await ctx.newPage();
  const errs = []; page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); }); page.on('console', (m) => { if (['error'].includes(m.type())) errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('PAGEERR ' + e.stack));
  page.setDefaultTimeout(120000);
  await page.goto('http://localhost:8123/stem-studio.html'); await page.waitForFunction(() => window.__studioUi, null, { timeout: 20000 });
  return { browser, ctx, page, errs };
}
export async function importMini(page, names = ['bass', 'drums', 'other', 'vocals']) {
  await page.setInputFiles('.drop input', names.map((n) => FIX + n + '.wav')); await page.waitForFunction((n) => window.__studio.tracks.length >= n, names.length);
}
export async function getFile(page, expr) { // expr evaluates to Uint8Array in page; returns Buffer
  const b64 = await page.evaluate(async (e) => { const u8 = await (0, eval)(e); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }, expr);
  return Buffer.from(b64, 'base64');
}
