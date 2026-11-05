"""Runtime + model health checks and repairs ("the doctor").

Used three ways:
  * split_recovery.py calls ``repair_variant`` / ``repair_import`` mid-split;
  * the app runs ``--post-update`` after a self-update to verify/repair the
    embedded Python and the script files;
  * Settings -> "Repair engine" runs ``--doctor``.

CLI (all print one JSON document on stdout, human logs on stderr):
    python model_doctor.py --check-runtime
    python model_doctor.py --doctor [--repair] [--variant ID ...]
    python model_doctor.py --repair-variant ID
    python model_doctor.py --heal-scripts
    python model_doctor.py --post-update [--app-version X.Y.Z] [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_RAW = "https://raw.githubusercontent.com/myaiplug/liminal-stemsplit"
APP_SUBDIR = "stemsplit-desktop_app/StemSplit1-main/scripts"

REQUIRED_MODULES = ["torch", "demucs", "librosa", "soundfile", "numpy"]
OPTIONAL_MODULES = ["audio_separator", "onnxruntime", "torchvision", "pedalboard", "pydub",
                    "psutil", "pynvml", "pyloudnorm", "resampy", "yt_dlp", "huggingface_hub"]

# Script files the app cannot work without.
REQUIRED_SCRIPT_FILES = [
    "splitter.py", "model_registry.py", "hardware.py", "split_recovery.py",
    "model_doctor.py", "model_catalog.py", "gpu_runtime.py", "liminal_paths.py",
]

IMPORT_TO_PIP = {
    "demucs": "demucs==4.0.1",
    "librosa": "librosa",
    "soundfile": "soundfile",
    "numpy": "numpy",
    "resampy": "resampy",
    "tqdm": "tqdm",
    "pedalboard": "pedalboard>=0.8.0",
    "pydub": "pydub>=0.25.1",
    "psutil": "psutil",
    "pynvml": "pynvml",
    "pyloudnorm": "pyloudnorm",
    "yt_dlp": "yt-dlp",
    "whisper": "openai-whisper",
    "audio_separator": "audio-separator",
    "onnx2torch": "onnx2torch",
    "onnxruntime": "onnxruntime",
    "huggingface_hub": "huggingface_hub",
    "yaml": "pyyaml",
    "requests": "requests",
    "ml_collections": "ml_collections",
    "einops": "einops",
    "rotary_embedding_torch": "rotary-embedding-torch",
    "beartype": "beartype",
    "julius": "julius",
    "diffq": "diffq",
    "lameenc": "lameenc",
    "openunmix": "openunmix",
}


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _pip(args: List[str], runner: Callable[..., Any] = subprocess.run, timeout: int = 1800):
    cmd = [sys.executable, "-m", "pip", *args, "--no-warn-script-location", "--disable-pip-version-check"]
    kwargs: Dict[str, Any] = {"capture_output": True, "text": True, "timeout": timeout}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000
    return runner(cmd, **kwargs)


# ---------------------------------------------------------------------------
# Runtime checks
# ---------------------------------------------------------------------------

def _can_import(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def check_runtime() -> Dict[str, Any]:
    """Cheap health check: required/optional modules, GPU state, ffmpeg. No heavy imports unless needed."""
    missing_required = [m for m in REQUIRED_MODULES if not _can_import(m)]
    missing_optional = [m for m in OPTIONAL_MODULES if not _can_import(m)]
    report: Dict[str, Any] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "missing_required": missing_required,
        "missing_optional": missing_optional,
        "issues": [],
    }
    try:
        import gpu_runtime
        report["nvidia"] = gpu_runtime.detect_nvidia()
    except Exception as exc:
        report["nvidia"] = {"present": False}
        report["issues"].append(f"gpu detection failed: {exc}")
    # Real import test for the heavy deps (find_spec can pass while the DLLs are broken).
    broken: List[str] = []
    for module in ("torch", "demucs.pretrained"):
        if module.split(".")[0] in missing_required:
            continue
        try:
            importlib.import_module(module)
        except Exception as exc:
            broken.append(f"{module}: {type(exc).__name__}: {str(exc)[:160]}")
    report["broken_imports"] = broken
    try:
        import torch  # type: ignore
        report["torch"] = torch.__version__
        report["cuda_available"] = bool(torch.cuda.is_available())
    except Exception:
        report["torch"] = None
        report["cuda_available"] = False
    try:
        import onnxruntime as ort  # type: ignore
        report["onnx_providers"] = list(ort.get_available_providers())
    except Exception:
        report["onnx_providers"] = []
    nv = report.get("nvidia") or {}
    if nv.get("present") and nv.get("driver_ok") and not report["cuda_available"]:
        report["issues"].append("NVIDIA GPU present but torch cannot use CUDA - GPU runtime install recommended")
    try:
        from split_recovery import find_ffmpeg
        report["ffmpeg"] = find_ffmpeg()
    except Exception:
        report["ffmpeg"] = shutil.which("ffmpeg")
    if not report["ffmpeg"]:
        report["issues"].append("ffmpeg not found (re-encoding of problem files unavailable)")
    report["ok"] = not missing_required and not broken
    return report


def torch_companion_spec(torch_version: str, module: str) -> Optional[Dict[str, Any]]:
    """pip spec for torchvision/torchaudio matching an installed torch, or None if none exists."""
    m = re.match(r"(\d+)\.(\d+)\.(\d+)(?:\+(\w+))?", torch_version or "")
    if not m:
        return None
    major, minor, patch, local = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4) or "cpu"
    if module == "torchvision":
        version = f"0.{minor + 15}.{patch}"
    elif module == "torchaudio":
        if minor > 9:      # PyTorch stopped shipping torchaudio wheels after 2.9
            return None
        version = f"{major}.{minor}.{patch}"
    else:
        return None
    index = f"https://download.pytorch.org/whl/{local}"
    return {"spec": f"{module}=={version}+{local}", "index": index}


def repair_import(module: Optional[str], runner: Callable[..., Any] = subprocess.run) -> Dict[str, Any]:
    """pip-install the package behind a missing module and confirm it imports."""
    if not module:
        # No specific module named: repair every missing required module.
        missing = [m for m in REQUIRED_MODULES if not _can_import(m) and m != "torch"]
        if not missing:
            return {"ok": True, "detail": "nothing to repair"}
        results = [repair_import(m, runner) for m in missing]
        return {"ok": all(r["ok"] for r in results), "detail": "; ".join(r["detail"] for r in results)}
    module = module.split(".")[0]
    if module in ("torchvision", "torchaudio"):
        try:
            import torch  # type: ignore
            plan = torch_companion_spec(torch.__version__, module)
        except Exception:
            plan = None
        if not plan:
            return {"ok": False, "detail": f"no matching {module} wheel for this torch"}
        proc = _pip(["install", "--no-deps", "--force-reinstall", plan["spec"], "--index-url", plan["index"]], runner)
    elif module == "torch":
        return {"ok": False, "detail": "torch is repaired by the runtime installer (Settings > Repair engine)"}
    else:
        spec = IMPORT_TO_PIP.get(module, module.replace("_", "-"))
        proc = _pip(["install", spec], runner)
    importlib.invalidate_caches()
    ok = proc.returncode == 0 and _can_import(module)
    detail = f"installed {module}" if ok else f"pip failed for {module}: {(proc.stderr or '')[-200:]}"
    return {"ok": ok, "detail": detail}


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------

def try_download(url: str, dest: Path, expected_sha256: Optional[str] = None,
                 expected_size: Optional[int] = None, retries: int = 3, timeout: int = 60,
                 progress: Optional[Callable[[int, int], None]] = None,
                 opener: Callable[..., Any] = urllib.request.urlopen,
                 sleep: Callable[[float], None] = time.sleep) -> Dict[str, Any]:
    """Atomic, verified download with retries. Never leaves a partial file at ``dest``."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last_error = ""
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LiminalStemSplit/0.7"})
            sha = hashlib.sha256()
            total = 0
            with opener(req, timeout=timeout) as resp, open(part, "wb") as fh:
                length = int(resp.headers.get("Content-Length") or 0) if hasattr(resp, "headers") else 0
                while True:
                    block = resp.read(1 << 20)
                    if not block:
                        break
                    fh.write(block)
                    sha.update(block)
                    total += len(block)
                    if progress:
                        progress(total, length)
            if total == 0:
                raise RuntimeError("empty response")
            if expected_size and total != expected_size:
                raise RuntimeError(f"size mismatch: got {total}, expected {expected_size}")
            if expected_sha256 and sha.hexdigest().lower() != expected_sha256.lower():
                raise RuntimeError("sha256 mismatch")
            os.replace(part, dest)
            return {"ok": True, "detail": f"downloaded {dest.name} ({total} bytes)", "bytes": total,
                    "sha256": sha.hexdigest()}
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            try:
                part.unlink()
            except OSError:
                pass
            if attempt < retries:
                sleep(min(2 ** attempt, 8))
    return {"ok": False, "detail": f"download failed for {url}: {last_error}"}


def try_audio_separator_download(filename: str, model_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Ask audio-separator itself to fetch a model (+ yaml config) by filename."""
    from liminal_paths import audio_separator_model_dir
    model_dir = Path(model_dir or audio_separator_model_dir())
    model_dir.mkdir(parents=True, exist_ok=True)
    try:
        from audio_separator.separator import Separator  # type: ignore
        import tempfile
        sep = Separator(model_file_dir=str(model_dir), output_dir=tempfile.mkdtemp(prefix="stemsplit_dl_"),
                        info_only=False, log_level=40)
        sep.download_model_files(filename)
        ok = (model_dir / filename).is_file()
        return {"ok": ok, "detail": f"audio-separator fetched {filename}" if ok else f"{filename} not present after download"}
    except ImportError as exc:
        return {"ok": False, "detail": f"audio-separator not installed: {exc}"}
    except Exception as exc:
        return {"ok": False, "detail": f"audio-separator download failed: {type(exc).__name__}: {str(exc)[:200]}"}


def try_hf_bundle(bundle_id: str, model_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Fetch a ckpt+yaml pair described in INSTRUMENT_HF_BUNDLES from Hugging Face."""
    from model_registry import INSTRUMENT_HF_BUNDLES
    from liminal_paths import audio_separator_model_dir
    bundle = INSTRUMENT_HF_BUNDLES.get(bundle_id)
    if not bundle:
        return {"ok": False, "detail": f"unknown HF bundle {bundle_id}"}
    model_dir = Path(model_dir or audio_separator_model_dir())
    errors: List[str] = []
    for cache_name, remote_name in bundle["files"].items():
        target = model_dir / cache_name
        if target.is_file() and file_looks_valid(target):
            continue
        url = f"https://huggingface.co/{bundle['repo_id']}/resolve/main/{remote_name}"
        res = try_download(url, target)
        if not res["ok"]:
            if bundle.get("optional"):
                continue
            errors.append(res["detail"])
    return {"ok": not errors, "detail": "; ".join(errors) or f"HF bundle {bundle_id} ready"}


def try_msst_bundle(bundle_key: str, model_dir: Optional[Path] = None) -> Dict[str, Any]:
    from model_registry import MSST_MODEL_BUNDLES
    from liminal_paths import audio_separator_model_dir
    bundle = MSST_MODEL_BUNDLES.get(bundle_key)
    if not bundle:
        return {"ok": False, "detail": f"unknown MSST bundle {bundle_key}"}
    model_dir = Path(model_dir or audio_separator_model_dir())
    errors: List[str] = []
    for cache_name, url in bundle["files"].items():
        target = model_dir / cache_name
        if target.is_file() and file_looks_valid(target):
            continue
        res = try_download(url, target)
        if not res["ok"]:
            errors.append(res["detail"])
    return {"ok": not errors, "detail": "; ".join(errors) or f"MSST bundle {bundle_key} ready"}


# ---------------------------------------------------------------------------
# File validation + variant repair
# ---------------------------------------------------------------------------

def file_looks_valid(path: Path) -> bool:
    """Cheap structural check so truncated/HTML-error downloads are detected."""
    try:
        size = path.stat().st_size
        if size < 64:
            return False
        suffix = path.suffix.lower()
        with open(path, "rb") as fh:
            head = fh.read(16)
        if suffix in (".ckpt", ".pth", ".pt", ".th", ".bin"):
            return zipfile.is_zipfile(path) or head[:1] == b"\x80"
        if suffix == ".onnx":
            return head[:1] in (b"\x08", b"\x3a") and not head.lstrip().startswith(b"<")
        if suffix in (".yaml", ".yml"):
            text = path.read_text(encoding="utf-8", errors="strict")
            return bool(text.strip()) and not text.lstrip().lower().startswith("<!doctype")
        return True
    except (OSError, UnicodeDecodeError):
        return False


def variant_files(meta: Dict[str, Any]) -> List[str]:
    """Filenames in the audio-separator cache that a variant needs."""
    from model_registry import MSST_MODEL_BUNDLES, INSTRUMENT_HF_BUNDLES
    names: List[str] = []
    if meta.get("filename"):
        names.append(meta["filename"])
    for key, table in (("msst_bundle", MSST_MODEL_BUNDLES), ("hf_bundle", INSTRUMENT_HF_BUNDLES)):
        bundle = table.get(meta.get(key) or "")
        if bundle:
            names.extend(bundle["files"].keys())
    names.extend(f["name"] for f in meta.get("files") or [] if f.get("name"))
    names.extend(meta.get("extra_files") or [])
    seen: List[str] = []
    for n in names:
        if n not in seen:
            seen.append(n)
    return seen


def _torch_hub_checkpoints() -> Path:
    try:
        import torch  # type: ignore
        return Path(torch.hub.get_dir()) / "checkpoints"
    except Exception:
        return Path.home() / ".cache" / "torch" / "hub" / "checkpoints"


def _repair_demucs(model_name: str) -> Dict[str, Any]:
    ckpt_dir = _torch_hub_checkpoints()
    removed: List[str] = []
    try:
        import torch  # type: ignore
        for f in ckpt_dir.glob("*.th") if ckpt_dir.exists() else []:
            try:
                torch.load(f, map_location="cpu", weights_only=False)
            except Exception:
                try:
                    f.unlink()
                    removed.append(f.name)
                except OSError:
                    pass
        from demucs.pretrained import get_model  # type: ignore
        get_model(model_name)
        detail = f"demucs {model_name} ready" + (f" (removed corrupt: {', '.join(removed)})" if removed else "")
        return {"ok": True, "detail": detail}
    except Exception as exc:
        return {"ok": False, "detail": f"demucs {model_name} repair failed: {type(exc).__name__}: {str(exc)[:200]}"}


def repair_variant(variant_id: str, config: Optional[Dict[str, Any]] = None,
                   model_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Make sure every weight file a model variant needs is present and valid, re-downloading as needed."""
    from model_registry import resolve_model_variant
    from liminal_paths import audio_separator_model_dir
    meta = resolve_model_variant(variant_id)
    if not meta:
        return {"ok": False, "detail": f"unknown model variant '{variant_id}'"}
    backend = meta.get("backend")
    if backend == "demucs":
        return _repair_demucs(meta.get("model", "htdemucs"))
    if backend != "audio_separator":
        return {"ok": False, "detail": f"backend '{backend}' has no automatic repair - falling back"}

    model_dir = Path(model_dir or audio_separator_model_dir())
    model_dir.mkdir(parents=True, exist_ok=True)
    removed: List[str] = []
    for name in variant_files(meta):
        path = model_dir / name
        if path.exists() and not file_looks_valid(path):
            try:
                path.unlink()
                removed.append(name)
            except OSError:
                pass

    results: List[Dict[str, Any]] = []
    if meta.get("msst_bundle"):
        results.append(try_msst_bundle(meta["msst_bundle"], model_dir))
    elif meta.get("hf_bundle"):
        results.append(try_hf_bundle(meta["hf_bundle"], model_dir))
    elif meta.get("files"):
        for f in meta["files"]:
            target = model_dir / f["name"]
            if target.is_file() and file_looks_valid(target):
                continue
            res = try_download(f["url"], target, expected_sha256=f.get("sha256")) if f.get("url") \
                else try_audio_separator_download(meta["filename"], model_dir)
            if not res["ok"] and f.get("fallback_url"):
                res = try_download(f["fallback_url"], target, expected_sha256=f.get("sha256"))
            results.append(res)
    elif meta.get("download_url"):
        res = try_download(meta["download_url"], model_dir / meta["filename"],
                           expected_sha256=meta.get("sha256"))
        if res["ok"] and meta.get("config_url") and meta.get("config_filename"):
            res = try_download(meta["config_url"], model_dir / meta["config_filename"])
        results.append(res)
    elif not (model_dir / meta["filename"]).is_file():
        results.append(try_audio_separator_download(meta["filename"], model_dir))

    missing = [n for n in variant_files(meta) if not (model_dir / n).is_file()]
    ok = not missing and all(r["ok"] for r in results)
    detail = "; ".join(r["detail"] for r in results) or "all model files present"
    if removed:
        detail += f" (replaced corrupt: {', '.join(removed)})"
    if missing:
        detail += f" (still missing: {', '.join(missing)})"
    return {"ok": ok, "detail": detail, "removed": removed}


# ---------------------------------------------------------------------------
# Script self-heal (post-update)
# ---------------------------------------------------------------------------

def _script_is_valid(path: Path) -> bool:
    try:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
        return True
    except (OSError, SyntaxError, UnicodeDecodeError, ValueError):
        return False


def self_heal_script_files(scripts_dir: Optional[Path] = None, version: Optional[str] = None,
                           fetch: Callable[..., Dict[str, Any]] = None) -> Dict[str, Any]:
    """Verify required script files exist and compile; restore broken ones from GitHub at the app's tag."""
    scripts_dir = Path(scripts_dir or SCRIPTS_DIR)
    fetch = fetch or try_download
    try:
        from liminal_paths import read_app_version
        version = version or read_app_version(scripts_dir)
    except Exception:
        version = version or "0.0.0"
    bad = [n for n in REQUIRED_SCRIPT_FILES if not (scripts_dir / n).is_file() or not _script_is_valid(scripts_dir / n)]
    repaired: List[str] = []
    failed: List[str] = []
    for name in bad:
        ok = False
        for ref in (f"v{version}", "main"):
            res = fetch(f"{REPO_RAW}/{ref}/{APP_SUBDIR}/{name}", scripts_dir / name)
            if res["ok"] and _script_is_valid(scripts_dir / name):
                ok = True
                break
        (repaired if ok else failed).append(name)
    # Stale bytecode from the previous version can shadow updated sources on some installs.
    pycache = scripts_dir / "__pycache__"
    if pycache.is_dir():
        shutil.rmtree(pycache, ignore_errors=True)
    return {"ok": not failed, "checked": len(REQUIRED_SCRIPT_FILES), "repaired": repaired, "failed": failed}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_doctor(variants: Optional[List[str]] = None, repair: bool = False) -> Dict[str, Any]:
    from model_registry import load_user_variants, resolve_model_variant
    from liminal_paths import audio_separator_model_dir
    report: Dict[str, Any] = {"runtime": check_runtime(), "models": {}}
    model_dir = audio_separator_model_dir()
    ids = list(variants or []) or list(load_user_variants().keys())
    for vid in ids:
        meta = resolve_model_variant(vid)
        if not meta:
            report["models"][vid] = {"ok": False, "detail": "unknown variant"}
            continue
        if meta.get("backend") != "audio_separator":
            report["models"][vid] = {"ok": True, "detail": f"backend {meta.get('backend')} (not file-checked)"}
            continue
        bad = [n for n in variant_files(meta)
               if not (model_dir / n).is_file() or not file_looks_valid(model_dir / n)]
        entry = {"ok": not bad, "detail": "ok" if not bad else f"missing/corrupt: {', '.join(bad)}"}
        if bad and repair:
            entry = repair_variant(vid, model_dir=model_dir)
        report["models"][vid] = entry
    report["ok"] = report["runtime"]["ok"] and all(m["ok"] for m in report["models"].values())
    return report


def _marker_path() -> Path:
    from liminal_paths import user_data_dir
    return user_data_dir() / "python_selfcheck.json"


def post_update_check(app_version: Optional[str] = None, force: bool = False,
                      repair: bool = True) -> Dict[str, Any]:
    """Run once per app version: heal scripts, verify the runtime, repair what's repairable."""
    from liminal_paths import read_app_version
    version = app_version or read_app_version(SCRIPTS_DIR)
    marker = _marker_path()
    previous = None
    try:
        previous = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if previous and previous.get("version") == version and previous.get("ok") and not force:
        return {"ok": True, "skipped": True, "version": version,
                "detail": f"Python runtime already verified for v{version}"}

    steps: Dict[str, Any] = {"version": version, "previous_version": (previous or {}).get("version")}
    steps["scripts"] = self_heal_script_files(version=version)
    runtime = check_runtime()
    steps["runtime_before"] = {k: runtime.get(k) for k in ("ok", "missing_required", "broken_imports", "issues")}
    repairs: List[Dict[str, Any]] = []
    if repair and not runtime["ok"]:
        for module in runtime["missing_required"]:
            if module != "torch":
                repairs.append({"module": module, **repair_import(module)})
        if "torch" in runtime["missing_required"] or runtime["broken_imports"]:
            try:
                import gpu_runtime
                res = gpu_runtime.install_runtime(log=_log)
                repairs.append({"module": "torch", "ok": bool(res.get("ok")),
                                "detail": f"runtime mode={res.get('mode')} ({res.get('reason')})"})
            except Exception as exc:
                repairs.append({"module": "torch", "ok": False, "detail": str(exc)[:200]})
    elif repair:
        nv = runtime.get("nvidia") or {}
        if nv.get("present") and nv.get("driver_ok") and not runtime.get("cuda_available"):
            try:
                import gpu_runtime
                res = gpu_runtime.install_runtime(log=_log)
                repairs.append({"module": "gpu", "ok": bool(res.get("ok")),
                                "detail": f"runtime mode={res.get('mode')} ({res.get('reason')})"})
            except Exception as exc:
                repairs.append({"module": "gpu", "ok": False, "detail": str(exc)[:200]})
    steps["repairs"] = repairs
    after = check_runtime() if repairs else runtime
    steps["runtime_after"] = {k: after.get(k) for k in ("ok", "missing_required", "broken_imports", "issues",
                                                       "cuda_available", "torch")}
    steps["ok"] = bool(after["ok"] and steps["scripts"]["ok"])
    steps["detail"] = ("Engine verified after update" if steps["ok"]
                       else "Engine needs attention - open Settings > Repair engine")
    try:
        marker.write_text(json.dumps({"version": version, "ok": steps["ok"],
                                      "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S")}), encoding="utf-8")
    except OSError:
        pass
    return steps


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check-runtime", action="store_true")
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--repair", action="store_true")
    parser.add_argument("--variant", action="append", default=[])
    parser.add_argument("--repair-variant", default=None)
    parser.add_argument("--heal-scripts", action="store_true")
    parser.add_argument("--post-update", action="store_true")
    parser.add_argument("--app-version", default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    if args.check_runtime:
        out = check_runtime()
    elif args.repair_variant:
        out = repair_variant(args.repair_variant)
    elif args.heal_scripts:
        out = self_heal_script_files()
    elif args.post_update:
        out = post_update_check(args.app_version, force=args.force)
    elif args.doctor:
        out = run_doctor(args.variant, repair=args.repair)
    else:
        parser.print_help()
        return 0
    print(json.dumps(out))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
