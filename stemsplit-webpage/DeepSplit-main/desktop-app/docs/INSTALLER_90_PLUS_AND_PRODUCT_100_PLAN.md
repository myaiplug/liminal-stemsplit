# StemSplit 90+ Installer Plan and 100-Score Product Path

## Goal

- Installer score: `>= 90/100`
- Overall StemSplit score: `>= 95/100` (stretch toward 100)

This plan defines a measurable rubric, gap closure sequence, and acceptance criteria.

## Scoring Rubric

### Installer Score (100)

- Reliability and Idempotency: `25`
- Security and Trust: `25`
- UX and Recovery: `20`
- Performance and Footprint: `15`
- Observability and Supportability: `15`

### Overall Product Score (100)

- Separation Quality and Stability: `35`
- Security and Abuse Resilience: `20`
- Licensing and Revenue Controls: `15`
- Installer and Onboarding: `15`
- Runtime Performance and Hardware Adaptation: `10`
- Operability (alerts, diagnostics, support): `5`

## Current High-Risk Gaps (Priority)

- Installer output path and artifact discovery inconsistencies.
- FFmpeg packaging path mismatches causing build/install break risk.
- No cryptographic code-signing pipeline (major trust-score penalty).
- Online installer extraction logic should validate expected binaries exist post-extract.
- Missing formal installer smoke tests and upgrade-path tests in CI.

## Phase Plan

### Phase 1: Reliability Baseline (Immediate)

- Unify installer output to `installers` across `.iss` files.
- Enforce consistent FFmpeg layout (`ffmpeg\\bin\\ffmpeg.exe`, `ffmpeg\\bin\\ffprobe.exe`).
- Normalize build-step progress output and robust artifact discovery fallback.
- Add explicit post-build validation checks for required files.

Acceptance:

- Offline and online build scripts complete on clean machine.
- Produced installer discovered/opened reliably.
- FFmpeg binaries always present in expected layout.

### Phase 2: 90+ Installer Security and Trust

- Add code-signing for installer and binaries.
- Add checksum manifest generation and verification for packaged assets.
- Add installer-time verification for downloaded online artifacts.
- Harden install script error handling with clear remediation messages.

Acceptance:

- SmartScreen reputation improves over releases.
- Every downloadable artifact has SHA-256 in release notes.
- Online installer aborts safely on checksum mismatch.

### Phase 3: UX and Recovery

- Add preflight page: disk space, permissions, internet status (online mode), existing version detection.
- Add clean upgrade/rollback messaging and preserve user data guarantees.
- Improve progress messaging during large runtime/model provisioning.

Acceptance:

- Install and upgrade paths have deterministic, user-friendly outcomes.
- Support tickets for installer confusion reduced release-over-release.

### Phase 4: CI Quality Gates

- Add CI pipeline stages for installer build, silent install smoke test, uninstall/reinstall test, and upgrade test.
- Add artifact validation job to verify required files in output package.
- Add release checklist gating publication.

Acceptance:

- No release without passing installer matrix.
- Regression detection before publishing.

### Phase 5: Toward Product 100

- Quality: benchmark stems against known references and fail if SDR regresses.
- Runtime: first-run provisioning optimization and caching.
- Security: continue abuse lockout telemetry and webhook replay-safe verification on receiver.
- Licensing: maintain backend-authoritative enforcement and conversion funnel clarity.

Acceptance:

- Quality and runtime dashboards stable across releases.
- Revenue and abuse KPIs trend in desired direction.

## KPI Targets

- Installer success rate: `>= 99%` on supported OS matrix.
- Upgrade success rate: `>= 99%` from last 2 versions.
- First-run setup completion: `>= 98%`.
- Security incident alert delivery (including queue flush): `>= 99.9%` eventually delivered.
- Crash-free sessions: `>= 99.5%`.

## Execution Order (Fastest Impact First)

1. Finish Phase 1 reliability fixes and validations.
2. Add checksum manifest + verification path.
3. Add installer smoke tests in CI.
4. Add signing pipeline.
5. Iterate UX and telemetry improvements.

## Definition of Done for 90+

- Installer rubric score reaches 90+ in release checklist.
- No critical path mismatches in packaging/install.
- Security and reliability gates enforced in CI.

## Definition of Done for Near-100 Overall

- Installer 90+ sustained for 3 consecutive releases.
- Separation quality and runtime regressions blocked by automated checks.
- Security and licensing enforcement proven stable in production telemetry.
