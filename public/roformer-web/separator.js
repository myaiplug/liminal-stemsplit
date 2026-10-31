/**
 * Backend-agnostic chunking / overlap-add driver.
 *
 *   separateTrack({ adapter, run, left, right, overlap, onChunk, isCancelled })
 *
 * `run(feeds)` executes one model forward pass and resolves to
 * { outputName: Float32Array }. Everything else (STFT, masking, iSTFT,
 * cross-fading, normalising) happens here so it can be unit-tested in Node
 * with onnxruntime and shipped unchanged in a Web Worker.
 */

export class CancelledError extends Error {
  constructor() { super('Separation cancelled'); this.name = 'CancelledError'; }
}

/** Start offsets of every chunk (the last one is end-aligned so it holds real audio). */
export function planChunks(totalSamples, chunkSamples, overlapSamples) {
  const step = chunkSamples - overlapSamples;
  const starts = [0];
  let s = 0;
  while (s + chunkSamples < totalSamples) {
    s = Math.min(s + step, totalSamples - chunkSamples);
    starts.push(s);
  }
  return starts;
}

function rms(a, n) {
  let e = 0;
  for (let i = 0; i < n; i++) e += a[i] * a[i];
  return Math.sqrt(e / Math.max(1, n));
}

export async function separateTrack({
  adapter, run, left, right, overlap = 0.25, onChunk, isCancelled, sanityCheck,
}) {
  const N = left.length;
  const C = adapter.chunkSamples;
  const ov = Math.min(Math.floor(C * overlap), C - 1);
  const starts = planChunks(N, C, ov);
  const total = starts.length;

  const acc = {}; // name -> [Float32Array, Float32Array]
  const wsum = new Float32Array(N);
  const bufL = new Float32Array(C);
  const bufR = new Float32Array(C);
  let sanityDone = false;
  const t0 = Date.now();

  for (let i = 0; i < total; i++) {
    if (isCancelled?.()) throw new CancelledError();
    const start = starts[i];
    const len = Math.min(C, N - start);
    bufL.fill(0); bufR.fill(0);
    bufL.set(left.subarray(start, start + len));
    bufR.set(right.subarray(start, start + len));

    const { feeds, ctx } = adapter.prepare(bufL.slice(), bufR.slice());
    const outputs = await run(feeds);
    const stems = adapter.finish(outputs, ctx);

    if (!sanityDone && sanityCheck && rms(bufL, len) > 1e-3) {
      sanityDone = true;
      sanityCheck({ input: [bufL, bufR], stems, len });
    }

    // Weights: linear cross-fades, no fade on the outer edges of the track.
    const fadeIn = i > 0 ? ov : 0;
    const fadeOut = i < total - 1 ? ov : 0;
    const w = (j) => {
      let v = 1;
      if (j < fadeIn) v = (j + 1) / (fadeIn + 1);
      const k = C - 1 - j; // distance from the end of the chunk
      if (k < fadeOut) v = Math.min(v, (k + 1) / (fadeOut + 1));
      return v;
    };
    for (const [name, [sl, sr]] of Object.entries(stems)) {
      if (!acc[name]) acc[name] = [new Float32Array(N), new Float32Array(N)];
      const [al, ar] = acc[name];
      for (let j = 0; j < len; j++) {
        const wj = w(j);
        al[start + j] += sl[j] * wj;
        ar[start + j] += sr[j] * wj;
      }
    }
    for (let j = 0; j < len; j++) wsum[start + j] += w(j);

    const done = i + 1;
    const elapsed = Date.now() - t0;
    onChunk?.({ done, total, elapsedMs: elapsed, etaMs: (elapsed / done) * (total - done) });
    // Let the event loop breathe (progress messages, cancel).
    await new Promise((r) => setTimeout(r, 0));
  }

  for (const [al, ar] of Object.values(acc)) {
    for (let j = 0; j < N; j++) {
      const inv = wsum[j] > 0 ? 1 / wsum[j] : 0;
      al[j] *= inv; ar[j] *= inv;
    }
  }
  return { stems: acc, chunks: total };
}
