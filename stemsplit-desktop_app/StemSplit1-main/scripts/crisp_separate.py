"""Mini-BS-RoFormer V2.5 GGUF separation via CrispASR.

Original model (HiDolen/Mini-BS-RoFormer-V2.5-46.2M) and the GGUF conversion
are MIT. CrispASR itself is MIT (C++). The binary and GGUF download on first
use into the local StemSplit models folder.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)

HF_REPO = "cstr/mini-bs-roformer-GGUF"
DEFAULT_GGUF = "mini-bs-roformer-q8_0.gguf"
FAST_GGUF = "mini-bs-roformer-q4_k.gguf"
STEM_NAMES = ("bass", "drums", "other", "vocals")
CRISPASR_RELEASE = "https://github.com/CrispStrobe/CrispASR/releases/latest/download"


def models_root() -> Path:
    env = os.environ.get("STEMSPLIT_MODELS_ROOT", "").strip()
    if env:
        path = Path(env)
        path.mkdir(parents=True, exist_ok=True)
        return path
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    path = Path(local) / "StemSplit" / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def crisp_dir() -> Path:
    path = models_root() / "crisp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def gguf_url(filename: str) -> str:
    return f"https://huggingface.co/{HF_REPO}/resolve/main/{filename}"


def release_asset_name() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    has_nvidia = shutil.which("nvidia-smi") is not None
    if system.startswith("win"):
        if has_nvidia:
            return "crispasr-windows-x86_64-cuda.zip"
        return "crispasr-windows-x86_64-cpu.zip"
    if system == "darwin":
        if "arm" in machine or "aarch" in machine:
            return "crispasr-macos-arm64.tar.gz"
        return "crispasr-macos-x86_64.tar.gz"
    return "crispasr-linux-x86_64-cuda.tar.gz" if has_nvidia else "crispasr-linux-x86_64.tar.gz"


def find_crispasr(search_root: Optional[Path] = None) -> Optional[Path]:
    env = os.environ.get("STEMSPLIT_CRISPASR", "").strip()
    if env and Path(env).is_file():
        return Path(env)
    which = shutil.which("crispasr") or shutil.which("crispasr.exe")
    if which:
        return Path(which)
    root = search_root or crisp_dir()
    for name in ("crispasr.exe", "crispasr"):
        bundled = root / "bin" / name
        if bundled.is_file():
            return bundled
        nested = root / name
        if nested.is_file():
            return nested
    return None


def _download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    logger.info("Downloading %s -> %s", url, dest)
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)
    return dest


def ensure_gguf(filename: str = DEFAULT_GGUF) -> Path:
    dest = crisp_dir() / filename
    if dest.is_file() and dest.stat().st_size > 1_000_000:
        return dest
    return _download(gguf_url(filename), dest)


def _extract_binary(archive: Path, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        if archive.suffix == ".zip" or archive.name.endswith(".zip"):
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(tmp_path)
        else:
            with tarfile.open(archive) as tf:
                tf.extractall(tmp_path)
        found = None
        for candidate in tmp_path.rglob("*"):
            if candidate.is_file() and candidate.name in {"crispasr", "crispasr.exe"}:
                found = candidate
                break
        if found is None:
            raise FileNotFoundError(f"No crispasr binary inside {archive.name}")
        target = dest_dir / found.name
        shutil.copy2(found, target)
        target.chmod(target.stat().st_mode | 0o111)
        return target


def ensure_crispasr() -> Path:
    existing = find_crispasr()
    if existing:
        return existing
    asset = release_asset_name()
    archive = crisp_dir() / asset
    if not archive.is_file():
        try:
            _download(f"{CRISPASR_RELEASE}/{asset}", archive)
        except Exception as exc:
            # CUDA packages are larger and sometimes named differently; fall back to CPU.
            if "cuda" in asset:
                fallback = asset.replace("-cuda", "-cpu") if "-cuda." in asset else asset.replace("-cuda", "")
                if fallback != asset:
                    logger.warning("CUDA CrispASR download failed (%s); trying CPU package", exc)
                    archive = crisp_dir() / fallback
                    _download(f"{CRISPASR_RELEASE}/{fallback}", archive)
                else:
                    raise
            else:
                raise
    return _extract_binary(archive, crisp_dir() / "bin")


def build_separate_command(
    binary: Path,
    model: Path,
    input_file: Path,
    output_dir: Path,
) -> list[str]:
    return [
        str(binary),
        "--separate",
        "-m",
        str(model),
        "-f",
        str(input_file),
        "--sep-output-dir",
        str(output_dir),
    ]


def collect_stems(output_dir: Path) -> Dict[str, np.ndarray]:
    import soundfile as sf

    found: Dict[str, Path] = {}
    for wav in sorted(output_dir.rglob("*.wav")):
        low = wav.stem.lower()
        for name in STEM_NAMES:
            if name in low.split("_") or low == name or low.endswith(f"-{name}") or low.endswith(f".{name}"):
                if name not in found:
                    found[name] = wav
    # Broader match if the filename is like "track_vocals"
    if len(found) < 4:
        for wav in sorted(output_dir.rglob("*.wav")):
            low = wav.stem.lower()
            for name in STEM_NAMES:
                if name in low and name not in found:
                    found[name] = wav

    missing = [name for name in STEM_NAMES if name not in found]
    if missing:
        raise FileNotFoundError(
            f"CrispASR did not write expected stems {missing} in {output_dir}. "
            f"Found: {[p.name for p in output_dir.rglob('*.wav')]}"
        )

    stems: Dict[str, np.ndarray] = {}
    for name, path in found.items():
        audio, _sr = sf.read(str(path), always_2d=True)
        stems[name] = audio.T.astype(np.float32)
    return stems


def separate_crisp(
    input_file: str,
    model_filename: str = DEFAULT_GGUF,
    output_dir: Optional[str] = None,
    progress_hook: Optional[Callable] = None,
) -> Dict[str, np.ndarray]:
    def report(message: str, percent: int) -> None:
        if progress_hook:
            progress_hook(2, 5, message, percent)

    report("Preparing Mini-BS-RoFormer (CrispASR)...", 20)
    binary = ensure_crispasr()
    model = ensure_gguf(model_filename or DEFAULT_GGUF)

    work_dir = Path(output_dir) if output_dir else Path(tempfile.mkdtemp(prefix="liminal-crisp-"))
    work_dir.mkdir(parents=True, exist_ok=True)
    stem_dir = work_dir / "crisp_stems"
    stem_dir.mkdir(parents=True, exist_ok=True)

    cmd = build_separate_command(binary, model, Path(input_file), stem_dir)
    logger.info("Running CrispASR: %s", " ".join(cmd))
    report("Separating with Mini-BS-RoFormer...", 40)
    completed = subprocess.run(cmd, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            "CrispASR separation failed "
            f"(exit {completed.returncode}): {completed.stderr or completed.stdout}"
        )
    report("Collecting Mini-BS-RoFormer stems...", 70)
    return collect_stems(stem_dir)
