#!/usr/bin/env python3
"""Refresh public/releases/fallback.json from the GitHub Releases API (published only)."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "releases" / "fallback.json"


def main() -> int:
    raw = subprocess.check_output(
        ["gh", "api", "repos/myaiplug/liminal-stemsplit/releases", "--paginate"],
        text=True,
    )
    releases = json.loads(raw)
    payload = []
    for r in releases:
        if r.get("draft"):
            continue
        payload.append(
            {
                "tag_name": r.get("tag_name"),
                "name": r.get("name") or r.get("tag_name"),
                "prerelease": bool(r.get("prerelease")),
                "published_at": r.get("published_at"),
                "html_url": r.get("html_url"),
                "body": r.get("body") or "",
                "assets": [
                    {
                        "name": a["name"],
                        "size": a["size"],
                        "content_type": a.get("content_type"),
                        "browser_download_url": a["browser_download_url"],
                    }
                    for a in (r.get("assets") or [])
                ],
            }
        )
    payload.sort(key=lambda x: x["published_at"] or "", reverse=True)
    now = datetime.now(ZoneInfo("America/Louisville")).isoformat(timespec="seconds")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "generated_at": now,
                "source": "https://api.github.com/repos/myaiplug/liminal-stemsplit/releases",
                "releases": payload,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"Wrote {OUT} ({len(payload)} releases, {sum(len(r['assets']) for r in payload)} assets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
