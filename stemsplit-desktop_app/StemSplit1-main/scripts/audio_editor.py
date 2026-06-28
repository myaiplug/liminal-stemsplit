#!/usr/bin/env python3
"""Export a time-range clip from an audio file (WAV/MP3/FLAC)."""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import soundfile as sf


def export_clip(input_path: str, start_sec: float, end_sec: float, output_path: str) -> dict:
    if end_sec <= start_sec:
        raise ValueError(f"Invalid range: {start_sec}s – {end_sec}s")

    data, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    start_sample = max(0, int(round(start_sec * sample_rate)))
    end_sample = min(len(data), int(round(end_sec * sample_rate)))

    if end_sample <= start_sample:
        raise ValueError("Selection is empty after sample conversion")

    clip = data[start_sample:end_sample]
    sf.write(output_path, clip, sample_rate)

    duration = (end_sample - start_sample) / float(sample_rate)
    return {
        "status": "success",
        "output_path": output_path,
        "duration_seconds": duration,
        "sample_rate": sample_rate,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Export an audio clip by time range")
    parser.add_argument("input", help="Source audio file path")
    parser.add_argument("--start", type=float, required=True, help="Start time in seconds")
    parser.add_argument("--end", type=float, required=True, help="End time in seconds")
    parser.add_argument("--output", required=True, help="Output WAV path")
    args = parser.parse_args()

    try:
        result = export_clip(args.input, args.start, args.end, args.output)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())