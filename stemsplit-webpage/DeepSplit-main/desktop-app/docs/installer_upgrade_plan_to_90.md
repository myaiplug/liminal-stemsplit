# StemSplit Deployment Strategy: The Path to 90/100
**Date:** March 25, 2026
**Current Score:** 68/100
**Target Score:** 90+/100

To elevate the installer infrastructure from a "brute-force script" to a professional-grade, seamless deployment ecosystem (comparable to Native Instruments, FabFilter, or Adobe tools), we must abandon the monolithic 5GB offline installer concept and rebuild the delivery pipeline around **smart, on-demand component resolution**.

Here is the realistic, actionable 4-step plan to achieve a 90+ score:

## Step 1: Shift to a Rust-Native In-App Downloader (Score Boost: +8)
**The Problem:** Relying on InnoSetup (Windows) or basic shell scripts (Mac) to download large 1GB+ Python/FFmpeg ZIP files is extremely brittle. If the internet drops for 1 second, the install fails, corrupts, and leaves the user frustrated.
**The Solution:** 
*   The raw installers (.exe and .dmg) contain **ONLY** the UI and the Rust Tauri backend (Making the initial installer only ~20MB).
*   On first launch, the React UI detects missing dependencies and triggers a secure, Rust-powered download manager.
*   Rust handles HTTP chunking, allowing the download to pause, resume, and verify checksums (SHA256) of the Python ZIPs. If it drops, it resumes silently. 

## Step 2: Hardware-Targeted Payload Delivery (Score Boost: +6)
**The Problem:** Right now, the embedded Python ZIP blindly contains PyTorch with all CUDA (NVIDIA) binaries. This wastes massive amounts of bandwidth and disk space for Mac users (who need Metal/MPS) or Windows users with AMD graphics cards.
**The Solution:**
*   When the Rust Downloader launches, it queries the OS hardware.
*   If `Mac + Apple Silicon` -> It pulls `python_env_mac_arm64.zip` (PyTorch optimized for Metal).
*   If `Windows + NVIDIA` -> It pulls `python_env_win_cuda.zip`.
*   If `Windows + No GPU` -> It pulls a much smaller `python_env_win_cpu.zip`.
*   *Result:* Cuts the environment payload size by 60% per user and prevents fatal CUDA import crashes on incompatible machines.

## Step 3: Just-In-Time (JIT) AI Model Fetching (Score Boost: +5)
**The Problem:** We are downloading Spleeter, MDX, Drumsep, and UVR models all at once. An end-user might only ever use the basic "4-Stem Spleeter", yet they are forced to download gigabytes of MDX weights. 
**The Solution:**
*   Only package/download the **Spleeter 4-stem model** initially so the user can immediately play with the app.
*   In the React UI drop-down, when a user selects "MDX-Net" or "Drumsep" for the *first time*, the UI shows a small progress bar: "Downloading High-Fidelity MDX Models (250MB)..."
*   *Result:* Users are directly inside the app within 2 minutes of downloading the main DMG/EXE from your website.

## Step 4: Automated CI/CD Code Signing Pipelines (Score Boost: +4)
**The Problem:** A 30MB executable that downloads secondary ZIP files from the internet is the exact behavioral profile of a trojan virus. Windows Defender SmartScreen and Apple Gatekeeper will block this app aggressively.
**The Solution:**
*   Integrate Apple Notarization (`xcrun altool`) into the Mac pipeline. (Requires an Apple Developer ID).
*   Integrate an EV (Extended Validation) Code Signing Certificate into the Windows pipeline to instantly bypass SmartScreen. (Requires buying a physical USB token cert from DigiCert or Sectigo).
*   Without this, a "90/100" professional architecture is impossible because users will receive "This app is malicious" warnings.

## Summary Checklist to Execute:
1. [ ] Rewrite Tauri Rust backend to include a robust File Downloader with pausing/checksums.
2. [ ] Split the uploaded GitHub Release assets into `env-mac-arm`, `env-win-cuda`, `env-win-cpu`.
3. [ ] Update `splitter.py` to gracefully capture "Model Missing" errors and pass a signal back to React to trigger a model download.
4. [ ] Procure Apple and Windows Developer Certificates and plug them into GitHub Actions.

*Executing this turns a slightly risky, heavy, custom script into standard, high-tier software deployment.*