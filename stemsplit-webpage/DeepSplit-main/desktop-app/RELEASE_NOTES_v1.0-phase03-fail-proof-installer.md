# StemSplit v1.0 Phase 03 - Fail-Proof Installer

Release date: 2026-04-04
Tag: v1.0-phase03-fail-proof-installer

## Highlights

- Added runtime trust marker system with SHA256 fingerprint validation.
- Implemented fast-path startup check to skip expensive import probes when runtime is trusted.
- Implemented auto-provisioning with retry and Deep Repair fallback.
- Added manual Deep Repair action in setup UX.
- Added integration test plans, validation scripts, and release readiness documentation.

## Validation Summary

- Fail-proof installer validator: 20/20 checks passed.
- Release preflight: PASS.
- Integration tests: 5/5 passed.
- Fresh installer build: successful.

## Key Artifacts

- Installer: installers/StemSplit_Setup_v0.1.0_x64.exe
- SHA256: 4BC96B8C822E794482BBA1A0D5C3341820CA954845B8D7C2CE5498E357EFC5DD
- Release manifest: installers/release-manifest-windows.local.json
- Preflight report: installers/release-preflight.local.md

## Runtime Marker

- Marker file: embedded_python/python_runtime_ready.json
- Required modules: torch, demucs, librosa, soundfile, numpy

## Operational Notes

- This release includes first-launch auto setup, staged fallback repair, and runtime marker-based trust checks.
- Follow release runbook for signing, publishing, and post-release smoke checks.
