import test from 'node:test';
import assert from 'node:assert/strict';
import { STEM_KINDS, presetsFor, chainFromPreset, stemKind, chainModules, MODULES, defaultParams, blankChain } from '../public/stem-studio/presets.js';
import { DESKTOP } from '../public/stem-studio/desktop-data.js';
import { Chain, FX_TYPES } from '../public/stem-studio/dsp/chain.js';

const SR = 44100;
const src = () => { // drum-ish loop: kick + noise bursts + tone, stereo
  const n = SR * 2, L = new Float32Array(n), R = new Float32Array(n);
  let s = 7;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647; const nz = s / 2147483647 - 0.5;
    const t = i / SR, beat = t % 0.5;
    const k = Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 8);
    const h = nz * Math.exp(-((t % 0.25)) * 40) * 0.5;
    const v = 0.35 * Math.sin(2 * Math.PI * 220 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t));
    L[i] = 0.6 * k + h + v; R[i] = 0.6 * k + h * 0.8 + v * 0.9;
  }
  return [L, R];
};
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

test('desktop data: 15 unique desktop presets in 4 families, 14 modules', () => {
  assert.equal(Object.keys(DESKTOP.ALL_FX_MODULES).length, 14);
  const ids = new Set(); for (const k of ['vocals', 'drums', 'bass', 'other']) for (const p of DESKTOP.STEM_PRESETS[k]) ids.add(p.id);
  assert.equal(ids.size, 15);
  assert.deepEqual(DESKTOP.STEM_FX_CHAINS.vocals.slice(0, 3), ['pitch', 'gate', 'deesser']);
});

test('stem names resolve to kinds', () => {
  assert.equal(stemKind('Vocals'), 'vocals'); assert.equal(stemKind('hi-hat'), 'hats'); assert.equal(stemKind('808'), 'sub808');
  assert.equal(stemKind('Snare / clap'), 'snare'); assert.equal(stemKind('lead vocal'), 'vocals'); assert.equal(stemKind('weird'), 'other');
});

test('every module in every desktop chain has a spec and an engine', () => {
  for (const k of Object.keys(STEM_KINDS)) for (const t of chainModules(k)) { assert.ok(MODULES[t], t); assert.ok(FX_TYPES[t], t); }
  for (const t of Object.keys(MODULES)) assert.ok(FX_TYPES[t], `engine for ${t}`);
});

test('every preset of every stem kind builds and renders finite, non-silent audio', () => {
  const [L0, R0] = src(); let count = 0;
  for (const kind of Object.keys(STEM_KINDS)) {
    for (const p of presetsFor(kind)) {
      const chain = new Chain(SR, chainFromPreset(kind, p));
      const L = L0.slice(), R = R0.slice();
      for (let i = 0; i < L.length; i += 128) chain.process(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, L.length - i));
      for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) assert.fail(`${kind}/${p.id} NaN`);
      const lat = chain.latency;
      assert.ok(rms(L, SR / 2, SR * 2 - 1) > 1e-3, `${kind}/${p.id} silent`);
      assert.ok(lat >= 0);
      count++;
    }
  }
  assert.ok(count > 150, `${count} preset renders`);
});

test('desktop preset resolution honours intent (phaser percent mix, eq freq, reverb mix)', () => {
  const drums = presetsFor('drums').find((p) => p.id === 'desktop:drum_phaser');
  assert.equal(drums.chain.find((m) => m.type === 'phaser').params.mix, 0.4);
  const kick = presetsFor('drums').find((p) => p.id === 'desktop:drum_kick');
  assert.equal(kick.chain.find((m) => m.type === 'eq').params.freq_mid, 250);
  const wide = presetsFor('drums').find((p) => p.id === 'desktop:drum_wide');
  assert.equal(wide.chain.find((m) => m.type === 'reverb').params.wet, 20);
  // chain order follows the desktop's order for the stem
  assert.deepEqual(blankChain('vocals').map((m) => m.type), DESKTOP.STEM_FX_CHAINS.vocals);
  assert.ok(defaultParams('compressor').attack === 10);
});
