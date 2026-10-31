# roformer-web — third-party notices

In-browser (no server) stem separation with RoFormer-family ONNX models.
The code in this directory is original glue; the following upstream works are
used or were consulted. Model weights are **not** stored in this repository:
they are downloaded at runtime from Hugging Face (see `models.js`, which pins
exact commit revisions and SHA-256 hashes), verified, and stored in the user's browser (OPFS; Cache API fallback).

## Vendored runtime / libraries (in `vendor/`, redistributed under their licenses)

| Component | License | Files | Notes |
| --- | --- | --- | --- |
| onnxruntime-web 1.30.0 (Microsoft) | MIT | `vendor/ort/` (`ort.webgpu.min.mjs`, `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, `LICENSE`) | Unmodified npm build (WebGPU + WASM execution providers). Served from this origin so the tool needs no CDN; jsDelivr is used only as a fallback if the local files cannot be loaded. https://github.com/microsoft/onnxruntime |
| fflate 0.8.x (Arjun Barrett) | MIT | `vendor/fflate/` | Used only to build the "Download all (ZIP)" archive (store-only). https://github.com/101arrowz/fflate |
| coi-serviceworker v0.1.7 (Guido Zuidhof) | MIT | `vendor/coi-serviceworker/LICENSE` | The site's stem-splitter service worker (`*-sw.js`) adapts its header-injection / install / claim approach (it is a restricted rewrite: it only touches this tool's own files). Copyright (c) 2021 Guido Zuidhof. https://github.com/gzuidhof/coi-serviceworker |

SHA-256 of the vendored ORT files (npm `onnxruntime-web@1.30.0`, unmodified):

```
3dffff71811bc13a3a3d9591c57ca5ee5735b8f5f3eaf789510b02bb040ae3a0  ort.webgpu.min.mjs
3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28  ort-wasm-simd-threaded.asyncify.mjs
39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da  ort-wasm-simd-threaded.asyncify.wasm   (26.78 MB)
```

## Model weights (downloaded at runtime, not redistributed here)

| Model | Source (pinned commit) | License | Size | Notes |
| --- | --- | --- | --- | --- |
| BS-RoFormer-SW 6-stem, fp16 ONNX | https://huggingface.co/Acapellas/bs-roformer-sw-6stem-FP16-FP32-onnx @ 3a8d965 | MIT (model card / repo metadata) | 352,778,874 B | Architecture: lucidrains/BS-RoFormer (MIT), ZFTurbo Music-Source-Separation-Training (MIT). **Provenance caveat:** the model card says the pretrained weights were re-hosted by jarredou *without a stated license*, and that the re-host owner "were not involved in training and have no provenance information". The MIT tag covers the ONNX export/code lineage, not a verified license on the weights. Review before relying on this model commercially. |
| Mel-Band RoFormer "Duality" student, ONNX | https://huggingface.co/musetric/mel-band-roformer-duality-student-onnx @ 0e04989 | Apache-2.0 | 5,539,495 B + 213,244,940 B (external data) | Distilled from Aname-Tommy's Mel-Band RoFormer (Apache-2.0). Mel-Band RoFormer: Wang et al., arXiv:2310.01809. |
| Mini-BS-RoFormer V2.5 (46.2M), ONNX | https://huggingface.co/HiDolen/Mini-BS-RoFormer-V2.5-46.2M @ 38dafc7 | MIT | 96,538,997 B | Shipped fp16 ONNX (weights are natively bf16; used as published). |

## Code consulted / derived

* **elicwhite/bs-roformer-web** (MIT) — https://github.com/elicwhite/bs-roformer-web.
  The STFT/iSTFT conventions (torch-style reflect padding, periodic Hann window, [ch][bin][frame] layout for BS-RoFormer),
  the chunk/overlap approach and the idea of running the ONNX graph with host-side STFT in a worker were
  taken from that project's design. `dsp.js` is an independent implementation (pair-packed complex FFT) validated
  against torch.
  Copyright (c) 2026 Eli White — MIT License.
* **musetric/musetric** (MIT) — https://github.com/musetric/musetric. Source of the Duality graph geometry
  (n_fft 2048, hop 441, 1100 frames, layout `[bin*2+ch][frame][re,im]`, `storageBufferCacheMode: "simple"` on WebGPU)
  and the pinned onnxruntime-web version known to run it. Copyright (c) 2020-2026 Vladlen Popelenkov — MIT License.
* **HiDolen/Mini-BS-RoFormer-V2.5-46.2M `onnx/ex.py`** (MIT) — reference pre/post-processing for the Mini model
  (4096-pt STFT input, mask applied to a 2048-pt STFT, overlap-add chunking).

No GPL/AGPL code is used.

## MIT License text (applies to the MIT-licensed works above)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Apache License 2.0

Applies to the Duality student weights. Full text: https://www.apache.org/licenses/LICENSE-2.0
