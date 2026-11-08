"""Remix-session extras: chords, a song sheet, and per-stem MIDI sketches.

Chord detection is original code on top of librosa chroma. It does NOT call
CrispASR --chords (those weights are CC-BY-NC-SA and cannot ship in a paid app).

MIDI files are written with a dependency-free Standard MIDI File writer. If a
local CrispASR binary is already present, Basic Pitch (MIT, ~110 KB) is tried
first for a better sketch.
"""

from __future__ import annotations

import logging
import struct
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_TEMPLATE = np.array([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
MINOR_TEMPLATE = np.array([1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])


def rotate(template: np.ndarray, steps: int) -> np.ndarray:
    return np.roll(template, steps)


def detect_chords(audio: np.ndarray, sr: int, hop_seconds: float = 1.5) -> List[Dict[str, object]]:
    """Return a timeline of estimated major/minor chords."""
    import librosa

    y = np.mean(audio, axis=0) if getattr(audio, "ndim", 1) > 1 else np.asarray(audio)
    hop_length = max(512, int(sr * 0.25))
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop_length)
    window = max(1, int(hop_seconds / (hop_length / sr)))

    events: List[Dict[str, object]] = []
    last_label = ""
    for start in range(0, chroma.shape[1], window):
        chunk = np.mean(chroma[:, start:start + window], axis=1)
        if np.allclose(chunk, 0):
            continue
        chunk = chunk / (np.linalg.norm(chunk) + 1e-8)
        best_score = -1.0
        best_label = "N"
        for root in range(12):
            maj = float(np.dot(chunk, rotate(MAJOR_TEMPLATE, root) / np.linalg.norm(MAJOR_TEMPLATE)))
            minor = float(np.dot(chunk, rotate(MINOR_TEMPLATE, root) / np.linalg.norm(MINOR_TEMPLATE)))
            if maj > best_score:
                best_score = maj
                best_label = NOTES[root]
            if minor > best_score:
                best_score = minor
                best_label = f"{NOTES[root]}m"
        t = float(frame_times[start])
        if best_label != last_label:
            events.append({"time": round(t, 3), "chord": best_label, "confidence": round(best_score, 3)})
            last_label = best_label
    return events


def sketch_notes(audio: np.ndarray, sr: int) -> List[Tuple[float, float, int, int]]:
    """Turn a stem into coarse (start, end, midi, velocity) notes via chroma + onsets."""
    import librosa

    y = np.mean(audio, axis=0) if getattr(audio, "ndim", 1) > 1 else np.asarray(audio)
    if y.size < sr // 4:
        return []
    hop_length = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop_length, backtrack=True)
    if onset_frames is None or len(onset_frames) == 0:
        onset_frames = np.array([0], dtype=int)
    onset_frames = np.append(onset_frames, chroma.shape[1])
    notes: List[Tuple[float, float, int, int]] = []
    for i in range(len(onset_frames) - 1):
        start_f = int(onset_frames[i])
        end_f = int(onset_frames[i + 1])
        if end_f <= start_f:
            continue
        avg = np.mean(chroma[:, start_f:end_f], axis=1)
        pitch_class = int(np.argmax(avg))
        energy = float(np.mean(np.abs(y[
            int(start_f * hop_length): max(int(start_f * hop_length) + 1, int(end_f * hop_length))
        ])))
        if energy < 1e-4:
            continue
        start_t = start_f * hop_length / sr
        end_t = end_f * hop_length / sr
        midi = 60 + pitch_class  # around middle C
        velocity = int(np.clip(energy * 800, 40, 110))
        notes.append((start_t, max(end_t, start_t + 0.08), midi, velocity))
    return notes


def _encode_vlq(value: int) -> bytes:
    buffer = value & 0x7F
    parts = [buffer]
    value >>= 7
    while value:
        parts.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(parts)) if len(parts) > 1 else bytes(parts)


def write_midi(path: Path, notes: Sequence[Tuple[float, float, int, int]], bpm: float = 120.0) -> Path:
    """Write a type-0 SMF. notes = (start_sec, end_sec, midi_note, velocity)."""
    ppq = 480
    tempo_bpm = bpm if bpm and bpm > 0 else 120.0
    usec_per_beat = int(60_000_000 / tempo_bpm)

    events: List[Tuple[int, int, bytes]] = []
    # sort-key, then payload. meta/tempo first at tick 0
    events.append((0, 0, bytes([0xFF, 0x51, 0x03]) + struct.pack(">I", usec_per_beat)[1:]))
    for start, end, note, velocity in notes:
        start_tick = max(0, int(start * tempo_bpm / 60.0 * ppq))
        end_tick = max(start_tick + 1, int(end * tempo_bpm / 60.0 * ppq))
        note = int(np.clip(note, 0, 127))
        velocity = int(np.clip(velocity, 1, 127))
        events.append((start_tick, 1, bytes([0x90, note, velocity])))
        events.append((end_tick, 2, bytes([0x80, note, 0])))
    events.sort()

    track = bytearray()
    last_tick = 0
    for tick, _order, payload in events:
        delta = tick - last_tick
        track.extend(_encode_vlq(delta))
        track.extend(payload)
        last_tick = tick
    track.extend(_encode_vlq(0))
    track.extend(bytes([0xFF, 0x2F, 0x00]))

    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq)
    track_chunk = b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + track_chunk)
    return path


def try_basic_pitch_midi(stem_path: Path, dest: Path) -> bool:
    """Reuse an already-installed CrispASR binary for Basic Pitch (MIT)."""
    try:
        from crisp_separate import find_crispasr
    except Exception:
        return False
    binary = find_crispasr()
    if binary is None:
        return False
    import subprocess
    completed = subprocess.run(
        [str(binary), "--backend", "basic-pitch", "-m", "auto", "-f", str(stem_path), "--piano-format", "midi"],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        logger.info("Basic Pitch MIDI skipped: %s", completed.stderr[-300:] if completed.stderr else "nonzero exit")
        return False
    generated = list(stem_path.parent.glob(f"{stem_path.stem}*.mid"))
    generated += list(stem_path.parent.glob("*.mid"))
    if not generated:
        return False
    newest = max(generated, key=lambda p: p.stat().st_mtime)
    if newest.resolve() != dest.resolve():
        dest.write_bytes(newest.read_bytes())
    return dest.is_file()


def format_song_sheet(
    title: str,
    bpm: float,
    key: str,
    chords: Sequence[Dict[str, object]],
    stem_names: Iterable[str],
) -> str:
    lines = [
        f"Title: {title}",
        f"BPM: {bpm:.1f}" if bpm else "BPM: unknown",
        f"Key: {key or 'unknown'}",
        "",
        "Chords (estimated, local chroma templates — not a licensed chord model):",
    ]
    if chords:
        for event in chords:
            minutes = int(float(event["time"]) // 60)
            seconds = float(event["time"]) % 60
            lines.append(f"  {minutes}:{seconds:05.2f}  {event['chord']}")
    else:
        lines.append("  (none detected)")
    lines.append("")
    lines.append("Stems in this remix kit:")
    for name in stem_names:
        lines.append(f"  - {name}")
    lines.append("")
    lines.append("Each stem also has a .mid sketch you can drop into a DAW.")
    lines.append("This folder is the remix kit: stems + analysis + MIDI, no generative cover model.")
    return "\n".join(lines) + "\n"


def write_remix_session(
    output_dir: str,
    stem_files: Dict[str, str],
    mix_audio: np.ndarray,
    sr: int,
    bpm: float = 0.0,
    key: str = "",
    title: str = "",
    progress_hook: Optional[Callable] = None,
) -> Dict[str, str]:
    def report(message: str, percent: int) -> None:
        if progress_hook:
            progress_hook(5, 5, message, percent)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    report("Detecting chords for remix kit...", 93)
    try:
        chords = detect_chords(mix_audio, sr)
    except Exception as exc:
        logger.warning("Chord detection failed: %s", exc)
        chords = []

    import json
    chords_path = out / "chords.json"
    chords_path.write_text(json.dumps(chords, indent=2), encoding="utf-8")

    sheet_path = out / "SONG_INFO.txt"
    sheet_path.write_text(
        format_song_sheet(title or out.name, bpm, key, chords, stem_files.keys()),
        encoding="utf-8",
    )

    written = {"chords": str(chords_path), "song_info": str(sheet_path)}
    import soundfile as sf

    for name, path in stem_files.items():
        dest = out / f"{name}.mid"
        report(f"Writing MIDI sketch for {name}...", 95)
        used_basic_pitch = False
        try:
            used_basic_pitch = try_basic_pitch_midi(Path(path), dest)
        except Exception as exc:
            logger.info("Basic Pitch unavailable for %s: %s", name, exc)
        if not used_basic_pitch:
            try:
                audio, file_sr = sf.read(path, always_2d=True)
                notes = sketch_notes(audio.T, file_sr)
            except Exception as exc:
                logger.warning("Could not sketch MIDI for %s: %s", name, exc)
                notes = []
            write_midi(dest, notes, bpm=bpm)
        written[f"midi_{name}"] = str(dest)
    return written
