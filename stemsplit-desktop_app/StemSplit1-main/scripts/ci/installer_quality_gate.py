#!/usr/bin/env python3
"""Installer quality gate scorer.

Computes a 0-100 score and exits non-zero if threshold is not met.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class CheckResult:
    name: str
    weight: int
    passed: bool
    details: str


def sha256_file(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def parse_checksum_file(path: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            digest = parts[0].lower()
            filename = parts[-1]
            mapping[filename] = digest
    return mapping


def pick_installer(glob_expr: str) -> Optional[str]:
    matches = sorted(glob.glob(glob_expr), key=os.path.getmtime, reverse=True)
    if not matches:
        return None
    return matches[0]


def evaluate_smoke_report(path: str) -> Tuple[bool, str]:
    if not path:
        return False, "smoke report path not provided"
    if not os.path.isfile(path):
        return False, f"smoke report not found: {path}"

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as exc:
        return False, f"invalid smoke report JSON: {exc}"

    passed = bool(payload.get("passed"))
    message = str(payload.get("message", ""))
    if passed:
        return True, message or "smoke report indicates pass"
    return False, message or "smoke report indicates failure"


def evaluate_payload_report(path: str) -> Tuple[bool, str]:
    if not path:
        return False, "payload report path not provided"
    if not os.path.isfile(path):
        return False, f"payload report not found: {path}"

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as exc:
        return False, f"invalid payload report JSON: {exc}"

    passed = bool(payload.get("passed"))
    if passed:
        return True, "payload report indicates pass"
    return False, "payload report indicates failure"


def run_checks(args: argparse.Namespace) -> Tuple[List[CheckResult], Dict[str, object]]:
    checks: List[CheckResult] = []
    metadata: Dict[str, object] = {"platform": args.platform}

    installer = pick_installer(args.installer_glob)
    metadata["installer_glob"] = args.installer_glob
    metadata["installer_path"] = installer

    artifact_exists = installer is not None and os.path.isfile(installer)
    checks.append(
        CheckResult(
            name="artifact_exists",
            weight=25,
            passed=artifact_exists,
            details=installer if installer else "No installer matched glob",
        )
    )

    size_ok = False
    size_details = "installer missing"
    if artifact_exists and installer:
        size_mb = os.path.getsize(installer) / (1024 * 1024)
        size_ok = 2.0 <= size_mb <= 6000.0
        size_details = f"{size_mb:.2f} MB"
        metadata["installer_size_mb"] = round(size_mb, 2)
    checks.append(CheckResult("size_sanity", 10, size_ok, size_details))

    checksum_present = bool(args.checksum_file and os.path.isfile(args.checksum_file))
    checks.append(
        CheckResult(
            name="checksum_manifest_present",
            weight=15,
            passed=checksum_present,
            details=args.checksum_file if checksum_present else "checksum file missing",
        )
    )

    checksum_match = False
    checksum_details = "not evaluated"
    if checksum_present and artifact_exists and installer and args.checksum_file:
        manifest = parse_checksum_file(args.checksum_file)
        installer_name = os.path.basename(installer)
        expected = manifest.get(installer_name)
        if expected:
            actual = sha256_file(installer)
            checksum_match = actual == expected
            checksum_details = (
                f"match ({installer_name})" if checksum_match else f"mismatch expected={expected} actual={actual}"
            )
        else:
            checksum_details = f"{installer_name} not found in manifest"
    checks.append(CheckResult("checksum_match", 15, checksum_match, checksum_details))

    if args.smoke_report:
        smoke_passed, smoke_details = evaluate_smoke_report(args.smoke_report)
    else:
        smoke_passed = bool(args.smoke_passed)
        smoke_details = "smoke flag set" if smoke_passed else "smoke flag not set"

    checks.append(
        CheckResult(
            name="smoke_tests_passed",
            weight=20,
            passed=smoke_passed,
            details=smoke_details,
        )
    )

    all_required = True
    missing: List[str] = []
    for req in args.required_file:
        if not os.path.isfile(req):
            all_required = False
            missing.append(req)

    payload_ok = True
    payload_details = "payload report not required"
    if args.payload_report:
        payload_ok, payload_details = evaluate_payload_report(args.payload_report)

    hardening_ok = all_required and payload_ok
    hardening_details = "all present"
    if not all_required:
        hardening_details = f"missing: {', '.join(missing)}"
    if args.payload_report:
        if hardening_details == "all present":
            hardening_details = payload_details
        else:
            hardening_details = f"{hardening_details}; {payload_details}"

    checks.append(
        CheckResult(
            name="release_hardening_files_present",
            weight=15,
            passed=hardening_ok,
            details=hardening_details,
        )
    )

    total_score = sum(c.weight for c in checks if c.passed)
    metadata["total_score"] = total_score
    metadata["threshold"] = args.threshold
    metadata["passed"] = total_score >= args.threshold

    return checks, metadata


def write_reports(checks: List[CheckResult], metadata: Dict[str, object], json_path: str, md_path: str) -> None:
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    os.makedirs(os.path.dirname(md_path), exist_ok=True)

    payload = {
        "metadata": metadata,
        "checks": [
            {
                "name": c.name,
                "weight": c.weight,
                "passed": c.passed,
                "details": c.details,
            }
            for c in checks
        ],
    }
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(payload, jf, indent=2)

    lines = [
        "# Installer Quality Gate Report",
        "",
        f"- Platform: `{metadata['platform']}`",
        f"- Score: `{metadata['total_score']}/100`",
        f"- Threshold: `{metadata['threshold']}`",
        f"- Gate: `{'PASS' if metadata['passed'] else 'FAIL'}`",
        "",
        "| Check | Weight | Result | Details |",
        "|---|---:|:---:|---|",
    ]
    for c in checks:
        lines.append(f"| `{c.name}` | {c.weight} | {'PASS' if c.passed else 'FAIL'} | {c.details} |")

    with open(md_path, "w", encoding="utf-8") as mf:
        mf.write("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=["windows", "macos"], required=True)
    parser.add_argument("--installer-glob", required=True)
    parser.add_argument("--checksum-file", default="")
    parser.add_argument("--threshold", type=int, default=90)
    parser.add_argument("--smoke-passed", action="store_true")
    parser.add_argument("--smoke-report", default="")
    parser.add_argument("--payload-report", default="")
    parser.add_argument("--required-file", action="append", default=[])
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--md-out", required=True)
    args = parser.parse_args()

    checks, metadata = run_checks(args)
    write_reports(checks, metadata, args.json_out, args.md_out)

    print(f"Installer quality score: {metadata['total_score']}/100 (threshold {metadata['threshold']})")
    if not metadata["passed"]:
        print("Quality gate FAILED", file=sys.stderr)
        return 1
    print("Quality gate PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
