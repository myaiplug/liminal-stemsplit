# Stem Studio — deeper drum split

The **Drums** tab splits a drum stem into **kick, snare/clap, toms, hi-hats, crash/ride, 808/sub and a remainder**. Everything runs in the browser (onnxruntime-web in a worker); nothing is uploaded.

## Model

| | |
|---|---|
| Model | **DrumSep v2** — `gridshiftstudio/drumsep-onnx` (v2), a fine-tune of `inagoy/drumsep` (HDemucs) |
| Licence | **MIT** (both repos). See the provenance caveat below. |
| Outputs | kick, snare, cymbals (hats + crash/ride), toms |
| Browser build | `drumsep_v2_w10_f16w.onnx` — **168,050,967 B**, sha256 `b05779ea756870f3fe359c63ac501dd12caf3b24d66237b1404bb4dd5b32839a` |
| Inputs / outputs | `mix [1,2,441000]`, `mag [1,4,2048,431]` → `freq_out`, `time_out` (STFT/iSTFT are done in JS, `drums/hdemucs.js`) |
| Speed (headless Chrome, wasm, 8 threads) | about 2.3 s per 10 s window, so a 3-minute song takes about 80 s. WebGPU is implemented but **untested** (no adapter in the test machine). |

### Why it is not the upstream ONNX
The published ONNX has a fixed 40 s window (4–6 GB of RAM in a tab) and fp16 does not run on it. `scripts/drumsep/` rebuilds the PyTorch HDemucs from the ONNX initialisers (`hd_build.py`), re-exports it with a **10 s window** (`hd_export.py`) and stores the weights as fp16 with a Cast back to fp32 (`f16w.py`). Activations stay fp32.

### Parity (measured)
* PyTorch rebuild vs the upstream 40 s ONNX: 66.6 dB SNR (float noise level).
* 10 s ONNX vs the PyTorch rebuild: 86.5 dB.
* In-browser (wasm) inference vs Python onnxruntime on the same window: 83–91 dB (toms 54.6 dB).
* JS STFT / iSTFT vs `torch.stft`: 136–156 dB (unit test, fixtures in `test/fixtures/drumsep/`).
* Chunked 10 s inference vs the single 40 s pass (different windowing, expected to differ): kick 15.8, snare 16.1, cymbals 15.2, toms 3.8 dB SNR.
* Reported separation quality (third party, **not re-measured here**): kick ≈ 21 dB SDR, snare ≈ 12–13 dB, cymbals ≈ 5 dB; toms are weak.

### Licence review (what was rejected)
| Candidate | Licence | Decision |
|---|---|---|
| gridshiftstudio DrumSep v2 | MIT | **used**, with the caveat below |
| inagoy/drumsep | MIT | upstream of the above |
| MDX23C DrumSep (jarredou) | no licence stated | rejected (all rights reserved) |
| LarsNet (polimi) | CC BY-NC | rejected (non-commercial) |
| Timbrica | CC BY-NC-SA 4.0 | rejected |

**Provenance caveat (not independently verified):** the v2 fine-tune's model card says it was trained on the owner's own one-shots plus Magenta Groove MIDI rendered with them (Groove is CC BY 4.0). The upstream drumsep v1 training data is not documented in detail. MIT covers the *weights file*, not the unknown rights in the training audio. Treat it like the existing BS-RoFormer-SW flag: fine to ship as a free browser tool, get a decision before it is sold as part of Liminal.

### Hosting
The ONNX is **not committed** (`public/stem-studio/drums/models/*.onnx` is git-ignored) and **not hosted anywhere yet** (needs a decision, see PR). GitHub Pages rejects files over 100 MB, so it needs an external host (e.g. a Hugging Face model repo). The URL is read from, in order: `?drummodel=<url>`, `globalThis.STEM_STUDIO_DRUM_MODEL_URL`, `./models/drumsep_v2_w10_f16w.onnx`. If nothing answers, the tab says so and only offers the DSP split. The worker checks the sha256 after download and caches the file in OPFS.

## How the pieces are derived

### Hi-hats vs crash/ride (`drums/drum-dsp.js: splitHats`)
The model has one "cymbals" stem. It is split by harmonic/percussive median-filter separation on the STFT with a Wiener soft mask: the **percussive part** (short broadband ticks) is **hats**, and **crash/ride = cymbals − hats**, so the two sum exactly to the model output. Limits: a crash's first hit lands in hats; hats played over a ringing cymbal are only partly separable.

### 808 / sub (`derive808`)
1. **Bass stem low band**: zero-phase 4th-order low-pass at `fc` (default 120 Hz, slider 60–200 Hz). Bass = sub + rest exactly, so "Bass (no sub)" + "808 / sub" = the original Bass.
2. **Kick stem**: kick hits are found on a smoothed RMS envelope of the low band; a hit whose −20 dB ring time is ≥ 220 ms is treated as an 808-style kick: its low band (with 6 ms fades) is moved into the 808 stem and the click stays in the kick.
3. If there is no Bass stem, only step 2 applies.
Because the 808 usually lives in the bass part of a mix, **the Bass track is modified**: it is muted and replaced by "Bass (no sub)" (a child of Bass). *Undo split* restores both.

### Remainder
`Drum remainder = drums − kick − snare − toms − (hats + cymbals)`, so that the children always sum to the original drum stem exactly. It shows how much the model left out (about −38 dB on the Mini test clip).

### Quick DSP split (no download)
Kick < 150 Hz, snare = mid-band percussive part, toms/body = mid-band sustained part, hats > 6 kHz percussive, cymbals > 6 kHz sustained. It partitions the signal (sum = input) but is much rougher than the model.

## Tests
`test/stem-studio-drumsep.test.mjs` (STFT/iSTFT parity vs torch, window plan, overlap-add exactness with a mock model, cancellation), `test/stem-studio-drum-dsp.test.mjs` (hats vs crash wash, kick ring-time, 808 routing and conservation, DSP split partition, `buildParts` conservation). End to end in headless Chrome: `scripts/e2e-stem-studio/t_drums.mjs` (UI split in both modes, sum = original at 149 dB, undo) and `t_drums2.mjs` (export mix with split stems equals the pre-split mix at 142 dB, session restore keeps the parent links).
