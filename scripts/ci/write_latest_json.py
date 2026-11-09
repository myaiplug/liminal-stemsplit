#!/usr/bin/env python3
"""Copy Windows release assets into release-assets/publish and write latest.json."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("release-assets/windows")
OUT = Path("release-assets/publish")
VERSION_FILE = Path("stemsplit-desktop_app/StemSplit1-main/VERSION")
REPO = "myaiplug/liminal-stemsplit"


def main() -> None:
    files = [path for path in ROOT.rglob("*") if path.is_file()]
    version = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "0.8.0"
    nsis = next((path for path in files if path.name.endswith("x64-setup.exe")), None)
    nsis_sig = next((path for path in files if path.name.endswith("x64-setup.exe.sig")), None)
    msi = next((path for path in files if path.suffix == ".msi"), None)
    msi_sig = next((path for path in files if path.name.endswith(".msi.sig")), None)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    def copy_as(src: Path, name: str) -> None:
        shutil.copy2(src, OUT / name)

    platforms = {}
    tag = f"v{version}"
    base = f"https://github.com/{REPO}/releases/download/{tag}"

    if nsis:
        name = f"NoDAW.Liminal_{version}_x64-setup.exe"
        copy_as(nsis, name)
        if nsis_sig:
            copy_as(nsis_sig, name + ".sig")
            asset = {"signature": nsis_sig.read_text().strip(), "url": f"{base}/{name}"}
            platforms["windows-x86_64"] = asset
            platforms["windows-x86_64-nsis"] = asset
    if msi:
        name = f"NoDAW.Liminal_{version}_x64_en-US.msi"
        copy_as(msi, name)
        if msi_sig:
            copy_as(msi_sig, name + ".sig")
            platforms["windows-x86_64-msi"] = {
                "signature": msi_sig.read_text().strip(),
                "url": f"{base}/{name}",
            }

    for extra in files:
        if extra in {nsis, msi, nsis_sig, msi_sig}:
            continue
        if extra.suffix.lower() in {".exe", ".sha256", ".sig"}:
            copy_as(extra, extra.name)

    if platforms:
        payload = {
            "version": version,
            "notes": f"NoDAW Liminal StemSplit v{version}",
            "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "platforms": platforms,
        }
        (OUT / "latest.json").write_text(json.dumps(payload, indent=2) + "\n")
        print("wrote latest.json for", list(platforms))
    else:
        print("no updater signatures found; skipping latest.json")


if __name__ == "__main__":
    main()
