"""Optional Rust / Candle separation backend: demix-rs (https://github.com/rzafiamy/demix-rs, Apache-2.0).

demix-rs runs Music-Source-Separation-Training BS-RoFormer checkpoints from a single GGUF file, with no Python,
PyTorch or ffmpeg at inference time. Liminal calls its `demix` command line tool:

  demix separate -m <model.gguf> --format f32 [--cpu] <input.wav> -o <dir>   ->  <dir>/<name>_<stem>.wav

Models:
  * viperx BS-RoFormer ep 317 (vocals / instrumental): the GGUF from https://huggingface.co/rleo/BS-RoFormer-viperx-317-GGUF,
    downloaded on first use from a pinned commit and SHA-256 checked. LICENCE: the weights are viperx's, published in
    the UVR model repository without any licence. Never bundled with Liminal; see THIRD_PARTY_LICENSES.md.
  * BS-RoFormer-SW 6-stem: converted locally (`demix convert`, a few seconds) from the BS-Roformer-SW.ckpt + .yaml that
    Liminal's audio-separator engine already uses. Nothing new is downloaded.

The `demix` binary is not shipped with Liminal (it statically links symphonia, MPL-2.0). Build it with
scripts/demix/build_demix.sh or build_demix.ps1, or point LIMINAL_DEMIX_BIN at one.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

DEMIX_REPO = "https://github.com/rzafiamy/demix-rs"
DEMIX_COMMIT = "4b9c6fdf976c839006ee946e1ee922ba64548a9a"

VIPERX_HF_REPO = "rleo/BS-RoFormer-viperx-317-GGUF"
VIPERX_HF_REVISION = "8c15929260d281bd05379eeb84539a526661a85e"
VIPERX_FILES = {
    "q8_0": ("bs-roformer-viperx-317-q8_0.gguf", "26014042c579008dcdf93d435ea068d5b31421885d62931ed5e85bbd8ccb11a1", 171169984),
    "f16": ("bs-roformer-viperx-317-f16.gguf", "173ed1be0525adda08e88f0644299bee28fb517cd70cf3aabc2ecdb747b88a4f", 320085184),
}
VIPERX_LICENSE = (
    "No licence: viperx's weights were published in the UVR model repository (TRvlvr/model_repo) and "
    "Music-Source-Separation-Training without any licence terms. Downloaded on first use, never bundled."
)

SW_CKPT = "BS-Roformer-SW.ckpt"
SW_YAML = "BS-Roformer-SW.yaml"
SW_ALIASES = ("BS-Roformer-SW.ckpt", "model_BandSplit-Roformer_SW_by-jarredou.ckpt")
SW_STEMS = ("vocals", "drums", "bass", "guitar", "piano", "other")

TARGET_SR = 44100


class DemixUnavailable(RuntimeError):
    """The demix binary or a model file is missing."""


def models_root() -> Path:
    env = os.environ.get("STEMSPLIT_MODELS_ROOT", "").strip()
    if env:
        path = Path(env)
    else:
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
        path = Path(local) / "StemSplit" / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def demix_dir() -> Path:
    path = models_root() / "demix"
    path.mkdir(parents=True, exist_ok=True)
    return path


def find_demix_binary() -> Optional[Path]:
    """LIMINAL_DEMIX_BIN, then <models>/demix/bin/demix[.exe], then <app>/bin/demix[.exe], then PATH."""
    exe = "demix.exe" if os.name == "nt" else "demix"
    candidates: List[Path] = []
    env = os.environ.get("LIMINAL_DEMIX_BIN", "").strip()
    if env:
        candidates.append(Path(env))
    candidates.append(demix_dir() / "bin" / exe)
    candidates.append(Path(__file__).resolve().parent.parent / "bin" / exe)
    on_path = shutil.which("demix")
    if on_path:
        candidates.append(Path(on_path))
    for cand in candidates:
        if cand.is_file() and os.access(cand, os.X_OK):
            return cand
    return None


def is_available() -> bool:
    return find_demix_binary() is not None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def hf_url(filename: str) -> str:
    return f"https://huggingface.co/{VIPERX_HF_REPO}/resolve/{VIPERX_HF_REVISION}/{filename}"


def ensure_viperx_gguf(dtype: str = "q8_0", progress: Optional[Callable[[str], None]] = None,
                       opener=urllib.request.urlopen) -> Path:
    """Download (first use) and verify the viperx 317 GGUF."""
    if dtype not in VIPERX_FILES:
        raise ValueError(f"unknown dtype {dtype!r}; expected one of {sorted(VIPERX_FILES)}")
    name, sha, size = VIPERX_FILES[dtype]
    dest = demix_dir() / VIPERX_HF_REVISION[:12] / name
    if dest.is_file() and dest.stat().st_size == size and sha256_file(dest) == sha:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    if progress:
        progress(f"Downloading BS-RoFormer viperx 317 ({size // 1_000_000} MB, first use only)...")
    tmp = dest.with_suffix(".part")
    with opener(hf_url(name)) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, 1 << 20)
    got = sha256_file(tmp)
    if got != sha:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{name}: SHA-256 mismatch ({got[:12]}..., expected {sha[:12]}...)")
    tmp.replace(dest)
    return dest


def find_sw_checkpoint(search_dirs: Iterable[Path]) -> Optional[tuple]:
    """(ckpt, yaml) of BS-Roformer-SW in the given directories, or None."""
    for d in search_dirs:
        if not d:
            continue
        d = Path(d)
        for alias in SW_ALIASES:
            ckpt = d / alias
            yaml = d / SW_YAML
            if not yaml.is_file():
                yaml = ckpt.with_suffix(".yaml")
            if ckpt.is_file() and yaml.is_file():
                return ckpt, yaml
    return None


def ensure_sw_gguf(search_dirs: Iterable[Path], binary: Path, progress: Optional[Callable[[str], None]] = None,
                   run=subprocess.run) -> Path:
    """Convert Liminal's existing BS-Roformer-SW checkpoint to a demix GGUF once (q8_0, cached next to the models)."""
    found = find_sw_checkpoint(search_dirs)
    if not found:
        raise DemixUnavailable(
            "BS-Roformer-SW.ckpt / .yaml not found. Run the BS-Roformer-SW model once with the default engine "
            "(it downloads them), then try the demix-rs engine again.")
    ckpt, yaml = found
    st = ckpt.stat()
    dest = demix_dir() / f"bs-roformer-sw-q8_0-{st.st_size}-{int(st.st_mtime)}.gguf"
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    if progress:
        progress("Converting BS-Roformer-SW for demix-rs (first use only)...")
    tmp = dest.with_suffix(".part.gguf")
    proc = run([str(binary), "convert", str(ckpt), str(yaml), "-o", str(tmp), "--dtype", "q8_0"],
               capture_output=True, text=True)
    if proc.returncode != 0 or not tmp.is_file():
        raise RuntimeError(f"demix convert failed: {(proc.stderr or proc.stdout or '').strip()[-400:]}")
    tmp.replace(dest)
    return dest


def _to_stereo(audio: np.ndarray) -> np.ndarray:
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.stack([audio, audio])
    elif audio.shape[0] > audio.shape[-1]:
        audio = audio.T
    if audio.shape[0] == 1:
        audio = np.concatenate([audio, audio])
    return audio[:2]


def _resample(audio: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
    if sr_from == sr_to:
        return audio
    import librosa
    return librosa.resample(audio, orig_sr=sr_from, target_sr=sr_to, axis=-1)


def run_demix(binary: Path, model: Path, audio: np.ndarray, sr: int, *, cpu: bool = True,
              threads: Optional[int] = None, overlap: Optional[int] = None,
              run=subprocess.run) -> Dict[str, np.ndarray]:
    """Write audio as float WAV, run `demix separate`, read every <name>_<stem>.wav back at `sr`."""
    import soundfile as sf

    stereo = _to_stereo(audio)
    with tempfile.TemporaryDirectory(prefix="liminal_demix_") as tmp:
        tmpd = Path(tmp)
        src = tmpd / "input.wav"
        sf.write(src, stereo.T, sr, subtype="FLOAT")
        out = tmpd / "out"
        cmd = [str(binary), "separate", "-m", str(model), "--format", "f32", "-o", str(out)]
        if cpu:
            cmd.append("--cpu")
        if threads:
            cmd += ["--threads", str(int(threads))]
        if overlap:
            cmd += ["--overlap", str(int(overlap))]
        cmd.append(str(src))
        t0 = time.time()
        proc = run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"demix separate failed ({proc.returncode}): {(proc.stderr or proc.stdout or '').strip()[-400:]}")
        logger.info("demix separate: %.1fs (%s)", time.time() - t0, (proc.stderr or proc.stdout or "").strip().splitlines()[-1:] or "")
        stems: Dict[str, np.ndarray] = {}
        for wav in sorted(out.glob("input_*.wav")):
            stem = wav.stem[len("input_"):]
            data, file_sr = sf.read(wav, always_2d=True, dtype="float32")
            data = _resample(data.T, file_sr, sr)
            n = stereo.shape[1]
            if data.shape[1] < n:
                data = np.pad(data, ((0, 0), (0, n - data.shape[1])))
            stems[stem] = data[:, :n]
        if not stems:
            raise RuntimeError("demix separate wrote no stems")
        return stems


def separate(variant: str, audio: np.ndarray, sr: int, *, device: str = "cpu",
             sw_search_dirs: Iterable[Path] = (), progress_hook: Optional[Callable] = None) -> Dict[str, np.ndarray]:
    """variant: 'viperx317' (vocals + instrumental) or 'sw' (6 stems)."""
    def report(msg: str, pct: int) -> None:
        if progress_hook:
            progress_hook(2, 5, msg, pct)

    binary = find_demix_binary()
    if not binary:
        raise DemixUnavailable(
            "The demix-rs engine needs the `demix` binary. Build it with scripts/demix/build_demix.ps1 "
            "(or build_demix.sh), or set LIMINAL_DEMIX_BIN.")
    dtype = os.environ.get("LIMINAL_DEMIX_DTYPE", "q8_0")
    if variant == "viperx317":
        model = ensure_viperx_gguf(dtype, progress=lambda m: report(m, 15))
    elif variant == "sw":
        model = ensure_sw_gguf(sw_search_dirs, binary, progress=lambda m: report(m, 15))
    else:
        raise ValueError(f"unknown demix variant {variant!r}")
    report("demix-rs (Candle) separating...", 30)
    stems = run_demix(binary, model, audio, sr, cpu=device != "cuda")
    if variant == "sw":
        stems = {k: v for k, v in stems.items() if k in SW_STEMS}
    report("demix-rs done", 90)
    return stems


def main() -> int:
    import argparse
    import soundfile as sf

    ap = argparse.ArgumentParser(description="Liminal demix-rs backend")
    ap.add_argument("input")
    ap.add_argument("-o", "--output", default=".")
    ap.add_argument("--variant", choices=["viperx317", "sw"], default="viperx317")
    ap.add_argument("--sw-dir", action="append", default=[])
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    audio, sr = sf.read(args.input, always_2d=True, dtype="float32")
    stems = separate(args.variant, audio.T, sr, device=args.device, sw_search_dirs=[Path(p) for p in args.sw_dir],
                     progress_hook=lambda *a: print(a[2]))
    os.makedirs(args.output, exist_ok=True)
    for name, data in stems.items():
        sf.write(os.path.join(args.output, f"{name}.wav"), data.T, sr, subtype="FLOAT")
        print(name, data.shape)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
