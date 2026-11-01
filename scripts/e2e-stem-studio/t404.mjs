import { open } from './lib.mjs';
const { browser, page } = await open(); page.on('response', (r) => { if (r.status() >= 400) console.log(r.status(), r.url()); });
await page.reload(); await page.waitForFunction(() => window.__studioUi); await page.waitForTimeout(1500); await browser.close();
