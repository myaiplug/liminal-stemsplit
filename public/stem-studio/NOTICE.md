# Stem Studio — notices

Original code, except as listed. Everything runs in the browser; nothing is uploaded.

| Component | Licence | Where |
| --- | --- | --- |
| onnxruntime-web 1.30.0 | MIT | reused from `roformer-web/vendor/ort` (drum worker) |
| fflate | MIT | reused from `roformer-web/vendor/fflate` (ZIP export) |
| lamejs 1.2.1 (LAME MP3 encoder, JS port) | **LGPL-3.0** | `vendor/lamejs`, unmodified, loaded only when MP3 export is chosen; delete the folder to drop it (WAV export is unaffected) |
| DrumSep v2 (HDemucs, 4 drum stems) | MIT (fine-tune of inagoy/drumsep, MIT). **Training-data provenance not independently verified.** | downloaded at runtime from the URL in `drums/drum-models.js`; not stored in this repository |
| Effect-chain parameters and presets | extracted from the Liminal desktop app (same owner) | `desktop-data.js` |

Loudness follows ITU-R BS.1770-4 / EBU R128 and is an independent implementation. Details: `docs/stem-studio-drums.md`, `docs/stem-studio-presets.md` in the Liminal repository.
