# Tauri v2 Security Upgrade Plan

## Objective
Resolve the final open Dependabot alert (`rust/glib`, medium) by migrating from Tauri v1 to Tauri v2, then validating desktop behavior and installer reliability.

## Current Baseline (2026-04-04)

- Branch: `tauri-v2-security-upgrade`
- Remaining alert:
  - Ecosystem: `rust`
  - Package: `glib`
  - Manifest: `src-tauri/Cargo.lock`
  - First patched: `0.20.0`
- Root cause:
  - `glib 0.15.x` is pulled through the Tauri v1 Linux GTK stack (`tauri` -> `wry`/`webkit2gtk` -> `gtk` -> `glib`).

## Evidence Collected

- `src-tauri/Cargo.toml` is currently on:
  - `tauri = "1.6"`
  - `tauri-build = "1.5"`
- Frontend currently imports v1 APIs:
  - `@tauri-apps/api/tauri`
  - `@tauri-apps/api/shell`
  - `@tauri-apps/api/fs`

## Migration Strategy

### Phase 1: Dependency and Config Migration

1. Upgrade JS packages:
   - `@tauri-apps/api` -> `^2`
   - `@tauri-apps/cli` -> `^2` (dev dependency)
2. Upgrade Rust crates:
   - `tauri` -> `2`
   - `tauri-build` -> `2`
3. Migrate Tauri configuration schema in `src-tauri/tauri.conf.json`:
   - remove v1 `allowlist`
   - define v2 capability model
4. Add capability files (for example `src-tauri/capabilities/default.json`) to permit only required commands/scopes.

### Phase 2: Frontend API Surface Updates

1. Replace imports:
   - `@tauri-apps/api/tauri` -> `@tauri-apps/api/core` (for `invoke`, `convertFileSrc`)
2. Replace plugin-scoped APIs:
   - `@tauri-apps/api/shell` -> `@tauri-apps/plugin-shell`
   - `@tauri-apps/api/fs` -> `@tauri-apps/plugin-fs`
3. Keep `@tauri-apps/api/event` where supported by v2 API.

### Phase 3: Rust App Builder/Plugin Wiring

1. Register required plugins in `src-tauri/src/main.rs` (shell/fs/dialog as needed).
2. Confirm all existing `#[tauri::command]` handlers still compile and are registered.
3. Rebuild lockfile and verify `glib` chain is upgraded past vulnerable range.

### Phase 4: Validation and Regression

1. `npm run lint`
2. `npm run build`
3. `cd src-tauri && cargo check`
4. `./validate_fail_proof_installer.ps1`
5. Manual desktop smoke tests:
   - app boot
   - file selection + split invoke
   - progress events
   - open-results-folder flow
   - Python auto-repair flow

## Non-Goals (This Branch)

- Feature expansion unrelated to migration.
- Visual/UI redesign.
- Packaging pipeline redesign.

## Risks

1. Permission model mismatch during capability migration.
2. Plugin behavior differences (shell/fs/dialog) from v1 allowlist behavior.
3. Runtime regressions in long-running invoke/event workflows.

## Exit Criteria

1. Dependabot `glib` alert closes after merge.
2. Lint/build/cargo/installer validator all pass.
3. Desktop smoke tests pass for separation + repair flows.
4. Changes are documented in `SECURITY_TRIAGE_2026-04-04.md` addendum.

## Progress Update (2026-04-04)

Completed on this branch:

- Frontend API migration to v2 namespaces/plugins:
  - `@tauri-apps/api/core` for `invoke`/`convertFileSrc`
  - `@tauri-apps/plugin-dialog` for dialog APIs
  - `@tauri-apps/plugin-shell` for external open
  - `@tauri-apps/plugin-fs` for binary file fallback reads
- JS dependency upgrades:
  - `@tauri-apps/api` -> `^2.0.0`
  - `@tauri-apps/cli` -> `^2.0.0`
  - added plugin packages (`dialog`, `shell`, `fs`)
- Rust migration:
  - `tauri` -> `2`
  - `tauri-build` -> `2`
  - added plugin crates and builder registration
  - migrated to v2 `tauri.conf.json` schema (`productName`/`identifier`/`app`/`bundle`)
  - updated runtime APIs (`Emitter` trait import, `get_webview_window`)

Validation status on branch:

- `npm run lint`: PASS
- `npm run build`: PASS
- `cd src-tauri && cargo check`: PASS
- `./validate_fail_proof_installer.ps1`: PASS (20/20)

Current blocker:

- `glib` remains at `0.18.5` through `tauri v2.10.3` Linux GTK dependency chain.
- Forced upgrade test failed:
  - `cargo update -p glib --precise 0.20.0`
  - blocked by `gtk ^0.18` required by current Tauri ecosystem.

Conclusion:

- The remaining Dependabot alert cannot be closed by local lockfile pinning in this stack.
- Final closure depends on upstream Tauri/GTK chain adopting `glib >= 0.20`, or a policy decision to suppress Linux-only advisory risk for Windows-only shipping targets.
