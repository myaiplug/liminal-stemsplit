/**
 * Single place to configure everything about the in-browser separation models.
 *
 *  - Model files are NOT in git. They are fetched at runtime from the Hugging
 *    Face CDN (CORS enabled), verified against the SHA-256 below, and cached
 *    in the browser (Cache API) so they download once.
 *  - URLs are pinned to an exact Hugging Face commit so a re-upload upstream
 *    can't silently change what runs on the site. To follow `main` instead,
 *    change `revision` to 'main' and set `sha256` to null.
 *  - onnxruntime-web (MIT) is loaded from the jsDelivr CDN, pinned. To
 *    self-host, copy dist/ort.webgpu.min.mjs + the ort-wasm-simd-threaded.*
 *    files somewhere and change ORT_MODULE_URL / ORT_WASM_BASE.
 *
 * Licenses are recorded in NOTICE.md (and THIRD_PARTY_* at the repo root).
 */

export const ORT_VERSION = '1.30.0';
export const ORT_MODULE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.webgpu.min.mjs`;
export const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

/** Name of the Cache Storage bucket the model files live in. */
export const MODEL_CACHE_NAME = 'roformer-web-models-v1';

const hf = (repo, revision, path) => `https://huggingface.co/${repo}/resolve/${revision}/${path}`;

const MB = 1000 * 1000;

export const MODELS = {
  mini: {
    id: 'mini',
    adapter: 'mini',
    label: 'Fast preview',
    short: '4 stems · Mini-BS-RoFormer',
    description: 'Quick draft split into vocals, drums, bass and other. Smallest download, fastest — good for auditioning a track or checking a split before committing to the big model.',
    stems: ['vocals', 'drums', 'bass', 'other'],
    sampleRate: 44100,
    chunkSamples: 352800, // 8 s, fixed by the model card / ONNX example
    overlap: 0.25,
    sizeBytes: 96538997,
    ramHint: 'About 1.5 GB of free RAM.',
    speedHint: 'Roughly 1–3× real-time on a mid-range GPU; 5–15× slower than real-time on CPU.',
    warning: null,
    files: [
      {
        role: 'model',
        name: 'freq_weights.onnx',
        url: hf('HiDolen/Mini-BS-RoFormer-V2.5-46.2M', '38dafc78834607aec57d8c0cb3568523f9ea5563', 'onnx/freq_weights.onnx'),
        bytes: 96538997,
        sha256: 'c019650a7fb9e6a208353fead62471ed6ffdf20a3069ddadd8278edeb411d556',
      },
    ],
    license: {
      spdx: 'MIT',
      name: 'Mini-BS-RoFormer-V2.5-46.2M (HiDolen)',
      url: 'https://huggingface.co/HiDolen/Mini-BS-RoFormer-V2.5-46.2M',
    },
  },

  duality: {
    id: 'duality',
    adapter: 'duality',
    label: 'Clean vocals',
    short: '2 stems · Mel-Band RoFormer Duality',
    description: 'Vocals and instrumental. A distilled Mel-Band RoFormer tuned for clean lead-vocal / acapella extraction.',
    stems: ['vocals', 'instrumental'],
    sampleRate: 44100,
    chunkSamples: 484659, // 441 * 1099 -> exactly 1100 STFT frames, ~11 s
    overlap: 0.25,
    sizeBytes: 5539495 + 213244940,
    ramHint: 'About 2 GB of free RAM.',
    speedHint: 'Needs a GPU for comfortable speed; CPU fallback is very slow (many minutes per song).',
    warning: 'Works best on a desktop GPU (WebGPU). CPU/WASM works but is noticeably slower.',
    // ORT session options merged into the WebGPU execution-provider entry.
    webgpuOptions: { storageBufferCacheMode: 'simple' },
    files: [
      {
        role: 'model',
        name: 'duality_student_core_t1100.onnx',
        url: hf('musetric/mel-band-roformer-duality-student-onnx', '0e04989195c31669276cdf05f5f840f8cf2f7e6f', 'duality_student_core_t1100.onnx'),
        bytes: 5539495,
        sha256: '0198c50e408bf040522aa1b12042628e3218c61c958f06fdc9bb1aad9465a594',
      },
      {
        // External-data sidecar. `name` MUST match the `location` recorded
        // inside the .onnx file (checked with `onnx` during development).
        role: 'data',
        name: 'duality_student_core_t1100.onnx.data',
        url: hf('musetric/mel-band-roformer-duality-student-onnx', '0e04989195c31669276cdf05f5f840f8cf2f7e6f', 'duality_student_core_t1100.onnx.data'),
        bytes: 213244940,
        sha256: 'd7bea7fae93748cbc210208b8b9728dc274e1cc9e0bdad852ad08294ee1c335b',
      },
    ],
    license: {
      spdx: 'Apache-2.0',
      name: 'Mel-Band RoFormer Duality student ONNX (musetric)',
      url: 'https://huggingface.co/musetric/mel-band-roformer-duality-student-onnx',
    },
  },

  bs6: {
    id: 'bs6',
    adapter: 'bs6',
    label: 'Full 6-stem',
    short: '6 stems · BS-RoFormer-SW',
    description: 'Highest-detail split: vocals, drums, bass, guitar, piano and other. The biggest and slowest model — meant for a desktop with a real GPU.',
    stems: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
    sampleRate: 44100,
    chunkSamples: 176400, // 4 s, fixed by the traced ONNX graph (T = 345)
    overlap: 0.25,
    sizeBytes: 352778874,
    ramHint: '4 GB+ of free RAM and a GPU with ~4 GB+ of VRAM recommended.',
    speedHint: 'About 2–3× slower than real-time on a modern GPU. On CPU it can take well over an hour per song.',
    warning: 'Large download (~353 MB) and heavy on GPU memory and RAM. Close other tabs first. Needs a decent GPU (WebGPU).',
    files: [
      {
        role: 'model',
        name: 'bs_roformer_sw_6stem_fp16.onnx',
        url: hf('Acapellas/bs-roformer-sw-6stem-FP16-FP32-onnx', '3a8d9654232ff861462516b13249eb8e068cb5d1', 'bs_roformer_sw_6stem_fp16.onnx'),
        bytes: 352778874,
        sha256: 'd3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444',
      },
    ],
    license: {
      spdx: 'MIT',
      name: 'BS-RoFormer-SW 6-stem ONNX (Acapellas / elicwhite)',
      url: 'https://huggingface.co/Acapellas/bs-roformer-sw-6stem-FP16-FP32-onnx',
      note: 'Pretrained weights were re-hosted by jarredou without a stated license; the re-host owner has no provenance information (per the model card). MIT covers the ONNX export and code lineage.',
      caveat: 'weights re-hosted, upstream license unstated — see NOTICE',
    },
  },
};

/** Display order in the picker. */
export const MODEL_ORDER = ['mini', 'duality', 'bs6'];

export function formatBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= MB) return Math.round(n / MB) + ' MB';
  return Math.round(n / 1000) + ' KB';
}
