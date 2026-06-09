# Installer Quality Gate

StemSplit now enforces an installer quality gate with a hard score threshold.

- Gate target: `>= 90/100`
- Script: `scripts/ci/installer_quality_gate.py`
- Integrity manifest script: `scripts/ci/generate_release_manifest.py`

## Scoring Model

The gate computes a weighted score:

- `artifact_exists`: 25
- `size_sanity`: 10
- `checksum_manifest_present`: 15
- `checksum_match`: 15
- `smoke_tests_passed`: 20
- `release_hardening_files_present`: 15

Total: `100`

## CI Integration

- Windows: `.github/workflows/installer-windows.yml`
- macOS: `.github/workflows/installer-macos.yml`

Each workflow now:

1. Builds installer artifact.
2. Runs smoke tests.
3. Generates release integrity manifest JSON.
4. Runs quality gate script.
5. Uploads artifacts + reports.

Offline installer builds also run manifest-based payload validation:

- Manifest: `scripts/ci/model_payload_manifest.json`
- Validator: `scripts/ci/validate_model_payloads.py`
- Reports: `installers/model-payload-report.json`, `installers/model-payload-report.md`

This guards against accidental junk (git metadata, temp/test files) inside
large optional model folders while keeping those folders ignored by git.

Manifest policy controls strictness:

- `required_paths` and `max_size_mb` are enforced.
- `forbidden_globs` can be `fail` or `warn` via `forbidden_mode`.

Smoke test evidence is now report-based:

- Windows smoke report: `installers/smoke-windows.json`
- macOS smoke report: `installers/smoke-macos.json`

The gate consumes these via `--smoke-report` for stronger proof than a manual flag.

## Local Usage

Windows example:

```powershell
python .\scripts\ci\installer_quality_gate.py `
  --platform windows `
  --installer-glob "installers/StemSplit_Setup_*_Online.exe" `
  --checksum-file "installers/checksums-windows.sha256" `
  --threshold 90 `
  --smoke-report "installers/smoke-windows.json" `
  --payload-report "installers/model-payload-report.json" `
  --required-file ".github/workflows/windows-release-signed.yml" `
  --required-file "scripts/sign_windows_release.ps1" `
  --required-file "docs/CODE_SIGNING_WINDOWS.md" `
  --required-file "setup_online.iss" `
  --required-file "scripts/ci/validate_model_payloads.py" `
  --required-file "scripts/ci/model_payload_manifest.json" `
  --json-out "installers/quality-gate-windows.json" `
  --md-out "installers/quality-gate-windows.md"
```

macOS example:

```bash
python3 ./scripts/ci/installer_quality_gate.py \
  --platform macos \
  --installer-glob "installers/StemSplit_Online_Setup.dmg" \
  --checksum-file "installers/checksums-mac.sha256" \
  --threshold 90 \
  --smoke-report "installers/smoke-macos.json" \
  --payload-report "installers/model-payload-report.json" \
  --required-file ".github/workflows/macos-release-signed-notarized.yml" \
  --required-file "scripts/ci/smoke_test_mac_installer.sh" \
  --required-file "docs/CODE_SIGNING_MACOS.md" \
  --required-file "create_mac_dmg.sh" \
  --required-file "scripts/ci/validate_model_payloads.py" \
  --required-file "scripts/ci/model_payload_manifest.json" \
  --json-out "installers/quality-gate-macos.json" \
  --md-out "installers/quality-gate-macos.md"
```

Model payload validation example:

```powershell
python .\scripts\ci\validate_model_payloads.py `
  --manifest ".\scripts\ci\model_payload_manifest.json" `
  --repo-root "." `
  --json-out "installers/model-payload-report.json" `
  --md-out "installers/model-payload-report.md"
```