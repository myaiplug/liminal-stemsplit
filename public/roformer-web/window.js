/**
 * Pick a 20 second stretch that actually has more than one part in it.
 *
 * The neural models do not tell us "there are stems here" before they run, so
 * this scores short blocks of the mix itself: sub (808), low (kick / bass),
 * mid (vocal / snare), high (hats). A window only ranks if those bands are
 * present together. Among the top-scoring windows, one is chosen at random.
 *
 * No DOM. Safe to unit-test in Node.
 */

const SR_BANDS = [
  { id: 'sub', label: '808 / sub', f: 50, q: 1.1 },
  { id: 'low', label: 'kick / bass', f: 130, q: 0.85 },
  { id: 'mid', label: 'vocal / snare', f: 900, q: 0.55 },
  { id: 'high', label: 'hats', f: 8000, q: 0.7 },
];

function biquadBP(sr, freq, q) {
  const w0 = 2 * Math.PI * freq / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Sum of squares of a bandpass, in blocks of `hop` samples. */
function blockPower(left, right, n, sr, band, hop) {
  const c = biquadBP(sr, band.f, band.q);
  const blocks = Math.ceil(n / hop);
  const out = new Float32Array(blocks);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let acc = 0;
  let filled = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const x = 0.5 * ((left[i] || 0) + (right[i] || 0));
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    acc += y * y;
    filled++;
    if (filled === hop) {
      out[b++] = acc / hop;
      acc = 0;
      filled = 0;
    }
  }
  if (filled && b < blocks) out[b] = acc / filled;
  return out;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate
 * @param {number} [seconds]
 * @param {() => number} [rng]
 */
export function pickBusyWindow(left, right, sampleRate, seconds = 20, rng = Math.random) {
  const n = Math.min(left.length, right.length);
  const win = Math.min(n, Math.max(1, Math.round(seconds * sampleRate)));
  if (n <= win + Math.round(sampleRate)) {
    return {
      startSample: 0,
      length: n,
      startSec: 0,
      seconds: n / sampleRate,
      candidates: 1,
      bands: [],
      reason: 'The whole file is the preview. It is shorter than 20 seconds.',
    };
  }

  const hop = Math.max(1, Math.round(sampleRate * 0.5));
  const powers = SR_BANDS.map((band) => blockPower(left, right, n, sampleRate, band, hop));
  const winBlocks = Math.max(1, Math.round(win / hop));
  const stepBlocks = Math.max(1, Math.round((5 * sampleRate) / hop));
  const totalBlocks = powers[0].length;

  const candidates = [];
  for (let b = 0; b + winBlocks <= totalBlocks; b += stepBlocks) {
    const means = powers.map((p) => {
      let s = 0;
      for (let i = 0; i < winBlocks; i++) s += p[b + i];
      return s / winBlocks;
    });
    let geo = 1;
    let sum = 0;
    let max = 0;
    for (const v of means) {
      geo *= Math.max(v, 1e-12);
      sum += v;
      if (v > max) max = v;
    }
    geo = geo ** (1 / means.length);
    const dominance = sum > 0 ? max / sum : 1;
    // Geometric mean rewards every band being present. Dominance penalty
    // drops a window that is only sub, or only hats.
    const score = geo * (1.2 - dominance);
    candidates.push({ block: b, means, score });
  }

  const ranked = candidates.map((c) => c.score).sort((a, b) => a - b);
  const cut = ranked[Math.floor(ranked.length * 0.75)] ?? 0;
  let pool = candidates.filter((c) => c.score >= cut && c.score > 0);
  if (!pool.length) pool = candidates;
  const chosen = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];

  const maxMean = Math.max(...chosen.means, 0);
  const present = [];
  SR_BANDS.forEach((band, i) => {
    if (maxMean > 0 && chosen.means[i] >= maxMean * 0.22) present.push(band.label);
  });

  const startSample = Math.min(chosen.block * hop, n - win);
  const startSec = startSample / sampleRate;
  const reason = present.length >= 2
    ? `This stretch has ${present.join(', ')} in the same ${Math.round(seconds)} seconds.`
    : `No stretch clearly stacked several parts. Using ${fmtClock(startSec)} anyway.`;

  return {
    startSample,
    length: win,
    startSec,
    seconds: win / sampleRate,
    candidates: pool.length,
    bands: present,
    reason,
  };
}

export { fmtClock };
