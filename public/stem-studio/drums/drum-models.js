/**
 * Drum-separation model descriptor (same shape as roformer-web/models.js entries so model-store.getModelFiles can fetch,
 * verify and OPFS-cache it).
 *
 * The weights are gridshiftstudio/drumsep-onnx v2 (MIT), a fine-tune of inagoy/drumsep (Demucs, MIT). The ONNX we ship is a
 * re-export of those exact weights: the upstream file has a fixed 40 s window (4-6 GB RAM, not runnable in a browser), so
 * scripts/drumsep/ rebuilds the HDemucs in PyTorch from the ONNX initializers and exports a 10 s window with fp16-stored
 * weights (Cast -> fp32 at run time, 168 MB). Output parity vs the 40 s original: see docs/stem-studio-drums.md.
 *
 * HOSTING: the file is not hosted anywhere yet (publishing it is an owner decision). Until then it is looked up, in order, at
 *   1. ?drummodel=<url> on the page URL     2. globalThis.STEM_STUDIO_DRUM_MODEL_URL     3. ./models/drumsep_v2_w10_f16w.onnx
 * and the UI reports "not available" (and offers the DSP-only split) when none of them answers.
 */
export const DRUM_MODEL_FILE = 'drumsep_v2_w10_f16w.onnx';
export const DRUM_MODEL_SHA256 = 'b05779ea756870f3fe359c63ac501dd12caf3b24d66237b1404bb4dd5b32839a';
export const DRUM_MODEL_BYTES = 168050967;

export function drumModelUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('drummodel');
    if (q) return new URL(q, globalThis.location.href).href;
  } catch { /* ignore */ }
  if (globalThis.STEM_STUDIO_DRUM_MODEL_URL) return new URL(globalThis.STEM_STUDIO_DRUM_MODEL_URL, globalThis.location?.href || import.meta.url).href;
  return new URL(`./models/${DRUM_MODEL_FILE}`, import.meta.url).href;
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
