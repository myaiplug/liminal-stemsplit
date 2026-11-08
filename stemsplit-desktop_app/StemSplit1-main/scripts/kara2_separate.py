"""KARA2 student ONNX lead / backing / instrumental separator.

Host-side STFT, mask apply, and iSTFT as documented on
https://huggingface.co/musetric/mel-band-roformer-duality-kara2-student-onnx

Weights and ONNX export are Apache-2.0. Both the .onnx graph and the sibling
.onnx.data weight file are required.
"""

from __future__ import annotations

import logging
import os
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

N_FFT = 2048
HOP = 441
N_BINS = N_FFT // 2 + 1  # 1025
T_FRAMES = 1100
TARGET_SR = 44100
WINDOW_SAMPLES = (T_FRAMES - 1) * HOP + N_FFT  # 486707
CHUNK_HOP = (T_FRAMES // 2) * HOP  # 242550
HF_REPO = "musetric/mel-band-roformer-duality-kara2-student-onnx"
ONNX_NAME = "duality_kara2_student_core_t1100.onnx"
DATA_NAME = "duality_kara2_student_core_t1100.onnx.data"


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


def kara2_dir() -> Path:
    path = models_root() / "kara2"
    path.mkdir(parents=True, exist_ok=True)
    return path


def hf_url(filename: str) -> str:
    return f"https://huggingface.co/{HF_REPO}/resolve/main/{filename}"


def ensure_kara2_files() -> Path:
    dest_dir = kara2_dir()
    onnx_path = dest_dir / ONNX_NAME
    data_path = dest_dir / DATA_NAME
    if not onnx_path.is_file() or onnx_path.stat().st_size < 1_000_000:
        _download(hf_url(ONNX_NAME), onnx_path)
    if not data_path.is_file() or data_path.stat().st_size < 10_000_000:
        _download(hf_url(DATA_NAME), data_path)
    return onnx_path


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    logger.info("Downloading %s -> %s", url, dest)
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(dest)


def window_starts(n_samples: int) -> List[int]:
    if n_samples <= WINDOW_SAMPLES:
        return [0]
    starts = list(range(0, n_samples - WINDOW_SAMPLES + 1, CHUNK_HOP))
    last = n_samples - WINDOW_SAMPLES
    if starts[-1] != last:
        starts.append(last)
    return starts


def to_stereo_44100(audio: np.ndarray, sr: int) -> np.ndarray:
    """Return float32 audio as (2, samples) at 44.1 kHz."""
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        data = np.stack([data, data], axis=0)
    elif data.shape[0] != 2 and data.shape[-1] == 2:
        data = data.T
    if data.shape[0] > 2:
        data = data[:2]
    if data.shape[0] == 1:
        data = np.vstack([data, data])
    if sr != TARGET_SR:
        import librosa
        data = np.stack(
            [librosa.resample(data[ch], orig_sr=sr, target_sr=TARGET_SR) for ch in range(2)],
            axis=0,
        )
    return data.astype(np.float32)


def _stft_channel(samples: np.ndarray) -> np.ndarray:
    import librosa
    return librosa.stft(
        samples,
        n_fft=N_FFT,
        hop_length=HOP,
        win_length=N_FFT,
        window="hann",
        center=False,
    )


def _istft_channel(spec: np.ndarray, length: int) -> np.ndarray:
    import librosa
    return librosa.istft(
        spec,
        hop_length=HOP,
        win_length=N_FFT,
        window="hann",
        center=False,
        length=length,
    )


def pack_stft(window: np.ndarray) -> np.ndarray:
    """Pack a (2, WINDOW_SAMPLES) stereo window into [1, 2050, 1100, 2]."""
    if window.shape[-1] < WINDOW_SAMPLES:
        padded = np.zeros((2, WINDOW_SAMPLES), dtype=np.float32)
        padded[:, : window.shape[-1]] = window
        window = padded
    elif window.shape[-1] > WINDOW_SAMPLES:
        window = window[:, :WINDOW_SAMPLES]

    left = _stft_channel(window[0])
    right = _stft_channel(window[1])
    # Expected frames: 1 + (WINDOW_SAMPLES - N_FFT) // HOP = 1100
    packed = np.zeros((1, N_BINS * 2, T_FRAMES, 2), dtype=np.float32)
    packed[0, :N_BINS, :, 0] = np.real(left[:, :T_FRAMES])
    packed[0, :N_BINS, :, 1] = np.imag(left[:, :T_FRAMES])
    packed[0, N_BINS:, :, 0] = np.real(right[:, :T_FRAMES])
    packed[0, N_BINS:, :, 1] = np.imag(right[:, :T_FRAMES])
    return packed


def complex_from_packed(packed: np.ndarray) -> np.ndarray:
    """Convert last-dim real/imag arrays to complex. packed: (..., 2)."""
    return packed[..., 0] + 1j * packed[..., 1]


def apply_masks(stft_repr: np.ndarray, masks: np.ndarray) -> Dict[str, np.ndarray]:
    """Apply the documented KARA2 mask math.

    vocals = mix * masks[0]
    backing = vocals * masks[1]
    lead = vocals - backing
    instrumental = mix - vocals
    Each value is complex with shape (2050, T).
    """
    mix = complex_from_packed(stft_repr[0])
    vocals_mask = complex_from_packed(masks[0])
    backing_mask = complex_from_packed(masks[1])
    vocals = mix * vocals_mask
    backing = vocals * backing_mask
    lead = vocals - backing
    instrumental = mix - vocals
    return {
        "vocals": vocals,
        "backing": backing,
        "lead": lead,
        "instrumental": instrumental,
    }


def packed_complex_to_audio(spec: np.ndarray, length: int) -> np.ndarray:
    left = _istft_channel(spec[:N_BINS], length)
    right = _istft_channel(spec[N_BINS:], length)
    return np.stack([left, right], axis=0).astype(np.float32)


def _window_weights(n: int) -> np.ndarray:
    if n <= 1:
        return np.ones(n, dtype=np.float32)
    return np.hanning(n).astype(np.float32).clip(min=0.05)


def overlap_add(chunks: Iterable[Tuple[int, np.ndarray]], total_samples: int) -> np.ndarray:
    acc = np.zeros((2, total_samples), dtype=np.float64)
    weight = np.zeros(total_samples, dtype=np.float64)
    for start, audio in chunks:
        length = audio.shape[-1]
        end = min(start + length, total_samples)
        sl = end - start
        win = _window_weights(sl)
        acc[:, start:end] += audio[:, :sl] * win
        weight[start:end] += win
    weight = np.maximum(weight, 1e-8)
    return (acc / weight).astype(np.float32)


def run_session(onnx_path: Path, stft_repr: np.ndarray) -> np.ndarray:
    import onnxruntime as ort

    providers = []
    available = ort.get_available_providers()
    if "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    providers.append("CPUExecutionProvider")
    session = ort.InferenceSession(str(onnx_path), providers=providers)
    masks = session.run(["masks"], {"stft_repr": stft_repr})[0]
    return np.asarray(masks)


def separate_kara2(
    audio: np.ndarray,
    sr: int,
    progress_hook: Optional[Callable] = None,
    session_runner: Optional[Callable[[np.ndarray], np.ndarray]] = None,
) -> Dict[str, np.ndarray]:
    def report(message: str, percent: int) -> None:
        if progress_hook:
            progress_hook(2, 5, message, percent)

    stereo = to_stereo_44100(audio, sr)
    n_samples = stereo.shape[-1]
    starts = window_starts(n_samples)
    report("Loading KARA2 student model...", 22)
    runner = session_runner
    if runner is None:
        onnx_path = ensure_kara2_files()
        runner = lambda packed: run_session(onnx_path, packed)

    collected = {name: [] for name in ("lead", "backing", "instrumental")}
    for index, start in enumerate(starts):
        report(f"KARA2 window {index + 1}/{len(starts)}...", 25 + int(50 * index / max(len(starts), 1)))
        window = stereo[:, start:start + WINDOW_SAMPLES]
        packed = pack_stft(window)
        masks = runner(packed)
        specs = apply_masks(packed, masks)
        for name in collected:
            wave = packed_complex_to_audio(specs[name], min(WINDOW_SAMPLES, window.shape[-1]))
            collected[name].append((start, wave))

    original_len = n_samples
    # If we padded a short file, trim back to the real length.
    stems = {name: overlap_add(chunks, max(original_len, 1))[:, :original_len] for name, chunks in collected.items()}
    report("KARA2 lead / backing / instrumental ready", 80)
    return stems
