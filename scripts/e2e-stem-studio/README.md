# Stem Studio browser tests (headless Chrome, Playwright)

Not part of `npm test` (they need Chrome, fixtures and, for the drum split, the model file).

```
node serve.mjs &           # static server with COOP/COEP on :8123, serves ../../public
node t_presets.mjs         # every preset of every stem type applies and renders finite, non-silent audio
node t_export.mjs && python3 verify_export.py   # WAV/MP3/ZIP export, lengths, tags (needs mutagen, soundfile, ffprobe)
node t_misc.mjs            # latency alignment, artifact scan UI, session save/restore
node t_drums.mjs           # drum split through the UI (DSP then AI), mix conservation
node t_drums2.mjs          # export + session restore with split stems
node t_shots.mjs           # screenshots + axe-core + mobile
```
Fixtures: `FIX` in `lib.mjs` (stems of a 20 s clip split with the Mini model). Link the drum ONNX at `public/stem-studio/drums/models/drumsep_v2_w10_f16w.onnx` for the AI split. axe-core is expected at `/workspace/axe/node_modules`.
