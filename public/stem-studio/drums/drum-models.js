/**
 * Drum-separation model descriptor (same shape as roformer-web/models.js entries so model-store.getModelFiles can fetch,
 * verify and OPFS-cache it).
 *
 * The weights are gridshiftstudio/drumsep-onnx v2 (MIT), a fine-tune of inagoy/drumsep (Demucs, MIT). The ONNX we ship is a
 * re-export of those exact weights: the upstream file has a fixed 40 s window (4-6 GB RAM, not runnable in a browser), so
 * scripts/drumsep/ rebuilds the HDemucs in PyTorch from the ONNX initializers and exports a 10 s window with fp16-stored
 * weights (Cast -> fp32 at run time, 168 MB). Output parity vs the 40 s original: see docs/stem-studio-drums.md.
 *
 * HOSTING: Hugging Face model repo https://huggingface.co/b33zy/drumsep-v2-onnx, pinned to commit 592d7cc503b4adb75b6a9ef5514fe6bbe40367d3
 * (immutable resolve URL; the worker verifies the sha256 after download and caches the file in OPFS). HF serves
 * Access-Control-Allow-Origin and Range. Override order: 1. ?drummodel=<url> on the page URL  2. globalThis.STEM_STUDIO_DRUM_MODEL_URL
 * 3. the pinned HF URL.  (A local ./models/<file> copy is still used for offline dev via ?drummodel=./models/drumsep_v2_w10_f16w.onnx.)
 */
export const DRUM_MODEL_FILE = 'drumsep_v2_w10_f16w.onnx';
export const DRUM_MODEL_HF_REPO = 'b33zy/drumsep-v2-onnx';
export const DRUM_MODEL_HF_COMMIT = '592d7cc503b4adb75b6a9ef5514fe6bbe40367d3';
export const DRUM_MODEL_PINNED_URL = `https://huggingface.co/${DRUM_MODEL_HF_REPO}/resolve/${DRUM_MODEL_HF_COMMIT}/${DRUM_MODEL_FILE}`;
export const DRUM_MODEL_SHA256 = 'b05779ea756870f3fe359c63ac501dd12caf3b24d66237b1404bb4dd5b32839a';
export const DRUM_MODEL_BYTES = 168050967;

export function drumModelUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('drummodel');
    if (q) return new URL(q, globalThis.location.href).href;
  } catch { /* ignore */ }
  if (globalThis.STEM_STUDIO_DRUM_MODEL_URL) return new URL(globalThis.STEM_STUDIO_DRUM_MODEL_URL, globalThis.location?.href || import.meta.url).href;
  return DRUM_MODEL_PINNED_URL;
}

export function drumModel() {
  return {
    id: 'drumsep-v2-w10',
    adapter: 'hdemucs-drumsep',
    label: 'DrumSep v2 (kick · snare · cymbals · toms)',
    stems: ['kick', 'snare', 'cymbals', 'toms'],
    sampleRate: 44100,
    window: 441000,
    overlap: 0.5,
    sizeBytes: DRUM_MODEL_BYTES,
    files: [{ role: 'model', name: DRUM_MODEL_FILE, url: drumModelUrl(), bytes: DRUM_MODEL_BYTES, sha256: DRUM_MODEL_SHA256 }],
    license: {
      spdx: 'MIT',
      name: 'MIT (gridshiftstudio/drumsep-onnx, inagoy/drumsep)',
      url: 'https://huggingface.co/gridshiftstudio/drumsep-onnx',
      note: 'MIT covers the weights and code. Training data of v2 = the author\'s own one-shots + Magenta Groove MIDI (CC BY 4.0); we could not independently audit that provenance.',
      caveat: 'training-data provenance not independently verified; toms and cymbals are the weakest outputs',
    },
  };
}

/**
 * HT-RoFormer 6-stem drum model (Sucial/drumsep-ht-roformer): kick, snare, hi-hat, toms, cymbals, other.
 *
 * LICENCE: the author has published NO licence for these weights (checked 2026-11-16), so the browser build is
 * NOT hosted by us and this option stays "unavailable" until a URL is configured. The ONNX is produced locally from the
 * author's checkpoint with scripts/drumsep/htr_export.py + f16w.py (host-side STFT, fp16-stored weights, 377.5 MB).
 * Once the author grants permission, upload that exact file somewhere CORS-enabled (e.g. a Hugging Face repo) and set
 * DRUM_HTR_DEFAULT_URL below (or pass ?drummodel_htr=<url> / globalThis.STEM_STUDIO_DRUM_HTR_URL). The worker checks the
 * SHA-256, so a file exported with a different torch version needs DRUM_HTR_SHA256 / DRUM_HTR_BYTES updated too.
 */
export const DRUM_HTR_FILE = 'drumsep_htr_core_f16w.onnx';
export const DRUM_HTR_DEFAULT_URL = null; // set after the author grants permission to redistribute
export const DRUM_HTR_SHA256 = 'f1802cfb113ef4b13fd3be5ac4130517b22247bab6138421e24f322a5dbcc008';
export const DRUM_HTR_BYTES = 377528839;

export function drumHtrUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('drummodel_htr');
    if (q) return new URL(q, globalThis.location.href).href;
  } catch { /* ignore */ }
  if (globalThis.STEM_STUDIO_DRUM_HTR_URL) return new URL(globalThis.STEM_STUDIO_DRUM_HTR_URL, globalThis.location?.href || import.meta.url).href;
  return DRUM_HTR_DEFAULT_URL;
}

export function drumModelHtr() {
  const url = drumHtrUrl();
  return {
    id: 'drumsep-ht-roformer',
    adapter: 'ht-roformer-drums',
    label: 'HT-RoFormer (kick · snare · hi-hat · toms · cymbals · perc)',
    stems: ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'other'],
    sampleRate: 44100,
    window: 266240,
    overlap: 0.5,
    sizeBytes: DRUM_HTR_BYTES,
    configured: !!url,
    files: [{ role: 'model', name: DRUM_HTR_FILE, url: url || '', bytes: DRUM_HTR_BYTES, sha256: DRUM_HTR_SHA256 }],
    license: {
      spdx: 'NONE',
      name: 'No licence published (Sucial/drumsep-ht-roformer)',
      url: 'https://huggingface.co/Sucial/drumsep-ht-roformer',
      note: 'The author has not published a licence for the weights. Treat as all rights reserved: personal testing only until the author gives written permission to redistribute it and to use it in a paid product.',
      caveat: 'no licence; needs the author\'s permission before it is hosted or sold',
    },
  };
}

/** model descriptor by id ('drumsep-v2-w10' default, 'drumsep-ht-roformer') */
export const drumModelById = (id) => (id === 'drumsep-ht-roformer' ? drumModelHtr() : drumModel());
