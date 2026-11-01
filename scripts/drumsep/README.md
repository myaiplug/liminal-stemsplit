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
