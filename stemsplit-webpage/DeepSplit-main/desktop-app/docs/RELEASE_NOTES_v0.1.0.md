# StemSplit v0.1.0

Release date: 2026-03-25
Commit: `fccb58e`

## Highlights

- Hardened installer quality gate with evidence-based checks.
- Added smoke test evidence consumption (`--smoke-report`) in quality gate.
- Added model payload validation with manifest policy:
  - `scripts/ci/model_payload_manifest.json`
  - `scripts/ci/validate_model_payloads.py`
- Added release preflight automation:
  - `scripts/ci/release_preflight.py`
  - `docs/RELEASE_RUNBOOK.md`
- Added/updated CI workflows for Windows and macOS installer validation.
- Updated download documentation and repository release links.

## Downloads

### Windows
- `StemSplit_Setup_v0.1.0_x64_Online.exe`
- SHA-256:

```text
8238aa668e53316b3723a9db284fbdff4056f0b4eeecfae48784af78652e7e21  StemSplit_Setup_v0.1.0_x64_Online.exe
```

### macOS
- `StemSplit_Online_Setup.dmg`
- SHA-256:

```text
3770410f135fa6556f637f5dd055183c9534486a1d3871585df77ea9d3e051af  StemSplit_Online_Setup.dmg
```

## Validation Evidence

- `installers/smoke-windows.local.json`
- `installers/model-payload-report.local.json`
- `installers/quality-gate-windows.local.json` (`100/100`)
- `installers/release-preflight.local.json` (`PASS`)

For release publication, prefer CI-generated artifacts/reports for both Windows and macOS.

## Free Trial and Upgrade

StemSplit v0.1.0 is free to download and install on both platforms.

Licensing flow:
1. Install and launch StemSplit.
2. Use trial mode immediately.
3. Upgrade in-app when you need full features.
4. Enter your license key to unlock Pro mode.

Trial vs Pro summary:
- Trial: up to 3-minute files, 2-stem separation, MP3 output, limited engine/tooling.
- Pro: unlimited duration, full stem options, high-quality output formats, all engines and pro tooling.

## Notes

- If code-signing secrets are configured, use signed release workflows for production distribution.
- Dependabot currently reports vulnerabilities on default branch; track separately from this installer release scope.
