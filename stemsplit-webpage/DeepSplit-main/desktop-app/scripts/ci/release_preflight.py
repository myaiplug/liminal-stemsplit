#!/usr/bin/env python3
"""Release preflight checks for StemSplit.

Validates core release files, download docs links, and evidence reports.
Outputs JSON and Markdown reports and exits non-zero on hard failures.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from dataclasses import dataclass
from typing import List


@dataclass
class Check:
    name: str
    passed: bool
    severity: str
    details: str


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _summarize_output(stdout: str, stderr: str, max_len: int = 500) -> str:
    parts = []
    if stdout.strip():
        parts.append(f"stdout: {stdout.strip()}")
    if stderr.strip():
        parts.append(f"stderr: {stderr.strip()}")

    if not parts:
        return "no output"

    combined = " | ".join(parts)
    if len(combined) <= max_len:
        return combined
    return combined[: max_len - 3] + "..."


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--md-out", required=True)
    parser.add_argument(
        "--run-billing-smoke",
        action="store_true",
        help="Run billing webhook smoke checks as part of preflight.",
    )
    parser.add_argument(
        "--billing-smoke-command",
        default="npm run billing:test:webhooks",
        help="Command used for billing smoke checks when --run-billing-smoke is enabled.",
    )
    args = parser.parse_args()

    root = os.path.abspath(args.repo_root)

    required_files = [
        ".github/workflows/installer-windows.yml",
        ".github/workflows/installer-macos.yml",
        ".github/workflows/windows-release-signed.yml",
        ".github/workflows/macos-release-signed-notarized.yml",
        "scripts/ci/installer_quality_gate.py",
        "scripts/ci/validate_model_payloads.py",
        "scripts/ci/model_payload_manifest.json",
        "scripts/sign_windows_release.ps1",
        "build_complete_installer.ps1",
        "build_online_installer_mac.sh",
        "docs/CODE_SIGNING_WINDOWS.md",
        "docs/CODE_SIGNING_MACOS.md",
        "docs/INSTALLER_QUALITY_GATE.md",
        "README_DOWNLOAD.md",
    ]

    checks: List[Check] = []

    missing: List[str] = []
    for rel in required_files:
        if not os.path.isfile(os.path.join(root, rel)):
            missing.append(rel)
    checks.append(
        Check(
            name="required_release_files",
            passed=len(missing) == 0,
            severity="error",
            details="all required files present" if not missing else "missing: " + ", ".join(missing),
        )
    )

    readme_path = os.path.join(root, "README_DOWNLOAD.md")
    readme = _read_text(readme_path) if os.path.isfile(readme_path) else ""

    checks.append(
        Check(
            name="download_readme_no_placeholders",
            passed=("yourusername" not in readme.lower()),
            severity="error",
            details="README_DOWNLOAD.md does not contain placeholder username",
        )
    )

    checks.append(
        Check(
            name="download_readme_repo_links",
            passed=(
                "github.com/myaiplug/StemSplit1/releases" in readme
                or "github.com/myaiplug/stemsplit1/releases" in readme
            ),
            severity="error",
            details="README_DOWNLOAD.md points to StemSplit1 release URLs",
        )
    )

    checks.append(
        Check(
            name="download_readme_current_artifact_names",
            passed=("Online" in readme and "StemSplit_Online_Setup.dmg" in readme),
            severity="warn",
            details="README_DOWNLOAD.md references current online installer naming",
        )
    )

    evidence_files = [
        "installers/smoke-windows.local.json",
        "installers/model-payload-report.local.json",
        "installers/quality-gate-windows.local.json",
    ]
    missing_evidence = [p for p in evidence_files if not os.path.isfile(os.path.join(root, p))]
    checks.append(
        Check(
            name="local_evidence_reports_present",
            passed=len(missing_evidence) == 0,
            severity="warn",
            details="all local evidence reports present" if not missing_evidence else "missing: " + ", ".join(missing_evidence),
        )
    )

    if args.run_billing_smoke:
        try:
            result = subprocess.run(
                args.billing_smoke_command,
                cwd=root,
                shell=True,
                capture_output=True,
                text=True,
            )
            checks.append(
                Check(
                    name="billing_webhook_smoke",
                    passed=result.returncode == 0,
                    severity="error",
                    details=(
                        f"billing smoke command passed ({args.billing_smoke_command})"
                        if result.returncode == 0
                        else f"billing smoke command failed ({args.billing_smoke_command}) | {_summarize_output(result.stdout, result.stderr)}"
                    ),
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    name="billing_webhook_smoke",
                    passed=False,
                    severity="error",
                    details=f"billing smoke execution error: {exc}",
                )
            )
    else:
        checks.append(
            Check(
                name="billing_webhook_smoke",
                passed=True,
                severity="warn",
                details="skipped (enable with --run-billing-smoke)",
            )
        )

    hard_fail = any((not c.passed and c.severity == "error") for c in checks)

    payload = {
        "repo_root": root,
        "passed": not hard_fail,
        "checks": [
            {
                "name": c.name,
                "passed": c.passed,
                "severity": c.severity,
                "details": c.details,
            }
            for c in checks
        ],
    }

    json_dir = os.path.dirname(args.json_out) or "."
    md_dir = os.path.dirname(args.md_out) or "."
    os.makedirs(json_dir, exist_ok=True)
    os.makedirs(md_dir, exist_ok=True)

    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    lines = [
        "# Release Preflight Report",
        "",
        f"- Repo: `{root}`",
        f"- Result: `{'PASS' if not hard_fail else 'FAIL'}`",
        "",
        "| Check | Severity | Result | Details |",
        "|---|---|:---:|---|",
    ]
    for c in checks:
        lines.append(
            f"| `{c.name}` | `{c.severity}` | {'PASS' if c.passed else 'FAIL'} | {c.details} |"
        )

    with open(args.md_out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Release preflight: {'PASS' if not hard_fail else 'FAIL'}")
    return 0 if not hard_fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
