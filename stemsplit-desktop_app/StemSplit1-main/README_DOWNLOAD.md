# Download Liminal StemSplit

AI Audio Extraction Studio — isolate vocals, instruments, drums, and more.

## Download

### Windows

| Installer | Description | Link |
|-----------|-------------|------|
| **Full Installer** (recommended) | Self-contained offline build with embedded Python, FFmpeg, and ReVerb-DeGloss VST | [Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe](https://github.com/myaiplug/liminal-stemsplit/releases/download/v0.5.0/Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe) |
| **Online Installer** | Smaller download; provisions Python packages during install | [Liminal-StemSplit-Setup-v0.5.0-Windows-x64-Online.exe](https://github.com/myaiplug/liminal-stemsplit/releases/download/v0.5.0/Liminal-StemSplit-Setup-v0.5.0-Windows-x64-Online.exe) |

Checksums for each release are published as `checksums-windows.sha256` on the [v0.5.0 release page](https://github.com/myaiplug/liminal-stemsplit/releases/tag/v0.5.0).

### macOS

Native macOS DMG is not part of v0.5.0. Build from source using [BUILD_MAC.md](BUILD_MAC.md) if needed.

---

## Free vs Pro

StemSplit requires a free account (no email verification gate). Sign up once and start splitting immediately.

| Feature | Free | Pro |
|---|---|---|
| Separation engine | Spleeter only | All engines (Demucs, MDX, UVR, etc.) |
| Stem modes | 2-stem (vocals + instrumental) | Full stem set |
| Max file length | 3 minutes | Unlimited |
| Output format | MP3 | WAV + MP3 |
| Batch processing | No | Yes |
| FX rack + VST | No | Yes (ReVerb-DeGloss bundled in v0.5.0) |
| Split count | Unlimited | Unlimited |

Upgrade in-app when you want Pro features. Enter your license key after purchase.

---

## Installation

See the dedicated guides:

- [Installation Guide (Windows)](INSTALLATION_WINDOWS.md) — install steps and first-launch checklist
- [Installation Guide (macOS)](INSTALLATION_MAC.md)

Quick Windows steps:

1. Download the **Full Installer** above.
2. Double-click to run. If SmartScreen appears, see [Security](#security) below.
3. Complete the wizard (default location: `C:\Program Files\NoDAW Liminal`).
4. Launch from Start Menu or Desktop shortcut.
5. Create a free account on first launch — you go straight into the app (no verification code required).

**No manual Python install** — StemSplit auto-provisions and auto-repairs the AI runtime in the background.

---

## System Requirements

### Size

- **Full installer download:** varies with bundled models (multi-GB when models are included).
- **Online installer download:** ~100 MB; additional packages download during install.
- **Installed footprint:** approximately 3.5–5 GB after runtime and models initialize.

### Windows

- Windows 10 (1809+) or Windows 11
- 8 GB RAM minimum (16 GB recommended)
- ~5 GB free disk space
- x64 processor

---

## Security

### Windows SmartScreen

Unsigned or newly signed installers may show **"Windows protected your PC"**.

**If unsigned:** Click **More info** → **Run anyway**.

**If signed:** SmartScreen still warns until the certificate builds reputation. Signed builds from our CI use Authenticode; reputation improves as more users install the same publisher certificate. See [Code Signing Guide](docs/CODE_SIGNING_WINDOWS.md) for how we sign releases and how to set up signing for your own builds.

### macOS

Gatekeeper applies to unsigned builds. Right-click → **Open** on first launch, or use `xattr -cr` on the app bundle.

---

## Troubleshooting

- **Runtime setup slow on first launch:** Reopen the app once and wait for auto-repair. Check `%LOCALAPPDATA%\StemSplit\python-setup-diagnostics.json`.
- **VST not found (Pro):** ReVerb-DeGloss should live at `{InstallDir}\VST\ReVerb-DeGloss.vst3`. Reinstall with the v0.5.0 full installer if missing.
- **Satellite routes blank:** v0.5.0 routes (`/podcast-cleanup`, `/karaoke-maker`, etc.) share the same app shell as the home screen.

Still stuck? [Open an issue](https://github.com/myaiplug/liminal-stemsplit/issues).

---

## Build from Source

- [Windows installer build](build_complete_installer.ps1) — run `.\build_complete_installer.ps1 -Offline`
- [macOS build](BUILD_MAC.md)
- [Contributing](CONTRIBUTING.md)

Before building the Windows installer, stage the bundled VST:

```powershell
.\scripts\stage_bundled_vst.ps1
```

---

## Version History

See [Releases](https://github.com/myaiplug/liminal-stemsplit/releases) for changelog.

**Current Version:** 0.5.0  
**Last Updated:** June 2026  
**License:** MIT