import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStem, applyFix, findClicks, noiseProfile } from '../public/stem-studio/artifacts.js';

const sr = 44100;
let seed = 99; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const rmsDb = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (b - a) + 1e-14); };
const types = (r) => r.issues.map((i) => i.type);

function tonal(sec, amp = 0.3) { const n = sr * sec, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; const v = amp * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 660 * t) * (0.7 + 0.3 * Math.sin(t * 3)) + 0.2 * Math.sin(2 * Math.PI * 2750 * t)); L[i] = v; R[i] = v * 0.9 + 0.02 * Math.sin(2 * Math.PI * 330 * t); } return [L, R]; }
function drums(sec, amp = 0.5) { const n = sr * sec, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, b = t % 0.5, k = Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-b * 40)) * b) * Math.exp(-b * 9), h = rnd() * Math.exp(-(t % 0.25) * 55) * 0.8; L[i] = amp * (k + h); R[i] = amp * (k + h * 0.9); } return [L, R]; }

test('clicks: found and repaired; ringing transients are NOT flagged', () => {
  const [L, R] = tonal(6); const clean = L.slice();
  const where = [20000, 61000, 120000, 190000, 240000]; where.forEach((n, i) => { L[n] += 0.6 * (i % 2 ? 1 : -1); L[n + 1] += 0.3; });
  const c = findClicks(L, sr); assert.equal(c.length, 5, `found ${c.length}`);
  const r = analyzeStem({ name: 'other', kind: 'other', L, R }, sr, []); assert.ok(types(r).includes('clicks'));
  const fx = applyFix(r.issues.find((i) => i.type === 'clicks').fix, { L, R }, sr);
  let err = 0, errBefore = 0; for (const n of where) for (let j = -3; j <= 5; j++) { err = Math.max(err, Math.abs(fx.L[n + j] - clean[n + j])); errBefore = Math.max(errBefore, Math.abs(L[n + j] - clean[n + j])); }
  assert.ok(err < 0.05 * errBefore + 0.01, `err ${err} vs ${errBefore}`);
  assert.equal(findClicks(fx.L, sr).length, 0);
  const [DL, DR] = drums(6); assert.equal(findClicks(DL, sr).length, 0, 'drum transients are not clicks');
  assert.ok(!types(analyzeStem({ name: 'drums', kind: 'drums', L: DL, R: DR }, sr, [])).includes('clicks'));
});

test('noise bed between phrases: detected, denoise drops the floor >12 dB and leaves the music', () => {
  const sec = 14, n = sr * sec, L = new Float32Array(n), R = new Float32Array(n);
  const [tL, tR] = tonal(sec, 0.3);
  for (let i = 0; i < n; i++) { const on = Math.floor(i / sr / 2) % 2 === 0; const nz = 0.004 * rnd() * 2; L[i] = (on ? tL[i] : 0) + nz; R[i] = (on ? tR[i] : 0) + 0.004 * rnd() * 2; }
  const r = analyzeStem({ name: 'vocals', kind: 'vocals', L, R }, sr, []); assert.ok(types(r).includes('noise'), JSON.stringify(r.metrics));
  const issue = r.issues.find((i) => i.type === 'noise'); const fx = applyFix({ ...issue.fix, params: { ...issue.fix.params, profile: noiseProfile(L, R, sr) } }, { L, R }, sr);
  const gap = [Math.round(sr * 2.3), Math.round(sr * 3.7)], play = [Math.round(sr * 0.5), Math.round(sr * 1.5)];
  const before = rmsDb(L, gap[0], gap[1]), after = rmsDb(fx.L, gap[0], gap[1]);
  assert.ok(before - after > 12, `gap ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  assert.ok(Math.abs(rmsDb(fx.L, play[0], play[1]) - rmsDb(L, play[0], play[1])) < 1, 'music level preserved');
  const clean = analyzeStem({ name: 'vocals', kind: 'vocals', L: tL, R: tR }, sr, []); assert.ok(!types(clean).includes('noise'));
});

test('bleed: drums leaking into bass is detected and masked; clean stems are not flagged', () => {
  const sec = 12, [dL, dR] = drums(sec, 0.5);
  const n = sr * sec, bL = new Float32Array(n), bR = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; const note = 55 * Math.pow(2, [0, 3, 5, 7][Math.floor(t / 1.5) % 4] / 12); const v = 0.35 * (Math.sin(2 * Math.PI * note * t) + 0.4 * Math.sin(2 * Math.PI * note * 2.01 * t) + 0.15 * Math.sin(2 * Math.PI * note * 5 * t + 1)); bL[i] = v; bR[i] = v; }
  const leakL = bL.slice(), leakR = bR.slice(); const k = Math.pow(10, -22 / 20); for (let i = 0; i < n; i++) { leakL[i] += k * dL[i]; leakR[i] += k * dR[i]; }
  const drumsStem = { name: 'drums', L: dL, R: dR };
  const rClean = analyzeStem({ name: 'bass', kind: 'bass', L: bL, R: bR }, sr, [drumsStem]); assert.ok(!types(rClean).includes('bleed'), JSON.stringify(rClean.metrics.bleed));
  const r = analyzeStem({ name: 'bass', kind: 'bass', L: leakL, R: leakR }, sr, [drumsStem]);
  const issue = r.issues.find((i) => i.type === 'bleed'); assert.ok(issue, JSON.stringify([r.metrics.bleed, r.metrics.bleedRaw]));
  const fx = applyFix(issue.fix, { L: leakL, R: leakR }, sr, [drumsStem]);
  // residual of the leaked component: compare high band (>1.5 kHz) energy of the stem before/after
  const hp = (x) => { const y = new Float32Array(x.length); for (let i = 3; i < x.length; i++) y[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; return y; };
  const before = rmsDb(hp(leakL)), after = rmsDb(hp(fx.L)), ref = rmsDb(hp(bL));
  assert.ok(before - after > 6, `hf ${before.toFixed(1)} -> ${after.toFixed(1)} (clean ${ref.toFixed(1)})`);
  assert.ok(Math.abs(rmsDb(fx.L, 0, n) - rmsDb(bL, 0, n)) < 1.2, 'bass body preserved');
});

test('phasey stereo is flagged and the fix improves mono compatibility', () => {
  const n = sr * 8, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, v = 0.3 * (Math.sin(2 * Math.PI * 500 * t) + 0.6 * Math.sin(2 * Math.PI * 1300 * t + 1) + 0.4 * Math.sin(2 * Math.PI * 3100 * t)); L[i] = v; R[i] = -v; }
  const r = analyzeStem({ name: 'other', kind: 'other', L, R }, sr, []); const issue = r.issues.find((i) => i.type === 'phasey'); assert.ok(issue, JSON.stringify(r.metrics));
  const fx = applyFix(issue.fix, { L, R }, sr); const mono = (a, b) => { const m = new Float32Array(a.length); for (let i = 0; i < m.length; i++) m[i] = (a[i] + b[i]) / 2; return m; };
  const mid = sr, end = n - sr;
  assert.ok(rmsDb(mono(fx.L, fx.R), mid, end) - rmsDb(mono(L, R), mid, end) > 15, `mono ${rmsDb(mono(L, R), mid, end)} -> ${rmsDb(mono(fx.L, fx.R), mid, end)}`);
});

test('spectral holes: random time-frequency dropouts flagged; fix fills them', async () => {
  const { processInSegments } = await import('../public/stem-studio/dsp/spectral.js');
  const sec = 10, n = sr * sec, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; const v = 0.2 * (Math.sin(2 * Math.PI * 300 * t) + Math.sin(2 * Math.PI * 900 * t) + 0.7 * Math.sin(2 * Math.PI * 1700 * t)) + 0.15 * rnd(); L[i] = v; R[i] = v; }
  const clean = analyzeStem({ name: 'other', kind: 'other', L, R }, sr, []); assert.ok(!types(clean).includes('holes'), `clean flagged: ${clean.metrics.holeFrac}`);
  let s2 = 7; const rr = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
  const [hl, hr] = processInSegments(L, R, sr, (S) => { for (let t = 0; t < S.T - 4; t += 2) for (let k = 5; k < S.F - 8; k += 3) if (rr() < 0.3) for (let dt = 0; dt < 4; dt++) for (let dk = 0; dk < 3; dk++) { const i = (t + dt) * S.F + k + dk; S.reL[i] = S.imL[i] = S.reR[i] = S.imR[i] = 0; } });
  const r = analyzeStem({ name: 'other', kind: 'other', L: hl, R: hr }, sr, []); const issue = r.issues.find((i) => i.type === 'holes');
  assert.ok(issue, `hole metrics ${r.metrics.holeFrac} (clean ${clean.metrics.holeFrac})`);
  const fx = applyFix(issue.fix, { L: hl, R: hr }, sr); const after = analyzeStem({ name: 'other', kind: 'other', L: fx.L, R: fx.R }, sr, []);
  assert.ok(after.metrics.holeFrac < r.metrics.holeFrac * 0.7, `${r.metrics.holeFrac} -> ${after.metrics.holeFrac}`);
});
