import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] || 'https://liminal-stemsplit.onrender.com';
const outDir = path.join(__dirname, 'screenshots', new URL(baseUrl).hostname);

const shots = [
  { name: '01-hero', url: `${baseUrl}/`, fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { name: '02-hero-full', url: `${baseUrl}/`, fullPage: true },
  { name: '03-demo', url: `${baseUrl}/#demo`, fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { name: '04-pricing', url: `${baseUrl}/#pricing`, fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { name: '05-download', url: `${baseUrl}/#download`, fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { name: '06-mobile-hero', url: `${baseUrl}/`, viewport: { width: 390, height: 844 }, fullPage: false },
];

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await context.newPage();

for (const shot of shots) {
  if (shot.viewport) {
    await page.setViewportSize(shot.viewport);
  } else {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  console.log(`Capturing ${shot.name} -> ${shot.url}`);
  await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);

  const file = path.join(outDir, `${shot.name}.png`);
  if (shot.fullPage) {
    await page.screenshot({ path: file, fullPage: true });
  } else if (shot.clip) {
    await page.screenshot({ path: file, clip: shot.clip });
  } else {
    await page.screenshot({ path: file });
  }
  console.log(`  saved ${file}`);
}

await browser.close();
console.log(`Screenshots saved to ${outDir}`);