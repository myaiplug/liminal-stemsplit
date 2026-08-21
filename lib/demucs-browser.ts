/**
 * Real HTDemucs 6-stem separation in the browser.
 * Model: StemSplitio/htdemucs-6s-onnx (fp16weights, ~130 MB)
 * Runs fully local via onnxruntime-web. No server. No upload.
 *
 * Stems (exact order): drums, bass, other, vocals, guitar, piano
 */

import * as ort from "onnxruntime-web";

export const DEMUCS_SOURCES = [
  "drums",
  "bass",
  "other",
  "vocals",
  "guitar",
  "piano",
] as const;

export type DemucsStem = (typeof DEMUCS_SOURCES)[number];

export type DemucsPack = Record<DemucsStem, Float32Array[]>;

const SAMPLE_RATE = 44100;
const SEGMENT_S = 7.8;
const N_SAMPLES = Math.round(SEGMENT_S * SAMPLE_RATE);
const N_CHANNELS = 2;
const OVERLAP = Math.floor(N_SAMPLES / 4);
const STRIDE = N_SAMPLES - OVERLAP;
const N_STEMS = 6;

export const DEMUCS_MODEL_URL =
  "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx";

const CACHE_NAME = "nodaw-demucs-v1";

export type DemucsProgress = {
  phase: "download" | "load" | "separate" | "done";
  ratio: number;
  detail?: string;
};

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function fetchModelCached(
  url: string,
  onProgress?: (p: DemucsProgress) => void,
): Promise<ArrayBuffer> {
  if (typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      onProgress?.({ phase: "download", ratio: 1, detail: "From cache" });
      return hit.arrayBuffer();
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);

  const total = Number(res.headers.get("content-length") || 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (typeof caches !== "undefined") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, new Response(buf.slice(0)));
    }
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      onProgress?.({
        phase: "download",
        ratio: Math.min(0.99, received / total),
        detail: `${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(0)} MB`,
      });
    }
  }

  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const buf = merged.buffer;

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, new Response(buf.slice(0)));
    } catch {
      /* quota */
    }
  }

  onProgress?.({ phase: "download", ratio: 1, detail: "Download complete" });
  return buf;
}

export async function loadDemucsSession(
  onProgress?: (p: DemucsProgress) => void,
): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    onProgress?.({ phase: "download", ratio: 0, detail: "HTDemucs 6s · ~130 MB" });
    const modelBuf = await fetchModelCached(DEMUCS_MODEL_URL, onProgress);

    onProgress?.({ phase: "load", ratio: 0, detail: "Building WASM session" });
    ort.env.wasm.numThreads = Math.min(
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2,
      4,
    );
    ort.env.wasm.simd = true;

    const providers: string[] = [];
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      providers.push("webgpu");
    }
    providers.push("wasm");

    const session = await ort.InferenceSession.create(modelBuf, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
    onProgress?.({ phase: "load", ratio: 1, detail: `Backend ready` });
    return session;
  })().catch((err) => {
    sessionPromise = null;
    throw err;
  });

  return sessionPromise;
}

function makeTransitionWindow(segment: number, overlap: number): Float32Array {
  const w = new Float32Array(segment);
  w.fill(1);
  for (let i = 0; i < overlap; i++) {
    const v = i / overlap;
    w[i] = v;
    w[segment - 1 - i] = v;
  }
  return w;
}

export async function separateDemucs(
  left: Float32Array,
  right: Float32Array,
  onProgress?: (p: DemucsProgress) => void,
): Promise<DemucsPack> {
  if (left.length !== right.length) {
    throw new Error("Channel length mismatch");
  }

  const session = await loadDemucsSession(onProgress);
  const totalLen = left.length;
  const nChunks = Math.max(1, Math.ceil(totalLen / STRIDE));
  const window = makeTransitionWindow(N_SAMPLES, OVERLAP);

  const out: Float32Array[][] = DEMUCS_SOURCES.map(() => [
    new Float32Array(totalLen),
    new Float32Array(totalLen),
  ]);
  const weight = new Float32Array(totalLen);
  const chunkBuf = new Float32Array(1 * N_CHANNELS * N_SAMPLES);

  for (let i = 0; i < nChunks; i++) {
    const start = i * STRIDE;
    const end = Math.min(start + N_SAMPLES, totalLen);
    const chunkLen = end - start;

    chunkBuf.fill(0);
    chunkBuf.set(left.subarray(start, end), 0);
    chunkBuf.set(right.subarray(start, end), N_SAMPLES);

    const inputTensor = new ort.Tensor("float32", chunkBuf, [
      1,
      N_CHANNELS,
      N_SAMPLES,
    ]);
    const result = await session.run({ mix: inputTensor });
    const stems = result.stems.data as Float32Array;

    for (let stem = 0; stem < N_STEMS; stem++) {
      for (let ch = 0; ch < N_CHANNELS; ch++) {
        const rowStart = (stem * N_CHANNELS + ch) * N_SAMPLES;
        const dest = out[stem][ch];
        for (let s = 0; s < chunkLen; s++) {
          dest[start + s] += stems[rowStart + s] * window[s];
        }
      }
    }
    for (let s = 0; s < chunkLen; s++) {
      weight[start + s] += window[s];
    }

    onProgress?.({
      phase: "separate",
      ratio: (i + 1) / nChunks,
      detail: `Chunk ${i + 1} / ${nChunks}`,
    });

    await new Promise((r) => setTimeout(r, 0));
  }

  for (let stem = 0; stem < N_STEMS; stem++) {
    for (let ch = 0; ch < N_CHANNELS; ch++) {
      const dest = out[stem][ch];
      for (let s = 0; s < totalLen; s++) {
        dest[s] /= Math.max(weight[s], 1e-8);
      }
    }
  }

  const pack = {} as DemucsPack;
  DEMUCS_SOURCES.forEach((name, i) => {
    pack[name] = out[i];
  });

  onProgress?.({ phase: "done", ratio: 1, detail: "Six stems ready" });
  return pack;
}

export async function decodeForDemucs(
  file: Blob,
): Promise<{ left: Float32Array; right: Float32Array; duration: number }> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const ab = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(ab.slice(0));
    const len = audio.length;
    const left = new Float32Array(len);
    const right = new Float32Array(len);
    left.set(audio.getChannelData(0));
    if (audio.numberOfChannels > 1) {
      right.set(audio.getChannelData(1));
    } else {
      right.set(left);
    }
    if (audio.sampleRate !== SAMPLE_RATE) {
      const frames = Math.ceil(audio.duration * SAMPLE_RATE);
      const offline = new OfflineAudioContext(2, frames, SAMPLE_RATE);
      const src = offline.createBufferSource();
      src.buffer = audio;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      const L = new Float32Array(rendered.length);
      const R = new Float32Array(rendered.length);
      L.set(rendered.getChannelData(0));
      R.set(
        rendered.numberOfChannels > 1
          ? rendered.getChannelData(1)
          : rendered.getChannelData(0),
      );
      return { left: L, right: R, duration: rendered.duration };
    }
    return { left, right, duration: audio.duration };
  } finally {
    await ctx.close();
  }
}

export function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate = SAMPLE_RATE,
): Blob {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const view = new DataView(buf);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + n * 4, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, n * 4, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of [left, right]) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
