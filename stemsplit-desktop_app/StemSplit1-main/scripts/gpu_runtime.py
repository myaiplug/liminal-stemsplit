"""CUDA runtime installer / verifier for the embedded Python.

Installs ``torch==2.13.0+cu126`` (+ ``onnxruntime-gpu==1.23.2``) when an NVIDIA
GPU with a recent-enough driver is present, verifies it, and falls back to the
CPU stack when anything looks wrong. Verified on an RTX 2080 Super (sm_75,
driver 610): torch.cuda True, ORT CUDAExecutionProvider.

CLI:
    python gpu_runtime.py --detect                 # JSON: NVIDIA GPU info
    python gpu_runtime.py --status                 # JSON: what the current runtime can do
    python gpu_runtime.py --install [--force]      # CUDA if possible, else keep/restore CPU
    python gpu_runtime.py --install --dry-run      # print the pip plan
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional

CUDA_TORCH_VERSION = "2.13.0"
CUDA_TAG = "cu126"
CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu126"
CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"
CPU_TORCH_VERSION = "2.5.1"
CUDA_TORCHVISION_VERSION = "0.28.0"   # pairs with torch 2.13
CPU_TORCHVISION_VERSION = "0.20.1"    # pairs with torch 2.5.1
ORT_GPU_SPEC = "onnxruntime-gpu==1.23.2"
ORT_CPU_SPEC = "onnxruntime"
# CUDA 12.6 needs driver >= 560 on Windows (>= 560.28 on Linux).
MIN_DRIVER_MAJOR = 560
TORCH_SUPPORT_DEPS = ["sympy>=1.13.3", "networkx", "jinja2", "fsspec", "filelock", "typing-extensions>=4.10"]

Runner = Callable[..., Any]


def _run(cmd: List[str], runner: Runner = subprocess.run, timeout: int = 3600):
    kwargs: Dict[str, Any] = {"capture_output": True, "text": True, "timeout": timeout}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000
    return runner(cmd, **kwargs)


def detect_nvidia(runner: Runner = subprocess.run) -> Dict[str, Any]:
    """Probe nvidia-smi. Never raises."""
    exe = shutil.which("nvidia-smi")
    if not exe and os.name == "nt":
        for cand in (r"C:\Windows\System32\nvidia-smi.exe",
                     r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"):
            if os.path.exists(cand):
                exe = cand
                break
    info: Dict[str, Any] = {"present": False, "name": None, "vram_gb": None,
                            "driver": None, "driver_major": None, "driver_ok": False}
    if not exe:
        return info
    try:
        proc = _run([exe, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
                    runner, timeout=20)
        if proc.returncode != 0 or not proc.stdout.strip():
            return info
        first = proc.stdout.strip().splitlines()[0]
        parts = [p.strip() for p in first.split(",")]
        if len(parts) >= 3:
            info["present"] = True
            info["name"] = parts[0]
            try:
                info["vram_gb"] = round(float(parts[1]) / 1024.0, 1)
            except ValueError:
                pass
            info["driver"] = parts[2]
            try:
                info["driver_major"] = int(parts[2].split(".")[0])
                info["driver_ok"] = info["driver_major"] >= MIN_DRIVER_MAJOR
            except ValueError:
                pass
    except Exception:
        pass
    return info


def pip_cmd(python: str, *args: str) -> List[str]:
    return [python, "-m", "pip", *args, "--no-warn-script-location", "--disable-pip-version-check"]


def cuda_plan(python: str) -> List[Dict[str, Any]]:
    """Ordered pip steps for the CUDA stack."""
    return [
        {"label": f"Install CUDA PyTorch {CUDA_TORCH_VERSION}+{CUDA_TAG}",
         "cmd": pip_cmd(python, "install", "--no-deps", "--force-reinstall", "--no-cache-dir",
                        f"torch=={CUDA_TORCH_VERSION}+{CUDA_TAG}", "--index-url", CUDA_INDEX_URL)},
        {"label": f"Install matching torchvision {CUDA_TORCHVISION_VERSION}+{CUDA_TAG}",
         "cmd": pip_cmd(python, "install", "--no-deps", "--force-reinstall", "--no-cache-dir",
                        f"torchvision=={CUDA_TORCHVISION_VERSION}+{CUDA_TAG}", "--index-url", CUDA_INDEX_URL)},
        {"label": "Install PyTorch support packages",
         "cmd": pip_cmd(python, "install", "--no-cache-dir", *TORCH_SUPPORT_DEPS)},
        {"label": "Remove CPU onnxruntime", "cmd": pip_cmd(python, "uninstall", "-y", "onnxruntime", "onnxruntime-gpu"),
         "ignore_failure": True},
        {"label": f"Install {ORT_GPU_SPEC}",
         "cmd": pip_cmd(python, "install", "--no-cache-dir", ORT_GPU_SPEC)},
    ]


def cpu_plan(python: str) -> List[Dict[str, Any]]:
    return [
        {"label": f"Restore CPU PyTorch {CPU_TORCH_VERSION}",
         "cmd": pip_cmd(python, "install", "--no-deps", "--force-reinstall", "--no-cache-dir",
                        f"torch=={CPU_TORCH_VERSION}+cpu", "--index-url", CPU_INDEX_URL)},
        {"label": f"Restore CPU torchvision {CPU_TORCHVISION_VERSION}",
         "cmd": pip_cmd(python, "install", "--no-deps", "--force-reinstall", "--no-cache-dir",
                        f"torchvision=={CPU_TORCHVISION_VERSION}+cpu", "--index-url", CPU_INDEX_URL),
         "ignore_failure": True},
        {"label": "Remove onnxruntime-gpu", "cmd": pip_cmd(python, "uninstall", "-y", "onnxruntime-gpu", "onnxruntime"),
         "ignore_failure": True},
        {"label": "Install CPU onnxruntime", "cmd": pip_cmd(python, "install", "--no-cache-dir", ORT_CPU_SPEC),
         "ignore_failure": True},
    ]


_PROBE = r"""
import json, sys
out = {"torch": None, "cuda": False, "device": None, "ort_providers": [], "demucs": False,
       "torchaudio": False, "errors": []}
try:
    import torch
    out["torch"] = torch.__version__
    out["cuda"] = bool(torch.cuda.is_available())
    if out["cuda"]:
        out["device"] = torch.cuda.get_device_name(0)
        t = torch.zeros(8, device="cuda"); out["cuda_tensor_ok"] = bool((t + 1).sum().item() == 8)
except Exception as e:
    out["errors"].append("torch: %s: %s" % (type(e).__name__, e))
try:
    import onnxruntime as ort
    try:
        ort.preload_dlls()
    except Exception:
        pass
    out["ort_providers"] = list(ort.get_available_providers())
except Exception as e:
    out["errors"].append("onnxruntime: %s: %s" % (type(e).__name__, e))
try:
    try:
        import torchaudio  # noqa
        out["torchaudio"] = True
    except Exception as e:
        import types, importlib.machinery
        for _n in [n for n in sys.modules if n == "torchaudio" or n.startswith("torchaudio.")]:
            del sys.modules[_n]
        _stub = types.ModuleType("torchaudio"); _stub.__spec__ = importlib.machinery.ModuleSpec("torchaudio", None)
        _stub.__path__ = []; sys.modules["torchaudio"] = _stub
        out["errors"].append("torchaudio (stubbed, non-fatal): %s: %s" % (type(e).__name__, str(e)[:120]))
    import demucs.pretrained, demucs.apply  # noqa
    out["demucs"] = True
except Exception as e:
    out["errors"].append("demucs: %s: %s" % (type(e).__name__, e))
try:
    import torchvision  # noqa
    out["torchvision"] = True
except Exception as e:
    out["torchvision"] = False
    out["errors"].append("torchvision: %s: %s" % (type(e).__name__, str(e)[:120]))
print("__PROBE__" + json.dumps(out))
"""


def probe_runtime(python: str, runner: Runner = subprocess.run) -> Dict[str, Any]:
    """Run a probe in ``python`` (the embedded interpreter) and return its JSON."""
    try:
        proc = _run([python, "-c", _PROBE], runner, timeout=180)
    except Exception as exc:
        return {"errors": [f"probe failed: {exc}"], "cuda": False, "demucs": False}
    for line in (proc.stdout or "").splitlines():
        if line.startswith("__PROBE__"):
            try:
                return json.loads(line[len("__PROBE__"):])
            except ValueError:
                break
    return {"errors": [f"probe produced no result: {(proc.stderr or '')[-200:]}"], "cuda": False, "demucs": False}


def cuda_is_healthy(probe: Dict[str, Any]) -> bool:
    return bool(probe.get("cuda")) and "CUDAExecutionProvider" in (probe.get("ort_providers") or []) \
        and bool(probe.get("demucs")) and probe.get("cuda_tensor_ok", True)


def _execute(plan: List[Dict[str, Any]], runner: Runner, log: Callable[[str], None]) -> bool:
    ok = True
    for step in plan:
        log(step["label"])
        try:
            proc = _run(step["cmd"], runner)
            if proc.returncode != 0 and not step.get("ignore_failure"):
                log(f"  failed (exit {proc.returncode}): {(proc.stderr or '')[-300:]}")
                return False
        except Exception as exc:
            log(f"  error: {exc}")
            if not step.get("ignore_failure"):
                return False
    return ok


def install_runtime(python: Optional[str] = None, force: bool = False, dry_run: bool = False,
                    runner: Runner = subprocess.run, log: Callable[[str], None] = print,
                    nvidia: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Install the CUDA stack when appropriate; otherwise leave the CPU stack alone.

    Result keys: ``mode`` (cuda|cpu), ``ok``, ``fell_back``, ``nvidia``, ``probe``, ``steps``.
    """
    python = python or sys.executable
    nvidia = nvidia if nvidia is not None else detect_nvidia(runner)
    result: Dict[str, Any] = {"mode": "cpu", "ok": True, "fell_back": False, "nvidia": nvidia, "steps": [], "reason": ""}

    if not nvidia.get("present"):
        result["reason"] = "No NVIDIA GPU detected - keeping CPU runtime"
        log(result["reason"])
        return result
    if not nvidia.get("driver_ok"):
        result["reason"] = (f"NVIDIA driver {nvidia.get('driver')} is older than {MIN_DRIVER_MAJOR} "
                            f"(needed for CUDA 12.6) - keeping CPU runtime. Update the driver to enable GPU.")
        log(result["reason"])
        return result

    plan = cuda_plan(python)
    result["steps"] = [s["label"] for s in plan]
    if dry_run:
        result["reason"] = "dry run"
        result["plan"] = [s["cmd"] for s in plan]
        return result

    if not force:
        current = probe_runtime(python, runner)
        if cuda_is_healthy(current):
            result.update(mode="cuda", probe=current, reason="CUDA runtime already healthy")
            log(result["reason"])
            return result

    log(f"NVIDIA GPU found: {nvidia.get('name')} ({nvidia.get('vram_gb')} GB, driver {nvidia.get('driver')})")
    installed = _execute(plan, runner, log)
    probe = probe_runtime(python, runner) if installed else {}
    if installed and cuda_is_healthy(probe):
        result.update(mode="cuda", probe=probe, reason="CUDA runtime installed and verified")
        log(result["reason"])
        return result

    # Fall back to CPU so the app stays usable.
    result["fell_back"] = True
    result["reason"] = "CUDA runtime could not be verified - restoring CPU runtime"
    log(result["reason"])
    restored = _execute(cpu_plan(python), runner, log)
    after = probe_runtime(python, runner)
    result.update(mode="cpu", ok=bool(restored and after.get("demucs")), probe=after)
    return result


def status(python: Optional[str] = None, runner: Runner = subprocess.run) -> Dict[str, Any]:
    python = python or sys.executable
    nvidia = detect_nvidia(runner)
    probe = probe_runtime(python, runner)
    return {"nvidia": nvidia, "probe": probe, "cuda_healthy": cuda_is_healthy(probe),
            "wants_cuda": bool(nvidia.get("present") and nvidia.get("driver_ok"))}


def ensure_torchaudio() -> bool:
    """Make ``import torchaudio`` safe. Returns True when the real package loads.

    PyTorch stopped publishing torchaudio wheels after 2.9, so torch 2.13+cu126 has no matching
    build and the leftover one can fail to load. demucs only needs the *import* to succeed (via
    openunmix); the splitter resamples with librosa. When the real package is unusable, register a
    minimal stub so the rest of the stack keeps working.
    """
    try:
        import torchaudio  # noqa: F401
        return True
    except Exception:
        import importlib.machinery
        import types
        for name in [n for n in sys.modules if n == "torchaudio" or n.startswith("torchaudio.")]:
            del sys.modules[name]
        stub = types.ModuleType("torchaudio")
        stub.__version__ = "0.0.0+liminal-stub"
        stub.__spec__ = importlib.machinery.ModuleSpec("torchaudio", None)
        stub.__path__ = []  # type: ignore[attr-defined]
        stub.__liminal_stub__ = True  # type: ignore[attr-defined]
        sys.modules["torchaudio"] = stub
        return False


def preload_onnxruntime_dlls() -> None:
    """Make ORT find the CUDA/cuDNN DLLs shipped inside the torch wheel."""
    try:
        import torch  # noqa: F401  (loads CUDA DLLs into the process first)
        import onnxruntime as ort
        preload = getattr(ort, "preload_dlls", None)
        if callable(preload):
            preload()
    except Exception:
        pass


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--detect", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--python", default=None)
    args = parser.parse_args(argv)
    if args.detect:
        print(json.dumps(detect_nvidia()))
        return 0
    if args.status:
        print(json.dumps(status(args.python)))
        return 0
    if args.install:
        res = install_runtime(args.python, force=args.force, dry_run=args.dry_run,
                              log=lambda m: print(m, file=sys.stderr, flush=True))
        print(json.dumps(res))
        return 0 if res.get("ok") else 1
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
