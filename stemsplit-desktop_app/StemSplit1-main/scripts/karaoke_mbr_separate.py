"""Mel-Band RoFormer Karaoke (aufr33/viperx) lead / backing vocal separator.

ONNX re-export with host-side STFT:
https://huggingface.co/Acapellas/mel-band-roformer-karaoke-webgpu (MIT model card).

Contract (from the model card):
  input  stft_features [1, frames, 4100], frames-major packing t*4100 + (2*freq + ch)*2 + (0=re, 1=im)
  output mask          [1, 1, 2050, frames, 2], a single LEAD-vocal mask, packed bins 2*freq + ch
  STFT: 44.1 kHz, n_fft 2048, hop 441, center (reflect pad), periodic Hann.

lead = istft(mask * X); backing = input - lead (so the two always sum back to the input).
Run it on a vocals stem to get lead / backing vocals, or on a full mix to get lead vocal / karaoke.

Weights are downloaded on first use from a pinned Hugging Face commit and checked by SHA-256;
they are never bundled with Liminal.
"""

from __future__ import annotations

import hashlib
import logging
import os
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

N_FFT = 2048
HOP = 441
N_BINS = N_FFT // 2 + 1  # 1025
TARGET_SR = 44100
# 401 frames = 176,400 samples (4 s). Attention memory grows with the square of the frame count: 801 frames (the
# 8 s training chunk) peaked at 8.4 GB RAM on CPU, 401 at 3.4 GB, and the two differ by only 30.6 dB SNR on a test mix.
# LIMINAL_KARAOKE_FRAMES overrides it.
FRAMES = int(os.environ.get("LIMINAL_KARAOKE_FRAMES", "401"))
CHUNK = HOP * (FRAMES - 1)
STEP = CHUNK // 2
FADE = CHUNK // 10

HF_REPO = "Acapellas/mel-band-roformer-karaoke-webgpu"
HF_REVISION = "b29e3d08412be87e75aa5a30989a248013e39966"
FILES = {
    # fp32 graph (CUDA / CPU). The fp16 file is meant for WebGPU.
    "model.onnx": ("2eb37df9f1c9747c13243a0aa37d3141ba620c5818e2c536d4b55836c86bd530", 918421248),
    "model_fp16.onnx": ("a733bd2319e736d0f11483bcb655997c889e3c41536b01c2409df31fe4b71b3e", 460432035),
}
LICENSE_NOTE = (
    "MIT on the ONNX re-export (model card). The original aufr33/viperx checkpoint was published "
    "without a stated license; see THIRD_PARTY_LICENSES.md."
)


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
    path = models_root() / "mbr_karaoke"
    path.mkdir(parents=True, exist_ok=True)
    return path


def hf_url(filename: str) -> str:
    return f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{filename}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def ensure_model(filename: str = "model.onnx", progress: Optional[Callable[[str], None]] = None) -> Path:
    sha, size = FILES[filename]
    dest = model_dir() / filename
    if dest.is_file() and dest.stat().st_size == size:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    if progress:
        progress(f"Downloading Mel-Band karaoke model ({size // 1_000_000} MB, first use only)...")
    logger.info("Downloading %s -> %s", hf_url(filename), dest)
    urllib.request.urlretrieve(hf_url(filename), tmp)
    got = sha256_file(tmp)
    if got != sha:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{filename}: SHA-256 mismatch ({got} != {sha})")
    tmp.replace(dest)
    return dest


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


def stft(chunk: np.ndarray) -> np.ndarray:
    """(2, CHUNK) -> complex (2, 1025, FRAMES), torch.stft(center=True, reflect) conventions."""
    import librosa
    return np.stack([
        librosa.stft(c, n_fft=N_FFT, hop_length=HOP, win_length=N_FFT, window="hann",
                     center=True, pad_mode="reflect")
        for c in chunk
    ], axis=0)


def istft(spec: np.ndarray, length: int) -> np.ndarray:
    import librosa
    return np.stack([
        librosa.istft(s, hop_length=HOP, win_length=N_FFT, window="hann", center=True, length=length)
        for s in spec
    ], axis=0).astype(np.float32)


def pack_features(spec: np.ndarray) -> np.ndarray:
    """complex (2, F, T) -> [1, T, 4100] with index t*4100 + (2*f + ch)*2 + ri."""
    ri = np.stack([spec.real, spec.imag], axis=-1)          # (ch, F, T, 2)
    feats = ri.transpose(2, 1, 0, 3).reshape(1, spec.shape[2], N_BINS * 2 * 2)
    return np.ascontiguousarray(feats, dtype=np.float32)


def unpack_mask(mask: np.ndarray) -> np.ndarray:
    """[1, 1, 2050, T, 2] (bin = 2*f + ch) -> complex (2, F, T)."""
    m = mask[0, 0]                                            # (2050, T, 2)
    m = m.reshape(N_BINS, 2, m.shape[1], 2).transpose(1, 0, 2, 3)
    return m[..., 0] + 1j * m[..., 1]


def chunk_starts(total: int) -> List[int]:
    if total <= CHUNK:
        return [0]
    starts = list(range(0, total - CHUNK + 1, STEP))
    if starts[-1] != total - CHUNK:
        starts.append(total - CHUNK)
    return starts


def chunk_weight(start: int, total: int) -> np.ndarray:
    w = np.ones(CHUNK, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, FADE, dtype=np.float32)
    if start > 0:
        w[:FADE] = ramp
    if start + CHUNK < total:
        w[-FADE:] = ramp[::-1]
    return w


def make_session(onnx_path: Path):
    import onnxruntime as ort
    providers = []
    if "CUDAExecutionProvider" in ort.get_available_providers():
        providers.append("CUDAExecutionProvider")
    providers.append("CPUExecutionProvider")
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(onnx_path), opts, providers=providers)


def separate_lead_backing(
    audio: np.ndarray,
    sr: int,
    progress_hook: Optional[Callable] = None,
    session_runner: Optional[Callable[[np.ndarray], np.ndarray]] = None,
) -> Dict[str, np.ndarray]:
    """Return {'lead', 'backing'} as float32 (2, samples) at 44.1 kHz.

    'backing' is input - lead, so on a full mix it is the karaoke track (backing vocals + music).
    """
    def report(message: str, percent: int) -> None:
        if progress_hook:
            progress_hook(2, 5, message, percent)

    x = to_stereo_44100(audio, sr)
    total = x.shape[-1]
    starts = chunk_starts(total)
    padded = max(starts[-1] + CHUNK, total)
    xp = np.pad(x, ((0, 0), (0, padded - total)))

    runner = session_runner
    if runner is None:
        report("Loading Mel-Band karaoke model...", 20)
        session = make_session(ensure_model("model.onnx", lambda m: report(m, 18)))
        runner = lambda feats: session.run(["mask"], {"stft_features": feats})[0]

    acc = np.zeros((2, padded), dtype=np.float64)
    weight = np.zeros(padded, dtype=np.float64)
    for i, start in enumerate(starts):
        report(f"Lead / backing window {i + 1}/{len(starts)}...", 25 + int(55 * i / max(len(starts), 1)))
        chunk = xp[:, start:start + CHUNK]
        spec = stft(chunk)
        mask = unpack_mask(np.asarray(runner(pack_features(spec))))
        lead = istft(spec * mask, CHUNK)
        w = chunk_weight(start, padded)
        acc[:, start:start + CHUNK] += lead * w
        weight[start:start + CHUNK] += w
    lead = (acc / np.maximum(weight, 1e-8)).astype(np.float32)[:, :total]
    report("Lead / backing vocals ready", 85)
    return {"lead": lead, "backing": (x - lead).astype(np.float32)}


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    import soundfile as sf
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("--out", default=".")
    args = ap.parse_args(argv)
    audio, sr = sf.read(args.input, dtype="float32", always_2d=True)
    stems = separate_lead_backing(audio.T, sr, progress_hook=lambda *a: print(a[2]))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, wave in stems.items():
        sf.write(str(out / f"{name}.wav"), wave.T, TARGET_SR, subtype="FLOAT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
