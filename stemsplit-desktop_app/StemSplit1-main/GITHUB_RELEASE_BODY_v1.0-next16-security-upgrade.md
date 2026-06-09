# StemSplit v1.0 Next16 Security Upgrade

## Summary
This release merges the post-GA web stack uplift to Next 16 and ESLint 9 while preserving current app behavior and passing validation gates.

## Highlights
- Upgraded framework and lint stack:
  - `next` -> `16.2.2`
  - `eslint-config-next` -> `16.2.2`
  - `eslint` -> `9.39.1`
- Introduced ESLint flat config via `eslint.config.mjs`.
- Updated lint script to use ESLint directly.
- Upgraded UI compatibility libraries:
  - `framer-motion` -> `12.38.0`
  - `lucide-react` -> `1.7.0`
- Retained React compatibility baseline (`react`/`react-dom` `18.3.1`) to avoid current 3D stack peer breakage.
- Cleared Next 16 warnings by:
  - setting `turbopack.root` in `next.config.js`
  - moving viewport metadata to dedicated `viewport` export in `src/app/layout.tsx`

## Validation
- `npm audit --audit-level=high`: pass
- `npm run lint`: pass
- `npm run build`: pass
- `./validate_fail_proof_installer.ps1`: pass (20/20)

## Release Metadata
- Tag: `v1.0-next16-security-upgrade`
- Target commit: `a3ca8f0f520bc2087e0041a09eb4af0a0c4ef85e`

## Notes
- This is a targeted framework/security uplift release.
- React 19 migration is intentionally deferred due to current peer constraints in the R3F/spring ecosystem.
