"""Checksum-pinned, multi-mirror downloads for model weights whose original host disappeared.

BS-Roformer-SW (6-stem) was published on Hugging Face as ``jarredou/BS-Roformer-SW``. That account was
deleted, so the repo now answers 401/404. The identical checkpoint (same SHA-256) is still served by
several mirrors; every mirror below was downloaded and hashed on 2026-11-18 and pinned to an immutable
revision (GitHub release asset or Hugging Face commit SHA). A file is only accepted if its SHA-256
matches, so a mirror that changes or serves an error page is skipped instead of breaking a split.

Licence: upstream declares no licence for these weights. They are never bundled with Liminal; they are
downloaded on first use from third-party hosts. See THIRD_PARTY_LICENSES.md.
"""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

SW_CKPT_SHA256 = "24e7d35ee9c64415673d3fd33e06a67cac2c103c5df6267ba1576459c775916e"
SW_CKPT_SIZE = 699_412_152
# audio-separator's BS-Roformer-SW.yaml (inference.dim_t = 801). This is the config audio-separator
# itself checks (model-checksums.json) and what Liminal has always run with.
SW_YAML_SHA256 = "b558996f1e25eb48798bd6502505a5de94c4f966d6edfb1a0420f06cc40b501a"
SW_YAML_SIZE = 4_653
# The Hugging Face mirrors ship the original MSST yaml (inference.dim_t = 1101, no trailing newline).
SW_YAML_HF_SHA256 = "f9fada9f94e5ba2d2e4600196299459294bc5f532b314c209cc156ac63e4329b"

_AS_RELEASE = "https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs"
_HF_ENERJAZZER = "https://huggingface.co/enerjazzer/BS-ROFO-SW-Fixed/resolve/a443a2985534b3bc815ef54a5d446c6a0390f974"
_HF_FRACTAL = "https://huggingface.co/FractalSurfer/BS-RoFormer-SW-6stem/resolve/2b98254b19bdab07ce225d884ec4aa9dd8aafce1"
_HF_NOSHIBEST = "https://huggingface.co/Noshibest/BS-Roformer-SW/resolve/427a4331a8999ce255117a5e9df9ed7f9b148e42"


def sw_yaml_from_msst(raw: bytes) -> bytes:
    """Turn the MSST/HF BS-Roformer-SW yaml into audio-separator's byte-identical variant (dim_t 801)."""
    old = b"  dim_t: 1101"
    if raw.count(old) != 1:
        raise ValueError("unexpected BS-Roformer-SW yaml layout")
    return raw.replace(old, b"  dim_t: 801  # Changed from 1101 to match training").rstrip(b"\n") + b"\n\n"


TRANSFORMS: Dict[str, Callable[[bytes], bytes]] = {"sw_yaml_dim_t_801": sw_yaml_from_msst}

# bundle id -> cache filename -> spec. ``sources`` are tried in order.
MIRRORED_BUNDLES: Dict[str, Dict[str, Dict[str, Any]]] = {
    "BS-Roformer-SW": {
        "BS-Roformer-SW.ckpt": {
            "sha256": SW_CKPT_SHA256,
            "size": SW_CKPT_SIZE,
            "sources": [
                {"url": f"{_AS_RELEASE}/BS-Roformer-SW.ckpt", "host": "python-audio-separator GitHub release"},
                {"url": f"{_HF_ENERJAZZER}/BS-Rofo-SW-Fixed.ckpt", "host": "HF enerjazzer/BS-ROFO-SW-Fixed"},
                {"url": f"{_HF_FRACTAL}/BS-Rofo-SW-Fixed.ckpt", "host": "HF FractalSurfer/BS-RoFormer-SW-6stem"},
                {"url": f"{_HF_NOSHIBEST}/BS-Roformer-SW.ckpt", "host": "HF Noshibest/BS-Roformer-SW"},
            ],
        },
        "BS-Roformer-SW.yaml": {
            "sha256": SW_YAML_SHA256,
            "size": SW_YAML_SIZE,
            "sources": [
                {"url": f"{_AS_RELEASE}/BS-Roformer-SW.yaml", "host": "python-audio-separator GitHub release"},
                {"url": f"{_HF_ENERJAZZER}/BS-Rofo-SW-Fixed.yaml", "host": "HF enerjazzer/BS-ROFO-SW-Fixed",
                 "sha256": SW_YAML_HF_SHA256, "transform": "sw_yaml_dim_t_801"},
                {"url": f"{_HF_FRACTAL}/BS-Rofo-SW-Fixed.yaml", "host": "HF FractalSurfer/BS-RoFormer-SW-6stem",
                 "sha256": SW_YAML_HF_SHA256, "transform": "sw_yaml_dim_t_801"},
            ],
        },
    },
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def file_ok(path: Path, spec: Dict[str, Any], full_hash: bool = False) -> bool:
    """Size check by default (cheap, every split); ``full_hash`` re-hashes the whole file."""
    try:
        if not path.is_file() or path.stat().st_size != spec["size"]:
            return False
    except OSError:
        return False
    return sha256_file(path) == spec["sha256"] if full_hash else True


def _default_downloader():
    import model_doctor
    return model_doctor.try_download


def fetch_file(target: Path, spec: Dict[str, Any], downloader: Optional[Callable[..., Dict[str, Any]]] = None,
               progress: Optional[Callable[[int, int], None]] = None) -> Dict[str, Any]:
    """Download ``target`` from the first mirror whose bytes match the pinned SHA-256."""
    downloader = downloader or _default_downloader()
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    errors: List[str] = []
    for src in spec["sources"]:
        transform = src.get("transform")
        dest = target.with_name(target.name + ".mirror") if transform else target
        res = downloader(src["url"], dest, expected_sha256=src.get("sha256", spec["sha256"]), progress=progress)
        if not res.get("ok"):
            errors.append(f"{src['host']}: {res.get('detail')}")
            logger.warning(f"Mirror failed for {target.name} ({src['host']}): {res.get('detail')}")
            continue
        if transform:
            try:
                data = TRANSFORMS[transform](dest.read_bytes())
                if hashlib.sha256(data).hexdigest() != spec["sha256"]:
                    raise ValueError("sha256 mismatch after transform")
                tmp = target.with_name(target.name + ".part")
                tmp.write_bytes(data)
                os.replace(tmp, target)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{src['host']}: {exc}")
                continue
            finally:
                try:
                    dest.unlink()
                except OSError:
                    pass
        logger.info(f"Fetched {target.name} from {src['host']} (sha256 verified)")
        return {"ok": True, "detail": f"{target.name} from {src['host']}", "host": src["host"]}
    return {"ok": False, "detail": f"all mirrors failed for {target.name}: " + " | ".join(errors)}


def ensure_bundle(model_dir: Path, bundle_id: str, downloader: Optional[Callable[..., Dict[str, Any]]] = None,
                  progress: Optional[Callable[[int, int], None]] = None) -> Dict[str, Any]:
    """Make every file of a mirrored bundle present in ``model_dir`` (size check, then verified download)."""
    files = MIRRORED_BUNDLES.get(bundle_id)
    if files is None:
        return {"ok": False, "detail": f"unknown mirrored bundle {bundle_id}"}
    model_dir = Path(model_dir)
    errors: List[str] = []
    for name, spec in files.items():
        target = model_dir / name
        if file_ok(target, spec):
            continue
        if target.exists():
            # Wrong size: truncated download or an HTML error page from the dead host. Replace it.
            logger.warning(f"{name} has unexpected size; re-downloading")
            try:
                target.unlink()
            except OSError:
                pass
        res = fetch_file(target, spec, downloader=downloader, progress=progress)
        if not res["ok"]:
            errors.append(res["detail"])
    return {"ok": not errors, "detail": "; ".join(errors) or f"{bundle_id} ready"}
