/**
 * Lead / backing vocal model: Mel-Band RoFormer Karaoke (aufr33 & viperx), WebGPU-friendly ONNX re-export
 * https://huggingface.co/Acapellas/mel-band-roformer-karaoke-webgpu  (MIT model card), pinned to an immutable commit.
 * Downloaded at runtime, SHA-256 checked and cached in OPFS by roformer-web/model-store.js; never stored in this repo.
 * Override: ?karaokemodel=<url> or globalThis.STEM_STUDIO_KARAOKE_MODEL_URL (must be the same bytes, same SHA-256).
 */
export const KARAOKE_HF_REPO = 'Acapellas/mel-band-roformer-karaoke-webgpu';
export const KARAOKE_HF_COMMIT = 'b29e3d08412be87e75aa5a30989a248013e39966';
export const KARAOKE_FILE = 'model_fp16.onnx';
export const KARAOKE_SHA256 = 'a733bd2319e736d0f11483bcb655997c889e3c41536b01c2409df31fe4b71b3e';
export const KARAOKE_BYTES = 460432035;
export const KARAOKE_PINNED_URL = `https://huggingface.co/${KARAOKE_HF_REPO}/resolve/${KARAOKE_HF_COMMIT}/${KARAOKE_FILE}`;

export function karaokeModelUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('karaokemodel');
    if (q) return new URL(q, globalThis.location.href).href;
  } catch { /* ignore */ }
  if (globalThis.STEM_STUDIO_KARAOKE_MODEL_URL) return new URL(globalThis.STEM_STUDIO_KARAOKE_MODEL_URL, globalThis.location?.href || import.meta.url).href;
  return KARAOKE_PINNED_URL;
}

export function karaokeModel() {
  return {
    id: 'mbr-karaoke-fp16',
    adapter: 'mel-band-karaoke',
    label: 'Mel-Band RoFormer Karaoke (lead / backing)',
    stems: ['lead', 'backing'],
    sampleRate: 44100,
    sizeBytes: KARAOKE_BYTES,
    files: [{ role: 'model', name: KARAOKE_FILE, url: karaokeModelUrl(), bytes: KARAOKE_BYTES, sha256: KARAOKE_SHA256 }],
    license: {
      spdx: 'MIT',
      name: 'MIT (Acapellas ONNX re-export of the aufr33/viperx karaoke Mel-Band RoFormer)',
      url: 'https://huggingface.co/Acapellas/mel-band-roformer-karaoke-webgpu',
      note: 'The MIT licence on the model card covers the ONNX re-export. The original aufr33/viperx training checkpoint was shared without a stated licence, the same caveat as the BS-RoFormer-SW model.',
    },
  };
}
