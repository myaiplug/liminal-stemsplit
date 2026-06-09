#!/usr/bin/env python3
"""Generate a release integrity manifest for installer artifacts."""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Dict, List


def sha256_file(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def collect_entries(patterns: List[str]) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []
    seen = set()
    for pattern in patterns:
        for path in glob.glob(pattern):
            norm = os.path.normpath(path)
            if norm in seen or not os.path.isfile(norm):
                continue
            seen.add(norm)
            entries.append(
                {
                    "path": norm.replace("\\", "/"),
                    "size_bytes": os.path.getsize(norm),
                    "sha256": sha256_file(norm),
                }
            )
    entries.sort(key=lambda x: x["path"])
    return entries


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pattern", action="append", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    entries = collect_entries(args.pattern)
    payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "platform": args.platform,
        "artifact_count": len(entries),
        "artifacts": entries,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote release manifest to {args.out} ({len(entries)} artifact(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
