import { chromium } from 'playwright-core'; import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await (await browser.newContext()).newPage(); page.setDefaultTimeout(1800000);
page.on('console', (m) => console.log('[c]', m.text())); page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:8123/stem-studio.html');
const secs = +process.argv[2] || 12;
const r = await page.evaluate(async (secs) => {
  const buf = await (await fetch('/stem-studio/drums/models/../../../__nonexistent').catch(() => null))?.arrayBuffer?.();
  return 'x';
}, secs);
const out = await page.evaluate(async (secs) => {
  const ab = await (await fetch('http://localhost:8123/__fix/drums.wav')).arrayBuffer();
  const ac = new OfflineAudioContext(2, 44100, 44100); const b = await ac.decodeAudioData(ab);
  const n = Math.min(b.length, Math.round(secs * 44100)); const L = b.getChannelData(0).slice(0, n), R = (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice(0, n);
  const w = new Worker('/stem-studio/drums/drum-worker.js', { type: 'module' });
  const t0 = performance.now(); const log = [];
  return await new Promise((res, rej) => {
    w.onmessage = (e) => { const m = e.data; if (m.type === 'progress') { if (m.phase !== 'download' || Math.random() < .02) log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${m.phase} ${(m.fraction * 100).toFixed(0)}%`); } else if (m.type === 'done') { const rms = m.stems.map((a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)); { const all = new Float32Array(m.stems.length*n); m.stems.forEach((a,i)=>all.set(a,i*n)); const u=new Uint8Array(all.buffer); let bs=''; for(let i=0;i<u.length;i+=0x8000) bs+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); res({ log, backend: m.backend, ms: m.ms, rms, n, stems: m.stems.length, b64: btoa(bs) }); }; } else rej(new Error(m.message)); };
    w.onerror = (e) => rej(new Error('worker error ' + e.message));
    w.postMessage({ op: 'split', rid: 1, L, R, device: 'wasm' }, [L.buffer, R.buffer]);
  });
}, secs).catch((e) => ({ err: e.message }));
if (out.b64) { fs.writeFileSync('/tmp/browser_stems.f32', Buffer.from(out.b64,'base64')); delete out.b64; } console.log(JSON.stringify(out)); await browser.close();
