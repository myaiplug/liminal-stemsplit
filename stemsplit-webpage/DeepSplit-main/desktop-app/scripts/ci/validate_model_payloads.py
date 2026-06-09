#!/usr/bin/env python3
"""Validate optional model payload folders against a manifest.

This keeps large downloaded assets out of git while still enforcing basic
release hygiene and structure for offline installers.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class PayloadResult:
    name: str
    root: str
    exists: bool
    required_ok: bool
    forbidden_ok: bool
    forbidden_mode: str
    size_ok: bool
    file_count: int
    size_mb: float
    missing_required: List[str]
    forbidden_found: List[str]
    details: str

    @property
    def passed(self) -> bool:
        if not self.exists:
            return True
        return self.required_ok and self.forbidden_ok and self.size_ok


def _norm(path: str) -> str:
    return path.replace("\\", "/")


def evaluate_payload(repo_root: str, payload: Dict[str, object]) -> PayloadResult:
    name = str(payload["name"])
    rel_root = str(payload["root"])
    root = os.path.join(repo_root, rel_root)
    optional = bool(payload.get("optional", True))
    forbidden_mode = str(payload.get("forbidden_mode", "fail")).lower()
    if forbidden_mode not in {"fail", "warn"}:
        forbidden_mode = "fail"

    exists = os.path.isdir(root)
    if not exists:
        details = "missing (optional)" if optional else "missing (required)"
        return PayloadResult(
            name=name,
            root=rel_root,
            exists=False,
            required_ok=optional,
            forbidden_ok=optional,
            forbidden_mode=forbidden_mode,
            size_ok=optional,
            file_count=0,
            size_mb=0.0,
            missing_required=[] if optional else [rel_root],
            forbidden_found=[],
            details=details,
        )

    required_paths = [str(p) for p in payload.get("required_paths", [])]
    missing_required: List[str] = []
    for rel in required_paths:
        if not os.path.exists(os.path.join(root, rel)):
            missing_required.append(rel)

    forbidden_globs = [str(p) for p in payload.get("forbidden_globs", [])]
    forbidden_found: List[str] = []
    for pattern in forbidden_globs:
        abs_pattern = os.path.join(root, pattern)
        for found in glob.glob(abs_pattern, recursive=True):
            if os.path.isdir(found):
                continue
            rel_found = os.path.relpath(found, root)
            forbidden_found.append(_norm(rel_found))

    # Deduplicate and keep report concise.
    forbidden_found = sorted(set(forbidden_found))

    file_count = 0
    total_bytes = 0
    for walk_root, _, files in os.walk(root):
        for f in files:
            file_count += 1
            fp = os.path.join(walk_root, f)
            try:
                total_bytes += os.path.getsize(fp)
            except OSError:
                pass

    size_mb = total_bytes / (1024 * 1024)
    max_size_mb = payload.get("max_size_mb")
    size_ok = True
    if max_size_mb is not None:
        size_ok = size_mb <= float(max_size_mb)

    required_ok = len(missing_required) == 0
    forbidden_ok = len(forbidden_found) == 0
    if forbidden_mode == "warn":
        forbidden_ok = True

    parts: List[str] = []
    parts.append(f"files={file_count}")
    parts.append(f"size_mb={size_mb:.2f}")
    if not required_ok:
        parts.append("missing=" + ", ".join(missing_required))
    if not forbidden_ok:
        preview = ", ".join(forbidden_found[:8])
        suffix = " ..." if len(forbidden_found) > 8 else ""
        parts.append(f"forbidden={preview}{suffix}")
    elif forbidden_mode == "warn" and len(forbidden_found) > 0:
        preview = ", ".join(forbidden_found[:8])
        suffix = " ..." if len(forbidden_found) > 8 else ""
        parts.append(f"forbidden(warn)={preview}{suffix}")
    if not size_ok and max_size_mb is not None:
        parts.append(f"max_size_mb={float(max_size_mb):.2f}")

    return PayloadResult(
        name=name,
        root=rel_root,
        exists=True,
        required_ok=required_ok,
        forbidden_ok=forbidden_ok,
        forbidden_mode=forbidden_mode,
        size_ok=size_ok,
        file_count=file_count,
        size_mb=round(size_mb, 2),
        missing_required=missing_required,
        forbidden_found=forbidden_found,
        details="; ".join(parts),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--md-out", required=True)
    args = parser.parse_args()

    with open(args.manifest, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    payloads = manifest.get("payloads", [])
    results = [evaluate_payload(args.repo_root, p) for p in payloads]
    passed = all(r.passed for r in results)

    out = {
        "manifest": args.manifest,
        "repo_root": os.path.abspath(args.repo_root),
        "passed": passed,
        "payloads": [
            {
                "name": r.name,
                "root": r.root,
                "exists": r.exists,
                "passed": r.passed,
                "required_ok": r.required_ok,
                "forbidden_ok": r.forbidden_ok,
                "forbidden_mode": r.forbidden_mode,
                "size_ok": r.size_ok,
                "file_count": r.file_count,
                "size_mb": r.size_mb,
                "missing_required": r.missing_required,
                "forbidden_found": r.forbidden_found,
                "details": r.details,
            }
            for r in results
        ],
    }

    os.makedirs(os.path.dirname(args.json_out), exist_ok=True)
    os.makedirs(os.path.dirname(args.md_out), exist_ok=True)

    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    lines = [
        "# Model Payload Validation Report",
        "",
        f"- Manifest: `{args.manifest}`",
        f"- Result: `{'PASS' if passed else 'FAIL'}`",
        "",
        "| Payload | Exists | Result | Details |",
        "|---|:---:|:---:|---|",
    ]
    for r in results:
        lines.append(
            f"| `{r.name}` | {'yes' if r.exists else 'no'} | {'PASS' if r.passed else 'FAIL'} | {r.details} |"
        )

    with open(args.md_out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Model payload validation: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
