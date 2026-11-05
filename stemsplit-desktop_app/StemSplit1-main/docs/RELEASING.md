# Releasing Liminal StemSplit

Version source of truth: `stemsplit-desktop_app/StemSplit1-main/VERSION`.

> **Setup note:** the workflow file lives in `docs/ci/` until it is copied to `.github/workflows/` (see `docs/ci/README.md`).

```bash
cd stemsplit-desktop_app/StemSplit1-main
echo 0.7.1 > VERSION
python scripts/sync_version.py          # rewrites tauri.conf.json, Cargo.toml/lock, package.json/lock, *.iss, version.py, UI strings
python scripts/sync_version.py --check  # CI runs this
```

1. Add a section to `CHANGELOG.md`, commit, merge to `main`.
2. Tag and push: `git tag v0.7.1 && git push origin v0.7.1` (must match `VERSION`; CI fails otherwise).
3. `release-windows.yml` builds NSIS + MSI on `windows-latest`, signs the updater artifacts, and creates a
   **draft** release `v0.7.1` with installers, `.sig` files and `latest.json`.
4. Test the draft installers, then **Publish** the release. Installed apps (0.7.0+) find `latest.json` at
   `https://github.com/myaiplug/liminal-stemsplit/releases/latest/download/latest.json` and offer the update.

Manual dry run (no release): *Actions → Release (Windows, signed updater) → Run workflow* (leave
"draft_release" unticked). Signed installers are attached to the run as artifacts.

## Signing key
Updater signing key pair: public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); the private
key is in repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If you lose the
private key, installed apps can no longer verify updates — keep a backup. To rotate, generate a new pair with
`npx tauri signer generate`, update the pubkey and the secrets; users must install one build manually.

## Legacy Inno installer
`build_complete_installer.ps1` / `setup.iss` still work (versions are synced). The `release.yml` workflow
(manual only) builds the Inno online installer and macOS DMG into a draft release.

## Windows code signing
The installers are not Authenticode-signed (SmartScreen may warn). The updater signature is separate and
always enforced.
