# PR Draft: Next 16 Security Upgrade

## Suggested PR Title
chore: migrate web stack to Next 16 + ESLint 9 and clear build warnings

## Summary
This PR upgrades the web stack to the Next 16 line and updates lint tooling to ESLint 9 flat config while preserving app behavior and passing build/lint gates.

## What changed
- Upgraded framework and lint stack:
  - `next` -> `16.2.2`
  - `eslint-config-next` -> `16.2.2`
  - `eslint` -> `9.39.1`
- Added flat ESLint config:
  - `eslint.config.mjs`
- Updated lint script:
  - `npm run lint` now uses `eslint .`
- Updated React ecosystem compatibility:
  - `framer-motion` -> `12.38.0`
  - `lucide-react` -> `1.7.0`
  - Kept `react`/`react-dom` on `18.3.1` for compatibility with current 3D stack.
- Next 16 warning cleanup:
  - Set `turbopack.root` in `next.config.js`
  - Moved `viewport` from metadata into dedicated `viewport` export in `src/app/layout.tsx`
- Fixed lint-order issue in `src/components/UpdateModal.tsx`.

## Validation
- `npm audit --audit-level=high`: pass (0 vulnerabilities)
- `npm run lint`: pass
- `npm run build`: pass

## Risk notes
- Main migration risk was React 19 compatibility. This PR intentionally keeps React 18.3.1 to avoid breaking R3F and spring peer constraints.
- Functional behavior is unchanged; this is primarily dependency/tooling modernization and warning cleanup.

## Files touched
- `package.json`
- `package-lock.json`
- `eslint.config.mjs`
- `next.config.js`
- `src/app/layout.tsx`
- `src/components/UpdateModal.tsx`
- `tsconfig.json`
- `next-env.d.ts`

## Reviewer checklist
- [ ] Install deps and verify lockfile consistency
- [ ] Run `npm run lint`
- [ ] Run `npm run build`
- [ ] Spot-check startup and home route rendering
- [ ] Verify no regressions in update modal behavior
- [ ] Confirm no Next 16 workspace/viewport warnings remain

## Post-merge follow-up (optional)
- Evaluate migration path to React 19 once `@react-three/*` and related peers are fully aligned.
