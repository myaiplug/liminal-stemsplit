# Security Triage - 2026-04-04

## Scope

Dependency vulnerability triage for the StemSplit web stack after GA publication.

## Baseline

Initial npm audit totals:
- Critical: 1
- High: 8
- Moderate: 1
- Total: 10

## Remediation Applied

Targeted low-risk upgrades within current major line:
- next: 14.2.3 -> 14.2.35
- eslint-config-next: 14.2.3 -> 14.2.35

Validation after upgrade:
- `npm run lint`: PASS
- `npm run build`: PASS

Build note observed (non-blocking):
- Next.js metadata viewport warning for app routes.

## Post-Remediation State

Current npm audit totals:
- Critical: 0
- High: 4
- Moderate: 0
- Total: 4

Remaining packages flagged:
- next
- eslint-config-next
- @next/eslint-plugin-next
- glob

npm indicates remaining high issues require a major jump to Next 16 / eslint-config-next 16 line.

## Risk Assessment

- Critical exposure has been removed.
- Remaining findings are tied to tooling/framework major upgrade path and are not safely auto-fixable without broader compatibility validation.

## Recommended Next Actions

1. Create a dedicated upgrade branch for Next 16 migration and lint stack alignment.
2. Upgrade `next` and `eslint-config-next` together and run full app/regression validation.
3. Resolve metadata viewport deprecation warning in app metadata exports.
4. Re-run npm audit and close remaining advisories after migration.

## Files Changed in This Triage

- package.json
- package-lock.json
- next-env.d.ts
- SECURITY_TRIAGE_2026-04-04.md

---

## Addendum - Dependabot Follow-Up (2026-04-04)

GitHub Dependabot reported 6 open alerts after the web-stack migration landed.

### Alerts Identified

- `pip/torch` in `requirements.txt`:
	- 1 critical (`< 2.6.0`)
	- 1 moderate (`<= 2.7.1`)
	- 1 low (`< 2.7.1-rc1`)
- `rust/tar` in `src-tauri/Cargo.lock`:
	- 2 moderate (`<= 0.4.44`)
- `rust/glib` in `src-tauri/Cargo.lock`:
	- 1 moderate (`>= 0.15.0, < 0.20.0`)

### Remediation Applied

- Updated `requirements.txt`:
	- `torch==2.5.1` -> `torch==2.8.0`
- Updated `src-tauri/Cargo.lock`:
	- `tar 0.4.44` -> `tar 0.4.45` via `cargo update -p tar --precise 0.4.45`

Validation:
- `cargo check`: PASS

### Remaining Risk / Constraint

- `glib` alert remains tied to Linux GTK stack pulled by Tauri v1 (`gtk`/`webkit2gtk` dependency chain).
- Addressing this cleanly requires a planned Tauri major upgrade track (v2 migration and validation), not a safe lockfile-only patch on current architecture.

### Recommended Next Action

1. Let Dependabot rescan after this commit/push and confirm `torch` + `tar` alerts auto-close.
2. Open a dedicated `tauri-v2-security-upgrade` branch to resolve the remaining `glib` advisory with full desktop regression coverage.

### Post-Push Verification

- Dependabot open alerts after push/rescan: `1`
- Remaining alert:
	- `rust/glib` in `src-tauri/Cargo.lock` (medium)
	- First patched version: `0.20.0`
