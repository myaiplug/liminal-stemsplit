# CI workflow files awaiting install

GitHub rejected pushing files under `.github/workflows/` from the automation account (its token lacks the
`workflow` scope), so the release workflow ships here. To activate it (needs a token/UI with workflow permission):

```bash
cp stemsplit-desktop_app/StemSplit1-main/docs/ci/release-windows.yml .github/workflows/release-windows.yml
git apply stemsplit-desktop_app/StemSplit1-main/docs/ci/release.yml.patch   # makes the old release.yml manual-only + draft
git rm -r stemsplit-desktop_app/StemSplit1-main/docs/ci   # optional cleanup afterwards
```

`release-windows.yml` needs repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
(already set). See `../RELEASING.md`.
