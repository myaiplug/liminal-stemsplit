#!/usr/bin/env python3
"""Trim uploaded audio to 30s WAV and split into 4 stems with Demucs (free, local)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

MAX_SECONDS = 30
STEM_NAMES = ("drums", "bass", "other", "vocals")
MODEL = "htdemucs"


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    for candidate in (
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
    ):
        if Path(candidate).exists():
            return candidate
    raise RuntimeError("ffmpeg not found. Install ffmpeg and ensure it is on PATH.")


def write_status(job_dir: Path, phase: str, progress: int = 0, message: str = "", error: str = ""):
    payload = {
        "phase": phase,
        "progress": progress,
        "message": message,
        "error": error,
        "updatedAt": int(time.time() * 1000),
    }
    (job_dir / "status.json").write_text(json.dumps(payload), encoding="utf-8")


def run_cmd(cmd: list[str], label: str):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"{label} failed: {detail[-1200:]}")
    return proc


def prepare_audio(input_path: Path, prepared_wav: Path, ffmpeg: str, job_dir: Path):
    write_status(job_dir, "preparing", 10, "Converting and trimming to 30 seconds...")
    cmd = [
        ffmpeg, "-y",
        "-i", str(input_path),
        "-t", str(MAX_SECONDS),
        "-ar", "44100",
        "-ac", "2",
        "-c:a", "pcm_s16le",
        str(prepared_wav),
    ]
    run_cmd(cmd, "Audio preparation")


def save_wav(path: Path, tensor, samplerate: int):
    import soundfile as sf

    data = tensor.detach().cpu().numpy().T
    sf.write(str(path), data, samplerate, subtype="PCM_16")


def run_demucs(prepared_wav: Path, work_dir: Path, job_dir: Path):
    write_status(job_dir, "separating", 35, "Running AI stem separation (1-3 min on CPU)...")

    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model

    model = get_model(MODEL)
    model.cpu()
    model.eval()

    wav = AudioFile(prepared_wav).read(
        streams=0,
        samplerate=model.samplerate,
        channels=model.audio_channels,
    )

    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()

    sources = apply_model(
        model,
        wav[None],
        device="cpu",
        shifts=1,
        split=True,
        overlap=0.25,
        progress=True,
        num_workers=1,
        segment=7,
    )[0]

    sources = sources * ref.std() + ref.mean()

    out_dir = work_dir / MODEL / prepared_wav.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    for source, name in zip(sources, model.sources):
        save_wav(out_dir / f"{name}.wav", source, model.samplerate)

    del model, sources, wav
    torch.cuda.empty_cache() if torch.cuda.is_available() else None


def collect_stems(work_dir: Path, stems_dir: Path, job_dir: Path) -> dict[str, str]:
    write_status(job_dir, "finalizing", 90, "Packaging stems...")
    candidates = list(work_dir.rglob("*.wav"))
    if not candidates:
        raise RuntimeError("Demucs produced no WAV stems.")

    found: dict[str, Path] = {}
    for wav in candidates:
        stem = wav.stem.lower()
        if stem in STEM_NAMES and stem not in found:
            found[stem] = wav

    missing = [name for name in STEM_NAMES if name not in found]
    if missing:
        raise RuntimeError(f"Missing stems after separation: {', '.join(missing)}")

    stems_dir.mkdir(parents=True, exist_ok=True)
    for name in STEM_NAMES:
        dest = stems_dir / f"{name}.wav"
        shutil.copy2(found[name], dest)

    return {name: f"stems/{name}.wav" for name in STEM_NAMES}


def separate(input_path: Path, job_dir: Path) -> dict:
    job_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()
    prepared_wav = job_dir / "prepared.wav"
    work_dir = job_dir / "demucs_out"
    stems_dir = job_dir / "stems"

    write_status(job_dir, "queued", 0, "Job started")
    prepare_audio(input_path, prepared_wav, ffmpeg, job_dir)
    run_demucs(prepared_wav, work_dir, job_dir)
    stems = collect_stems(work_dir, stems_dir, job_dir)

    result = {
        "success": True,
        "duration": MAX_SECONDS,
        "model": MODEL,
        "stems": stems,
        "trackName": input_path.stem,
    }
    (job_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    write_status(job_dir, "done", 100, "Separation complete")
    return result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: separate_demo.py <input_file> <job_dir>"}))
        sys.exit(1)

    input_path = Path(sys.argv[1]).resolve()
    job_dir = Path(sys.argv[2]).resolve()

    if not input_path.exists():
        print(json.dumps({"success": False, "error": f"Input file not found: {input_path}"}))
        sys.exit(1)

    try:
        result = separate(input_path, job_dir)
        print(json.dumps(result))
    except Exception as exc:
        write_status(job_dir, "error", 0, "Separation failed", str(exc))
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()