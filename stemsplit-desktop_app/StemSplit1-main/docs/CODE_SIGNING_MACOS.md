# macOS Signing and Notarization Pipeline

This repository includes a signed + notarized release workflow for macOS:

- Workflow: `.github/workflows/macos-release-signed-notarized.yml`
- DMG script: `create_mac_dmg.sh`

## Required GitHub Secrets

- `MACOS_CERTIFICATE_P12_BASE64`: Base64-encoded Developer ID Application certificate (.p12)
- `MACOS_CERTIFICATE_PASSWORD`: Password for the .p12 certificate
- `MACOS_SIGNING_IDENTITY`: Full identity string, e.g. `Developer ID Application: Your Company (TEAMID)`
- `APPLE_ID`: Apple ID used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password for the Apple ID
- `APPLE_TEAM_ID`: Apple Developer Team ID

## Prepare `MACOS_CERTIFICATE_P12_BASE64`

```bash
base64 -i /path/to/certificate.p12 | pbcopy
```

Paste the single-line Base64 output into secret `MACOS_CERTIFICATE_P12_BASE64`.

## What the Workflow Does

1. Imports certificate into a temporary keychain.
2. Builds the app bundle.
3. Creates and signs `installers/StemSplit.dmg`.
4. Submits DMG for Apple notarization and waits.
5. Staples notarization ticket to DMG.
6. Generates `installers/checksums-mac.sha256`.

## Local Signing Hook

`create_mac_dmg.sh` accepts:

- `MAC_CODESIGN_IDENTITY`

If set, the script signs both `.app` and `.dmg` and verifies signatures.
