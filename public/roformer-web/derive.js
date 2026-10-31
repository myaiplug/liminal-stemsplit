/**
 * Cut extra lanes out of stems the RoFormer already made.
 *
 * This is not a second neural model. Lead / backup come from the vocal stem
 * (center vs width, plus gaps where the lead is quiet). 808 is the sub of the
 * bass stem. Kick, snare/clap, hats, crash and perk are band cuts of the drum
 * stem. Levels are left as the filters make them so a quiet lane stays quiet.
 */

function coeff(type, sr, freq, q) {
  const w0 = 2 * Math.PI * freq / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'hp') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function filt(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

function twice(x, c) { return filt(filt(x, c), c); }

function add(a, b) {
  const y = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) y[i] = a[i] + (b[i] || 0);
  return y;
}

function envFollow(x, sr, sec) {
  const a = Math.exp(-1 / (sr * sec));
  const e = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    s = v > s ? v : s * a;
    e[i] = s;
  }
  return e;
}

function splitVoice(L, R, sr) {
  const n = L.length;
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mid[i] = 0.5 * (L[i] + R[i]);
    side[i] = 0.5 * (L[i] - R[i]);
  }
  const lead = twice(mid, coeff('hp', sr, 110, 0.707));
  const env = envFollow(lead, sr, 0.03);
  let peak = 1e-8;
  for (let i = 0; i < n; i++) if (env[i] > peak) peak = env[i];
  const backL = new Float32Array(n);
  const backR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gap = env[i] < peak * 0.18 ? 1 : 0;
    backL[i] = side[i] + gap * L[i];
    backR[i] = -side[i] + gap * R[i];
  }
  return { leadL: lead, leadR: lead, backL, backR };
}

function splitLow(L, R, sr) {
  const lp = coeff('lp', sr, 90, 0.707);
  const hp = coeff('hp', sr, 90, 0.707);
  return {
    subL: twice(L, lp), subR: twice(R, lp),
    bodyL: twice(L, hp), bodyR: twice(R, hp),
  };
}

function splitDrums(L, R, sr) {
  const kickC = coeff('lp', sr, 140, 0.75);
  const hatC = coeff('hp', sr, 8000, 0.707);
  const snareLow = coeff('bp', sr, 220, 1.1);
  const snareHi = coeff('bp', sr, 2200, 0.8);
  const crashC = coeff('bp', sr, 4500, 0.6);
  const perkC = coeff('bp', sr, 900, 0.7);
  const kickL = twice(L, kickC);
  const kickR = twice(R, kickC);
  const hatL = twice(L, hatC);
  const hatR = twice(R, hatC);
  const snL = add(filt(L, snareLow), filt(L, snareHi));
  const snR = add(filt(R, snareLow), filt(R, snareHi));
  return {
    kickL, kickR, hatL, hatR, snL, snR,
    crashL: filt(L, crashC), crashR: filt(R, crashC),
    perkL: filt(L, perkC), perkR: filt(R, perkC),
  };
}

const VOICE_NOTE = 'Cut from the vocal stem in this browser. Not a second neural model. Centered doubles stay with the lead.';
const LOW_NOTE = 'Cut from the bass stem. 808 is everything under about 90 Hz.';
const DRUM_NOTE = 'Band cut of the drum stem. Overlap between pieces is expected.';

/**
 * @param {Record<string, [Float32Array, Float32Array]>} stems
 * @param {number} [sampleRate]
 * @returns {{name:string, group:string, note:string, left:Float32Array, right:Float32Array}[]}
 */
export function deriveDesk(stems, sampleRate = 44100) {
  const out = [];
  if (stems.vocals) {
    const [L, R] = stems.vocals;
    const v = splitVoice(L, R, sampleRate);
    out.push({ name: 'lead vocal', group: 'From the vocal stem', note: VOICE_NOTE, left: v.leadL, right: v.leadR });
    out.push({ name: 'backup / adlibs', group: 'From the vocal stem', note: VOICE_NOTE, left: v.backL, right: v.backR });
  }
  if (stems.bass) {
    const [L, R] = stems.bass;
    const b = splitLow(L, R, sampleRate);
    out.push({ name: '808', group: 'From the bass stem', note: LOW_NOTE, left: b.subL, right: b.subR });
    out.push({ name: 'bass', group: 'From the bass stem', note: LOW_NOTE, left: b.bodyL, right: b.bodyR });
  }
  if (stems.guitar) {
    const [L, R] = stems.guitar;
    out.push({ name: 'guitar', group: 'Model stem', note: 'Guitar stem from the 6-stem model. Not a filter.', left: L, right: R });
  }
  if (stems.piano) {
    const [L, R] = stems.piano;
    out.push({ name: 'piano', group: 'Model stem', note: 'Piano stem from the 6-stem model. Not a filter.', left: L, right: R });
  }
  if (stems.drums) {
    const [L, R] = stems.drums;
    const d = splitDrums(L, R, sampleRate);
    const g = 'From the drum stem';
    out.push({ name: 'kick', group: g, note: DRUM_NOTE, left: d.kickL, right: d.kickR });
    out.push({ name: 'snare / clap', group: g, note: DRUM_NOTE, left: d.snL, right: d.snR });
    out.push({ name: 'hi-hats', group: g, note: DRUM_NOTE, left: d.hatL, right: d.hatR });
    out.push({ name: 'crash', group: g, note: DRUM_NOTE, left: d.crashL, right: d.crashR });
    out.push({ name: 'perk', group: g, note: DRUM_NOTE, left: d.perkL, right: d.perkR });
  }
  return out;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

export { rms, splitVoice, splitLow, splitDrums };
