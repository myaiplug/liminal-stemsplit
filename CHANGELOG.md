# Changelog

All notable changes to Liminal StemSplit. Versions follow SemVer; the single source of truth is
`stemsplit-desktop_app/StemSplit1-main/VERSION` (propagated by `scripts/sync_version.py`).

## 0.7.0

### Added
- **In-app self-update.** Tauri 2 updater + process plugins. The app checks GitHub Releases
  (`latest.json`) on launch, offers *Update Now* (download → signature check → install → relaunch) and
  has a **Check for updates** button in *Separation Configuration → App & Engine*. Updates are signed
  (minisign key; public key in `tauri.conf.json`, private key in the `TAURI_SIGNING_PRIVATE_KEY` repo secret).
- **Post-update engine check.** After an update the embedded Python environment, scripts and models are
  verified/repaired by `scripts/model_doctor.py` and the result is shown as a toast.
- **Automatic troubleshooting of failed splits** (`scripts/split_recovery.py`). Errors are classified
  (out of memory, missing/corrupt model, missing dependency, ffmpeg/decode, unknown) and fixed
  automatically with up to 3 bounded retries: smaller segment/chunk or CPU for OOM, model repair/redownload,
  dependency repair, re-transcode to WAV, demucs `htdemucs` fallback. Progress is streamed as
  `recovery` events ("Recovering…"), and the outcome plus `split_diagnostics.log` is shown in the UI.
- **Model library.** Browse open/freely downloadable models from `audio-separator`'s list, the
  repository manifest `models/catalog.json` and (optionally) Hugging Face. Shows size, stems, estimated
  VRAM and whether it fits your GPU (flags models that won't fit 8 GB). One-click download registers the
  model in the user registry so it appears in the model picker.
- **Windows installers with release automation.** `release-windows.yml` (shipped in `docs/ci/`, copy to `.github/workflows/`) builds signed
  NSIS + MSI bundles on `windows-latest` for tags `v*` and manual runs, and uploads installers +
  `latest.json` to a **draft** GitHub Release.
- `VERSION` file + `scripts/sync_version.py` (`--check` in CI) keep `tauri.conf.json`, `Cargo.toml`,
  `Cargo.lock`, `package.json`/lock, Inno scripts, `scripts/version.py` and UI strings in sync.

### Changed
- **GPU acceleration (ported from the verified RTX 2080 Super setup).** Embedded Python setup installs
  CUDA PyTorch (`torch==2.13.0+cu126`) and `onnxruntime-gpu==1.23.2` when an NVIDIA GPU is present, with
  a CPU fallback; the splitter re-checks the GPU on every run.
- The legacy `release.yml` workflow is manual-only and creates draft releases.

### Fixed
- `splitter.py` rejected `--device`; demucs ignored the selected device (always ran on CPU); demucs'
  `openunmix` import failed on CUDA torch builds without a matching `torchaudio` (stub registered);
  the doctor reported that as a broken import; the Rust torch-pairing check would have downgraded the
  CUDA 2.13 stack to 2.5.1.

## 0.5.1
- Previous release (see Git history).
