# Windows Code Signing Pipeline

This project includes a CI workflow for signed Windows releases:

- Workflow: `.github/workflows/windows-release-signed.yml`
- Signing script: `scripts/sign_windows_release.ps1`

## Required GitHub Secrets

- `WINDOWS_CERT_PFX_B64`: Base64-encoded `.pfx` certificate
- `WINDOWS_CERT_PASSWORD`: Password for the `.pfx`

## Prepare `WINDOWS_CERT_PFX_B64`

PowerShell example:

```powershell
$bytes = [IO.File]::ReadAllBytes('C:\path\to\codesign.pfx')
[Convert]::ToBase64String($bytes)
```

Paste the resulting single-line Base64 string into GitHub Actions secret `WINDOWS_CERT_PFX_B64`.

## Signing Scope

The workflow signs:

- `src-tauri/target/release/StemSplit.exe`
- `installers/StemSplit_Setup_*.exe`

## Security Notes

- The certificate file is materialized only during workflow execution.
- The certificate file is deleted in cleanup step.
- Use an EV code-signing cert when possible for best SmartScreen reputation.
