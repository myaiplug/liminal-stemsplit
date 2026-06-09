# StemSplit Release Runbook

## Goal

Ship a release with installer quality gate >= 90 and evidence-backed artifacts.

## 1. Local Preflight

Run from repo root:

```powershell
python .\scripts\ci\release_preflight.py `
  --repo-root "." `
  --json-out "installers/release-preflight.local.json" `
  --md-out "installers/release-preflight.local.md"
```

Optional billing gate (recommended before release branches and tags):

```powershell
python .\scripts\ci\release_preflight.py `
  --repo-root "." `
  --json-out "installers/release-preflight.billing.local.json" `
  --md-out "installers/release-preflight.billing.local.md" `
  --run-billing-smoke
```

If rebuilding offline runtime artifacts, run repair-aware embedded setup first:

```powershell
.\setup_embedded_python.ps1 -RepairIfNeeded
```

Verify local evidence reports exist and pass:

- `installers/smoke-windows.local.json`
- `installers/model-payload-report.local.json`
- `installers/quality-gate-windows.local.json`

## 2. Commit and Push

Review staged diff carefully, then:

```powershell
git add .
git commit -m "release: harden installer gates and release preflight"
git push origin main
```

## 3. Validate CI on GitHub

Required workflows should pass:

- `.github/workflows/installer-windows.yml`
- `.github/workflows/installer-macos.yml`
- `.github/workflows/billing-preflight.yml`
- `.github/workflows/windows-release-signed.yml` (when signing secrets are configured)
- `.github/workflows/macos-release-signed-notarized.yml` (when Apple signing secrets are configured)

Windows signed release now includes a mandatory embedded runtime repair/verification step (`setup_embedded_python.ps1 -RepairIfNeeded`) before offline installer packaging.

Check uploaded artifacts include:

- installer binaries (`.exe`/`.dmg`)
- checksums
- smoke reports
- model payload reports
- quality gate reports

## Branch Protection Recommendation

For `main` and `release/*`, configure GitHub branch protection to require these status checks:

- `Windows Installer CI / build-and-smoke-test`
- `Billing Preflight CI / billing-preflight`
- `Windows Signed Release / build-sign-release` (for tag/release branches when signing is expected)

## 4. Publish GitHub Release

1. Create tag in GitHub (for example `v0.1.0`).
1. Create release notes including:

- Artifact filenames
- SHA-256 checksums
- Platform-specific install notes

1. Attach built installer artifacts from CI.
1. Mark as latest if stable.

## 5. Post-Release Validation

- Download and install on clean Windows test machine.
- Download and install on clean macOS test machine.
- Confirm first-run provisioning flow works.
- Confirm checksums in release notes match downloaded files.
