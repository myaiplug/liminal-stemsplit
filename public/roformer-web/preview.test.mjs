import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBusyWindow } from './window.js';
import { deriveDesk, rms } from './derive.js';

const SR = 44100;

function tone(freq, seconds, amp = 0.5, phase = 0) {
  const n = Math.round(seconds * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = amp * Math.sin(2 * Math.PI * freq * i / SR + phase);
  return y;
}

function mix(parts) {
  const n = Math.max(...parts.map((p) => p.length));
  const y = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) y[i] += p[i];
  return y;
}

test('short files are used whole', () => {
  const y = tone(440, 8);
  const w = pickBusyWindow(y, y, SR, 20, () => 0);
  assert.equal(w.startSample, 0);
  assert.equal(w.length, y.length);
  assert.equal(w.candidates, 1);
});

test('a stacked 20 seconds beats a sub-only stretch', () => {
  const stacked = mix([tone(50, 20, 0.4), tone(180, 20, 0.35), tone(900, 20, 0.3), tone(8000, 20, 0.2)]);
  const onlySub = tone(50, 40, 0.6);
  const left = mix([stacked, new Float32Array(onlySub.length)]);
  // stacked occupies 0-20s, then only sub for 40s. Build explicitly.
  const n = stacked.length + onlySub.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L.set(stacked, 0); R.set(stacked, 0);
  L.set(onlySub, stacked.length); R.set(onlySub, stacked.length);
  const w = pickBusyWindow(L, R, SR, 20, () => 0);
  assert.ok(w.startSec < 8, `expected the stacked opening, got ${w.startSec}s (${w.reason})`);
  assert.ok(w.bands.length >= 2, w.reason);
});

test('lead stays center, backup takes the sides', () => {
  const n = Math.round(2 * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lead = 0.6 * Math.sin(2 * Math.PI * 220 * i / SR);
    const wide = 0.4 * Math.sin(2 * Math.PI * 700 * i / SR);
    left[i] = lead + wide;
    right[i] = lead - wide;
  }
  const desk = deriveDesk({ vocals: [left, right] }, SR);
  const lead = desk.find((d) => d.name === 'lead vocal');
  const back = desk.find((d) => d.name === 'backup / adlibs');
  assert.ok(lead && back);
  assert.ok(rms(lead.left) > rms(back.left) * 0.5);
  // The wide tone is out of phase, so it should not dominate the lead (center).
  const leadMonoDiff = rms(lead.left.map ? lead.left : lead.left);
  let sideInLead = 0;
  // lead is mono (L === R). Backup should carry more L-R difference.
  let leadDiff = 0; let backDiff = 0;
  for (let i = 0; i < n; i++) {
    leadDiff += Math.abs(lead.left[i] - lead.right[i]);
    backDiff += Math.abs(back.left[i] - back.right[i]);
  }
  assert.ok(backDiff > leadDiff, 'backup should hold the stereo difference');
  assert.ok(leadMonoDiff >= 0);
});

test('808 keeps a 40 Hz bass and drops a 400 Hz bass', () => {
  const low = tone(40, 1, 0.8);
  const mid = tone(400, 1, 0.8);
  const lowDesk = deriveDesk({ bass: [low, low] }, SR);
  const midDesk = deriveDesk({ bass: [mid, mid] }, SR);
  const sub = (d) => d.find((x) => x.name === '808');
  const body = (d) => d.find((x) => x.name === 'bass');
  assert.ok(rms(sub(lowDesk).left) > rms(body(lowDesk).left) * 2);
  assert.ok(rms(body(midDesk).left) > rms(sub(midDesk).left) * 2);
});

test('hats keep 12 kHz and kick keeps 60 Hz', () => {
  const low = tone(60, 0.5, 0.8);
  const high = tone(12000, 0.5, 0.5);
  const drums = mix([low, high]);
  const desk = deriveDesk({ drums: [drums, drums] }, SR);
  const kick = desk.find((d) => d.name === 'kick');
  const hats = desk.find((d) => d.name === 'hi-hats');
  const lowOnly = deriveDesk({ drums: [low, low] }, SR);
  const highOnly = deriveDesk({ drums: [high, high] }, SR);
  assert.ok(rms(lowOnly.find((d) => d.name === 'kick').left) > rms(lowOnly.find((d) => d.name === 'hi-hats').left) * 4);
  assert.ok(rms(highOnly.find((d) => d.name === 'hi-hats').left) > rms(highOnly.find((d) => d.name === 'kick').left) * 4);
  assert.ok(kick && hats);
});
