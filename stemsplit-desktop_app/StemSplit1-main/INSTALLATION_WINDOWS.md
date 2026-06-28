# Liminal StemSplit — Windows Installation & First Launch

Version **0.5.0**

## What you are installing

NoDAW Liminal is a Tauri desktop app with an embedded Python AI runtime. The v0.5.0 full installer includes:

- `Liminal™.exe` — main application
- `embedded_python\` — local AI runtime (Demucs, Spleeter, etc.)
- `ffmpeg\` — MP3 encoding
- `scripts\` — separation pipeline
- `VST\ReVerb-DeGloss.vst3\` — bundled Pro VST (DeGloss pass)

Models may ship with the installer or download on first use into `%LOCALAPPDATA%\StemSplit\models`.

---

## Install steps

1. Download `Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe` from [GitHub Releases](https://github.com/myaiplug/liminal-stemsplit/releases/tag/v0.5.0).
2. Verify checksum (optional): compare against `checksums-windows.sha256` on the release page.
3. Run the installer as a normal user (admin may be required for `Program Files`).
4. Accept the default install path unless you have a reason to change it.
5. Optionally create a desktop shortcut.
6. Launch **NoDAW Liminal** from the Start Menu.

### SmartScreen warning

If Windows shows a blue SmartScreen dialog:

1. Click **More info**
2. Click **Run anyway**

Signed releases reduce warnings over time as publisher reputation builds. See [docs/CODE_SIGNING_WINDOWS.md](docs/CODE_SIGNING_WINDOWS.md).

---

## First-launch checklist

Work through this once after installing v0.5.0:

| Step | What to expect | Pass criteria |
|------|----------------|---------------|
| 1. App opens | Window appears with Liminal UI | No blank white screen |
| 2. Python setup | Brief “setting up runtime” progress | Completes without fatal error |
| 3. Account gate | Sign up or log in | **No email verification required** — you enter the app immediately after signup |
| 4. Free split | Load a track ≤ 3 min, run split | Engine coerces to **Spleeter 2-stem**, output **MP3** |
| 5. Pro engines locked | Try changing engine on free account | UI shows Pro upsell; backend stays on Spleeter |
| 6. Satellite routes | Open `/podcast-cleanup`, `/karaoke-maker`, etc. if linked | Same shell as home (not a blank page) |
| 7. Pro VST (Pro only) | Open FX → VST → DeGloss Pass | Path resolves to `{InstallDir}\VST\ReVerb-DeGloss.vst3` |
| 8. Upgrade flow | Open license / sales modal | Stripe checkout or license key entry works |

### Free tier rules (enforced in app + backend)

- **Engine:** Spleeter only
- **Stems:** 2 (vocals + instrumental)
- **Format:** MP3 only
- **Duration:** 3 minutes max (audio trimmed automatically)
- **FX / VST:** disabled
- **Splits:** unlimited

### Account verification

Email verification is **not required** to use the app in v0.5.0. Accounts are marked verified on signup so you can split immediately. Verification email flows remain for legacy accounts but do not block access.

---

## Install locations

| Item | Path |
|------|------|
| Application | `C:\Program Files\NoDAW Liminal\` (default) |
| Bundled VST | `{InstallDir}\VST\ReVerb-DeGloss.vst3` |
| User models | `%LOCALAPPDATA%\StemSplit\models` |
| Trial usage / license | `%LOCALAPPDATA%\StemSplit\` |
| Python diagnostics | `%LOCALAPPDATA%\StemSplit\python-setup-diagnostics.json` |

---

## Upgrade from older versions

The v0.5.0 installer detects an existing install and offers upgrade/repair. It will:

- Close a running `Liminal™.exe` before replacing files
- Preserve your `%LOCALAPPDATA%\StemSplit` data
- Add the `VST\` folder if upgrading from pre-0.5.0 builds

---

## Building the installer yourself

From repo root:

```powershell
.\scripts\stage_bundled_vst.ps1
.\build_complete_installer.ps1 -Offline
```

Output: `installers\Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe`

For signed CI releases, configure GitHub secrets per [docs/CODE_SIGNING_WINDOWS.md](docs/CODE_SIGNING_WINDOWS.md) and push tag `v0.5.0`.

---

## Common issues

**“Another stem split operation is already running”**  
Wait for the current job to finish or restart the app.

**Models missing**  
First split may download weights. Ensure disk space and internet. Models land in `%LOCALAPPDATA%\StemSplit\models`.

**DeGloss button grayed out**  
Free accounts cannot use VST. Upgrade to Pro, or reinstall if Pro and `VST\ReVerb-DeGloss.vst3` is missing.

**Reinstall / repair**  
Run the same installer again and choose reinstall when prompted.