import { open, importMini } from './lib.mjs';
const { browser, page, errs } = await open(); await importMini(page);
const res = await page.evaluate(async () => {
  const eng = window.__studio; const { STEM_KINDS, presetsFor } = await import('/stem-studio/engine.js');
  const srcFor = (k) => ({ vocals: 'vocals', bass: 'bass', sub808: 'bass' }[k] || (['drums','kick','snare','hats','toms','cymbals'].includes(k) ? 'drums' : 'other'));
  const out = []; const t0 = performance.now();
  for (const kind of Object.keys(STEM_KINDS)) {
    const src = eng.tracks.find((t) => t.name === srcFor(kind));
    const W = 44100 * 5, N = src.orig[0].length; let a = 0, best = -1; for (let s0 = 0; s0 + W <= N; s0 += 22050) { let e = 0; for (let i = s0; i < s0 + W; i += 8) e += src.orig[0][i] ** 2; if (e > best) { best = e; a = s0; } } const b = a + W;
    const t = await eng.addTrack({ name: `t_${kind}`, L: src.orig[0].slice(a, b), R: src.orig[1].slice(a, b), sr: eng.sr, kind });
    const dry = await eng.renderTrack(t, { bypass: true });
    const rms = (x) => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / x.length); };
    const pk = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
    const bad = (x) => { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return true; return false; };
    for (const p of presetsFor(kind)) {
      eng.applyPreset(t, p.id); const r = await eng.renderTrack(t);
      out.push({ kind, preset: p.id, family: p.family, rms: rms(r.L), dryRms: rms(dry.L), peak: pk(r.L), nan: bad(r.L) || bad(r.R), lat: r.lat, len: r.L.length });
    }
    await eng.removeTrack(t.id);
  }
  return { out, sec: (performance.now() - t0) / 1000 };
});
const fails = res.out.filter((r) => r.nan || r.rms < 1e-4 || r.peak > 16 || r.len !== 220500);
console.log('presets tested', res.out.length, 'in', res.sec.toFixed(0), 's; failures', fails.length);
for (const f of fails) console.log('FAIL', JSON.stringify(f));
const byKind = {}; for (const r of res.out) (byKind[r.kind] ||= []).push(r); for (const [k, v] of Object.entries(byKind)) console.log(k.padEnd(9), v.length, 'presets; peak max', Math.max(...v.map((x) => x.peak)).toFixed(2), 'rms min', Math.min(...v.map((x) => x.rms)).toFixed(4));
import('node:fs').then((fs) => fs.writeFileSync('out_presets.json', JSON.stringify(res.out)));
console.log('errs', errs); await browser.close();
