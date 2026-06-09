# Installer Quality Gate Report

- Platform: `macos`
- Score: `100/100`
- Threshold: `90`
- Gate: `PASS`

| Check | Weight | Result | Details |
|---|---:|:---:|---|
| `artifact_exists` | 25 | PASS | installers/StemSplit_Online_Setup_macOS_AppleSilicon.dmg |
| `size_sanity` | 10 | PASS | 4.61 MB |
| `checksum_manifest_present` | 15 | PASS | installers/checksums-mac.sha256 |
| `checksum_match` | 15 | PASS | match (StemSplit_Online_Setup_macOS_AppleSilicon.dmg) |
| `smoke_tests_passed` | 20 | PASS | DMG smoke tests passed |
| `release_hardening_files_present` | 15 | PASS | payload report indicates pass |
