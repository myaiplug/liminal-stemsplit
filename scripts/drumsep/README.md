# Rebuilding the browser drum model

Reproduces `drumsep_v2_w10_f16w.onnx` from the upstream ONNX (`gridshiftstudio/drumsep-onnx`, v2, MIT).

```
pip install torch onnx onnxruntime numpy demucs==4.0.1
python hd_build.py    # rebuild the HDemucs graph in PyTorch from the ONNX initialisers (+ check vs upstream ONNX)
python hd_export.py   # re-export with a 10 s window (T=441000, mag [1,4,2048,431]) -> fp32 ONNX
python f16w.py        # store weights as fp16 + Cast -> fp32 (168,050,967 B)
python hd_parity.py   # PyTorch vs ONNX parity
python chunk_eval.py  # chunked vs 40 s reference
sha256sum drumsep_v2_w10_f16w.onnx  # b05779ea756870f3fe359c63ac501dd12caf3b24d66237b1404bb4dd5b32839a
```
Paths at the top of each script point at the scratch directory used during development (`/workspace/drumsep/...`); adjust them. The derived file inherits the upstream MIT licence; see `docs/stem-studio-drums.md` for the provenance caveat. Do not upload it to a public host without a decision from the owner.

## HT-RoFormer 6-stem (optional, not hosted)

Builds `drumsep_htr_core_f16w.onnx` (377,528,839 B, sha256 `f1802cfb113ef4b13fd3be5ac4130517b22247bab6138421e24f322a5dbcc008`
with torch 2.5.1 / onnx 1.17) from the author's checkpoint at
`https://huggingface.co/Sucial/drumsep-ht-roformer` @ `403f3a03c3ea70a9af47f2c6adf64f90ca97e1af`.
STFT and iSTFT run on the host (`public/stem-studio/drums/htr.js`); the graph takes `audio [1,2,266240]` and
`spec [1,2,1025,261,2]` and returns `mask [1,6,2050,261,2]` and `residual [1,6,2,266240]`.

```
huggingface-cli download Sucial/drumsep-ht-roformer --revision 403f3a03c3ea70a9af47f2c6adf64f90ca97e1af --local-dir htr
python htr_export.py htr/infer htr/ht_roformer_drums.ckpt drumsep_htr_core.onnx   # torch vs ONNX-core parity printed
python f16w.py drumsep_htr_core.onnx drumsep_htr_core_f16w.onnx
```
Two export patches are applied (both numerically identical): `nn.GLU` is replaced by `chunk * sigmoid`, and the rotary
embedding's `repeat_interleave` is replaced by `stack + flatten`. Measured parity of the browser path (JS STFT + ONNX +
JS iSTFT, Node onnxruntime) against the author's PyTorch inference: 71.9 dB SNR (fp32), 64.0 dB (fp16 weights).

**Licence: the author has published no licence for the checkpoint or the inference code.** Do not upload the derived
ONNX anywhere public, and do not ship it in a paid product, until the author gives written permission.
`DRUM_HTR_DEFAULT_URL` in `public/stem-studio/drums/drum-models.js` stays `null` until then.
