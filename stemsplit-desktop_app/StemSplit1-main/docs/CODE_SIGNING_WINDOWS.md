# Windows Code Signing — Liminal StemSplit

Signed installers look legitimate to Windows and reduce SmartScreen friction. This doc covers how signing works in this repo and what you need to appear as a trusted publisher.

## Why signing matters

Windows SmartScreen checks:

1. **Authenticode signature** — is the `.exe` signed with a valid code-signing certificate?
2. **Publisher reputation** — has this certificate been seen often enough without malware reports?

A valid signature alone does not eliminate warnings on day one. **EV (Extended Validation) code-signing certificates** build reputation faster; standard OV certs still help but may show warnings until enough installs accumulate.

## What we sign

CI workflow: `.github/workflows/windows-release-signed.yml`  
Signing script: `scripts/sign_windows_release.ps1`

Artifacts signed on release:

- `src-tauri/target/release/stem-split.exe` (ships as `Liminal™.exe`)
- `installers/Liminal-StemSplit-Setup-*.exe`

Both use SHA-256 file digest + RFC 3161 timestamp (DigiCert).

## Required GitHub configuration

### Secrets (required for signed workflow)

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERT_PFX_B64` | Base64-encoded `.pfx` code-signing certificate |
| `WINDOWS_CERT_PASSWORD` | Password for the `.pfx` |

### Variables (optional)

| Variable | Description |
|----------|-------------|
| `STEMSPLIT_VST_SOURCE` | Path to `ReVerb-DeGloss.vst3` on the CI runner if not at default locations |

## Prepare the certificate secret

PowerShell on a secure machine:

```powershell
$bytes = [IO.File]::ReadAllBytes('C:\path\to\codesign.pfx')
[Convert]::ToBase64String($bytes)
```

Paste the single-line output into GitHub → Settings → Secrets → `WINDOWS_CERT_PFX_B64`.

**Never commit the `.pfx` or password to the repository.**

## Obtaining a code-signing certificate

1. **Purchase** from a Microsoft-trusted CA (DigiCert, Sectigo, SSL.com, etc.).
2. **Choose EV if budget allows** — immediate SmartScreen reputation for many publishers.
3. **Complete identity verification** (business name must match publisher string in cert).
4. **Export as PFX** with private key for CI signing.
5. **Store offline backup** of the PFX in a hardware vault or HSM.

Typical annual cost: ~$200–500 (OV), ~$400–700 (EV).

## Release process (signed)

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, `setup.iss`, `app-version.ts`.
2. Stage VST: `.\scripts\stage_bundled_vst.ps1`
3. Commit and push tag: `git tag v0.5.0 && git push origin v0.5.0`
4. Workflow builds, signs, uploads artifacts.
5. Publish GitHub Release with:
   - `Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe`
   - `checksums-windows.sha256`

## Local signing (without CI)

After building the installer:

```powershell
.\scripts\sign_windows_release.ps1 `
  -CertPath C:\path\to\codesign.pfx `
  -CertPassword 'your-password' `
  -Files @(
    'src-tauri\target\release\stem-split.exe',
    'installers\Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe'
  )
```

Verify:

```powershell
signtool verify /pa /v installers\Liminal-StemSplit-Setup-v0.5.0-Windows-x64.exe
```

## What users see

| State | User experience |
|-------|-----------------|
| Unsigned | SmartScreen “Windows protected your PC” → More info → Run anyway |
| Signed, new cert | May still warn until reputation builds |
| Signed, established EV | Usually installs without extra clicks |

Publisher name in the signature should match your brand (e.g. **NoDAW**) for consistency across Gumroad, website, and installer.

## Security practices

- Use **restricted** CI secrets; rotate cert if leaked.
- Workflow deletes `codesign.pfx` after the job.
- Prefer **hardware token / HSM** for EV certs in production orgs.
- Timestamp all signatures so they remain valid after cert expiry.

## Unsigned releases (interim)

Until secrets are configured, publish unsigned builds with:

- Clear README note about SmartScreen
- Published SHA-256 checksums
- Reproducible build instructions

Move to signed releases before broad marketing to minimize support tickets about “virus” warnings.