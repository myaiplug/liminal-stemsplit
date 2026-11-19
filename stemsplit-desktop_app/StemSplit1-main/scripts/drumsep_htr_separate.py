"""HT-RoFormer drum separator (Sucial/drumsep-ht-roformer): drums -> kick, snare, hihat, tom, cymbal, other.

LICENSE STATUS: the Hugging Face repo publishes NO license for the weights or for its inference code
(checked 2026-11-16). Nothing from that repo is stored in Liminal or its installers. On first use the
checkpoint and the four model-definition files are downloaded from a pinned commit of the author's own
Hugging Face repo, verified by SHA-256, and kept in the user's model folder. Selling Liminal with this
engine enabled needs the author's written permission; see THIRD_PARTY_LICENSES.md.

Inference follows the repo's documented settings: 44.1 kHz stereo, chunk 266,240 samples (multiple of
1024), MSST overlap 2 (step = chunk/2, linear fade chunk/10), no extra normalisation (the model
standardises internally). Runs on CUDA when available (fp32, ~0.75 GB of weights), else CPU.
"""

from __future__ import annotations

import hashlib
import importlib
import logging
import os
import sys
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

STEMS = ("kick", "snare", "hihat", "tom", "cymbal", "other")
# Names used by the Liminal player (src/lib/stem-display.ts DRUM_MICRO_STEMS)
LIMINAL_STEM_NAMES = {"kick": "kick", "snare": "snare", "hihat": "hh", "tom": "toms", "cymbal": "cymbals", "other": "perc"}
TARGET_SR = 44100
CHUNK = 266240
OVERLAP = 2

HF_REPO = "Sucial/drumsep-ht-roformer"
HF_REVISION = "403f3a03c3ea70a9af47f2c6adf64f90ca97e1af"
# path in repo -> (sha256, size or None)
FILES = {
    "drumsep_ht_roformer.ckpt": ("23e34eaffef9960df0ab7269aa219a80ddbd3acabf68c1cd868337dbe918b96f", 746878931),
    "infer/bs_roformer/__init__.py": ("ce93475b83495d01069730887fbc5c68526198e0d087ef7826d6e585c4f5ff3d", None),
    "infer/bs_roformer/attend.py": ("149751b77dc3372ad9f08e3b6b8a7855fb615e3a6072a35ded5700556ee4ae52", None),
    "infer/bs_roformer/bs_roformer.py": ("1411d9c3fd3df99f0c3365175ba9fa3094f6f4efee1f978c5845259a54a88da3", None),
    "infer/bs_roformer/ht_roformer.py": ("87685b106c5b4b5ea0a8463026a7ce2c013c5d2ad0706f9d891e5062ae427b16", None),
}
LICENSE_NOTE = "No license published by the author (Sucial). Downloaded at runtime; not redistributed."


def models_root() -> Path:
    env = os.environ.get("STEMSPLIT_MODELS_ROOT", "").strip()
    if env:
        path = Path(env)
    else:
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
        path = Path(local) / "StemSplit" / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_dir() -> Path:
    path = models_root() / "drumsep_htr" / HF_REVISION[:12]
    path.mkdir(parents=True, exist_ok=True)
    return path


def hf_url(name: str) -> str:
    return f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{name}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _verified(path: Path, sha: str, size: Optional[int]) -> bool:
    if not path.is_file():
        return False
    if size is not None and path.stat().st_size != size:
        return False
    marker = path.with_name(path.name + ".sha256")
    if marker.is_file() and marker.read_text().strip() == sha:
        return True
    ok = sha256_file(path) == sha
    if ok:
        marker.write_text(sha)
    return ok


def ensure_files(progress: Optional[Callable[[str], None]] = None) -> Path:
    """Download (once) and verify the pinned checkpoint + model code. Returns the folder."""
    root = model_dir()
    for name, (sha, size) in FILES.items():
        dest = root / name
        if _verified(dest, sha, size):
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if progress:
            label = f"{size // 1_000_000} MB" if size else "model code"
            progress(f"Downloading HT-RoFormer drum model ({label}, first use only)...")
        tmp = dest.with_name(dest.name + ".part")
        logger.info("Downloading %s -> %s", hf_url(name), dest)
        urllib.request.urlretrieve(hf_url(name), tmp)
        got = sha256_file(tmp)
        if got != sha:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"{name}: SHA-256 mismatch ({got} != {sha})")
        tmp.replace(dest)
        dest.with_name(dest.name + ".sha256").write_text(sha)
    return root


def load_model(device: str = "auto", progress: Optional[Callable[[str], None]] = None):
    import torch
    root = ensure_files(progress)
    infer_dir = str(root / "infer")
    if infer_dir not in sys.path:
        sys.path.insert(0, infer_dir)
    module = importlib.import_module("bs_roformer.ht_roformer")
    model = module.HybridTransformerRoFormer()
    state = torch.load(str(root / "drumsep_ht_roformer.ckpt"), map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    return model.to(device).eval(), device


def to_stereo_44100(audio: np.ndarray, sr: int) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        data = np.stack([data, data], axis=0)
    elif data.shape[0] not in (1, 2) and data.shape[-1] in (1, 2):
        data = data.T
    if data.shape[0] == 1:
        data = np.vstack([data, data])
    data = data[:2]
    if sr != TARGET_SR:
        import librosa
        data = np.stack([librosa.resample(c, orig_sr=sr, target_sr=TARGET_SR) for c in data], axis=0)
    return np.ascontiguousarray(data, dtype=np.float32)


def chunk_starts(total: int, chunk: int = CHUNK, step: int = CHUNK // OVERLAP) -> List[int]:
    if total <= chunk:
        return [0]
    starts = list(range(0, total - chunk + 1, step))
    if starts[-1] != total - chunk:
        starts.append(total - chunk)
    return starts


def chunk_weight(start: int, total: int, chunk: int = CHUNK, fade: int = CHUNK // 10) -> np.ndarray:
    w = np.ones(chunk, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
    if start > 0:
        w[:fade] = ramp
    if start + chunk < total:
        w[-fade:] = ramp[::-1]
    return w


def separate_drums(
    audio: np.ndarray,
    sr: int,
    progress_hook: Optional[Callable] = None,
    device: str = "auto",
    chunk_runner: Optional[Callable[[np.ndarray], np.ndarray]] = None,
) -> Dict[str, np.ndarray]:
    """audio (channels, samples) -> {stem: float32 (2, samples)} at 44.1 kHz.

    `chunk_runner` maps a (2, CHUNK) window to (6, 2, CHUNK); tests inject a mock.
    """
    def report(message: str, percent: int) -> None:
        if progress_hook:
            progress_hook(2, 5, message, percent)

    x = to_stereo_44100(audio, sr)
    total = x.shape[-1]
    starts = chunk_starts(total)
    padded = max(starts[-1] + CHUNK, total)
    xp = np.pad(x, ((0, 0), (0, padded - total)))

    runner = chunk_runner
    if runner is None:
        import torch
        report("Loading HT-RoFormer drum model...", 20)
        model, dev = load_model(device, lambda m: report(m, 18))
        logger.info("HT-RoFormer drums on %s", dev)

        def runner(window: np.ndarray) -> np.ndarray:
            with torch.inference_mode():
                out = model(torch.from_numpy(window).unsqueeze(0).to(dev))
            return out[0].float().cpu().numpy()

    acc = np.zeros((len(STEMS), 2, padded), dtype=np.float64)
    weight = np.zeros(padded, dtype=np.float64)
    for i, start in enumerate(starts):
        report(f"Drum split window {i + 1}/{len(starts)}...", 25 + int(55 * i / max(len(starts), 1)))
        out = np.asarray(runner(np.ascontiguousarray(xp[:, start:start + CHUNK])))
        w = chunk_weight(start, padded)
        acc[:, :, start:start + CHUNK] += out * w
        weight[start:start + CHUNK] += w
    stems = (acc / np.maximum(weight, 1e-8)).astype(np.float32)[:, :, :total]
    report("Kick / snare / hi-hat / toms / cymbals ready", 85)
    return {name: stems[i] for i, name in enumerate(STEMS)}


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    import soundfile as sf
    ap = argparse.ArgumentParser(description="HT-RoFormer drum split (6 stems)")
    ap.add_argument("input")
    ap.add_argument("--out", default=".")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    audio, sr = sf.read(args.input, dtype="float32", always_2d=True)
    stems = separate_drums(audio.T, sr, progress_hook=lambda *a: print(a[2]), device=args.device)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, wave in stems.items():
        sf.write(str(out / f"{name}.wav"), wave.T, TARGET_SR, subtype="FLOAT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
