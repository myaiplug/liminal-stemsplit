"""
Pre-Split Audio Processor: Quality enhancement pipeline for stem splitting.

Responsibilities:
- Convert any audio format to 32-bit float WAV at target sample rate
- Apply optional loudness normalization (pyloudnorm, target: -16 LUFS)
- Apply optional HPSS pre-pass (harmonic/percussive separation)
- Emit JSON progress events compatible with Tauri IPC

Usage:
    python pre_split_processor.py \
        --input <input_file> \
        --output <output_dir> \
        --convert-wav \
        --normalize-loudness \
        --target-rate 44100
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def emit(event: str, **payload):
    """Emit JSON event for Tauri IPC."""
    print(json.dumps({"event": event, **payload}), flush=True)


def run_cmd(cmd, label: str = ""):
    """Run shell command, raise on failure."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        if proc.returncode != 0:
            error_msg = proc.stderr.strip() or proc.stdout.strip() or f"Command failed: {cmd}"
            raise RuntimeError(error_msg)
        return proc
    except Exception as exc:
        emit("error", message=f"{label}: {str(exc)}")
        sys.exit(1)


def get_audio_info(input_path: Path) -> dict:
    """Get audio file info via ffprobe."""
    emit("progress", message="Analyzing audio file...", percent=5)
    
    cmd = (
        f'ffprobe -v error -select_streams a:0 '
        f'-show_entries stream=duration,channels,sample_rate,codec_name '
        f'-of default=noprint_wrappers=1 "{input_path}"'
    )
    proc = run_cmd(cmd, "ffprobe")
    
    info = {}
    for line in proc.stdout.strip().split('\n'):
        if '=' in line:
            key, val = line.split('=', 1)
            info[key.strip()] = val.strip()
    
    return {
        "duration": float(info.get("duration", 0)),
        "channels": int(info.get("channels", 2)),
        "sample_rate": int(info.get("sample_rate", 44100)),
        "codec": info.get("codec_name", "unknown"),
    }


def convert_to_wav(input_path: Path, output_path: Path, target_rate: int = 44100) -> dict:
    """
    Convert any audio format to 32-bit float PCM WAV at target sample rate.
    
    This eliminates codec artifacts from lossy formats (MP3, AAC, M4A).
    Output: stereo, 32-bit float, target sample rate.
    """
    emit("progress", message=f"Converting to WAV ({target_rate} Hz)...", percent=15)
    
    cmd = (
        f'ffmpeg -y -i "{input_path}" '
        f'-vn -acodec pcm_f32le -ar {target_rate} -ac 2 '
        f'"{output_path}" -hide_banner -loglevel error'
    )
    run_cmd(cmd, "ffmpeg convert")
    
    emit("progress", message="WAV conversion complete", percent=35)
    return {"output": str(output_path), "sample_rate": target_rate}


def normalize_loudness(input_path: Path, output_path: Path, target_lufs: float = -16.0) -> dict:
    """
    Apply loudness normalization via pyloudnorm (ITU-R BS.1770).
    
    Targets: -16.0 LUFS, true peak: -1 dBTP.
    Prevents separator overload on hot masters.
    """
    emit("progress", message=f"Normalizing loudness to {target_lufs} LUFS...", percent=50)
    
    try:
        import pyloudnorm
        import soundfile as sf
        import numpy as np
    except ImportError as exc:
        emit("error", message=f"Missing dependency: {exc}. Install: pip install pyloudnorm soundfile")
        sys.exit(1)
    
    try:
        # Load audio
        data, rate = sf.read(str(input_path), dtype=np.float32)
        
        # Ensure stereo
        if len(data.shape) == 1:
            data = np.column_stack([data, data])
        
        # Measure loudness
        meter = pyloudnorm.Meter(rate)
        loudness = meter.integrated_loudness(data)
        
        if loudness == -np.inf:
            emit("progress", message="Audio is silent, skipping normalization", percent=65)
            import shutil
            shutil.copy2(str(input_path), str(output_path))
            return {"loudness_lufs": -np.inf, "output": str(output_path)}
        
        # Normalize
        normalized = pyloudnorm.normalize.loudness(data, loudness, target_lufs)
        
        # Ensure true peak <= -1 dBTP
        meter_tp = pyloudnorm.Meter(rate, block_size=0.4)
        true_peak = meter_tp.true_peak(normalized)
        
        if true_peak > -1.0:
            headroom = -1.0 - true_peak
            normalized = normalized * (10 ** (headroom / 20))
        
        # Write
        sf.write(str(output_path), normalized, rate, subtype='FLOAT')
        
        emit("progress", message="Loudness normalization complete", percent=70)
        return {"loudness_lufs": float(loudness), "output": str(output_path)}
    
    except Exception as exc:
        emit("error", message=f"Loudness normalization failed: {str(exc)}")
        sys.exit(1)


def apply_hpss_prepass(input_path: Path, output_dir: Path, margin: float = 2.0) -> dict:
    """
    Harmonic-Percussive Source Separation pre-pass via librosa.
    
    Splits audio into harmonic (vocals/leads) and percussive (drums/rhythm) components.
    Outputs both as separate files for targeted processing.
    
    Args:
        input_path: Input WAV file
        output_dir: Directory for harmonic.wav and percussive.wav
        margin: HPSS margin parameter (higher = cleaner separation, lower = more overlap)
    
    Returns:
        {"harmonic": str, "percussive": str}
    """
    emit("progress", message="Running harmonic-percussive separation...", percent=45)
    
    try:
        import librosa
        import soundfile as sf
        import numpy as np
    except ImportError as exc:
        emit("error", message=f"Missing dependency: {exc}. Install: pip install librosa soundfile")
        sys.exit(1)
    
    try:
        # Load audio
        y, sr = librosa.load(str(input_path), sr=None, mono=False)
        
        # Ensure stereo
        if len(y.shape) == 1:
            y = np.column_stack([y, y])
        
        # HPSS per channel
        harmonic_l = librosa.effects.hpss(y[:, 0], margin=margin)[0]
        harmonic_r = librosa.effects.hpss(y[:, 1], margin=margin)[0] if y.shape[1] > 1 else harmonic_l
        harmonic = np.column_stack([harmonic_l, harmonic_r])
        
        percussive_l = librosa.effects.hpss(y[:, 0], margin=margin)[1]
        percussive_r = librosa.effects.hpss(y[:, 1], margin=margin)[1] if y.shape[1] > 1 else percussive_l
        percussive = np.column_stack([percussive_l, percussive_r])
        
        # Write separated stems
        harmonic_path = output_dir / "harmonic.wav"
        percussive_path = output_dir / "percussive.wav"
        
        sf.write(str(harmonic_path), harmonic.astype(np.float32), sr, subtype='FLOAT')
        sf.write(str(percussive_path), percussive.astype(np.float32), sr, subtype='FLOAT')
        
        emit("progress", message="HPSS separation complete", percent=75)
        return {
            "harmonic": str(harmonic_path),
            "percussive": str(percussive_path),
        }
    
    except Exception as exc:
        emit("error", message=f"HPSS pre-pass failed: {str(exc)}")
        sys.exit(1)


def process_audio(
    input_path: Path,
    output_dir: Path,
    convert_wav: bool = True,
    normalize_loudness: bool = True,
    hpss_prepass: bool = False,
    target_sample_rate: int = 44100,
) -> dict:
    """
    Main preprocessing pipeline.
    
    Process flow:
      1. Analyze input
      2. Convert to WAV (if needed)
      3. Normalize loudness (if enabled)
      4. HPSS separation (if enabled)
      5. Return result paths
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Analyze
    info = get_audio_info(input_path)
    emit("progress", message=f"Input: {info['codec']} {info['sample_rate']} Hz {info['channels']}ch", percent=10)
    
    current_path = input_path
    
    # Step 2: Convert to WAV (if needed)
    if convert_wav and (info["codec"] != "pcm_s16le" and info["codec"] != "pcm_f32le"):
        wav_path = output_dir / "preprocessed.wav"
        convert_to_wav(current_path, wav_path, target_sample_rate)
        current_path = wav_path
    elif target_sample_rate != info["sample_rate"] and convert_wav:
        wav_path = output_dir / "preprocessed.wav"
        convert_to_wav(current_path, wav_path, target_sample_rate)
        current_path = wav_path
    
    # Step 3: Normalize loudness (if enabled)
    if normalize_loudness:
        norm_path = output_dir / "normalized.wav"
        normalize_loudness(current_path, norm_path, target_lufs=-16.0)
        current_path = norm_path
    
    # Step 4: HPSS pre-pass (if enabled)
    hpss_files = None
    if hpss_prepass:
        hpss_files = apply_hpss_prepass(current_path, output_dir, margin=2.0)
    
    emit("progress", message="Preprocessing complete", percent=95)
    
    result = {
        "status": "ok",
        "output_path": str(current_path),
        "duration_seconds": info["duration"],
        "sample_rate": target_sample_rate,
        "channels": info["channels"],
    }
    
    if hpss_files:
        result["hpss"] = hpss_files
    
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Pre-Split Audio Processor — quality enhancement for stem splitting"
    )
    parser.add_argument("--input", required=True, help="Input audio file (any format)")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--convert-wav", action="store_true", default=True, help="Convert to WAV")
    parser.add_argument("--no-convert-wav", dest="convert_wav", action="store_false", help="Skip WAV conversion")
    parser.add_argument("--normalize-loudness", action="store_true", default=True, help="Apply loudness normalization")
    parser.add_argument("--no-normalize", dest="normalize_loudness", action="store_false", help="Skip loudness norm")
    parser.add_argument("--hpss-prepass", action="store_true", default=False, help="Run HPSS separation")
    parser.add_argument("--target-rate", type=int, default=44100, help="Target sample rate (default: 44100)")
    
    args = parser.parse_args()
    
    input_file = Path(args.input)
    output_directory = Path(args.output)
    
    if not input_file.exists():
        emit("error", message=f"Input file not found: {input_file}")
        sys.exit(1)
    
    try:
        result = process_audio(
            input_file,
            output_directory,
            convert_wav=args.convert_wav,
            normalize_loudness=args.normalize_loudness,
            hpss_prepass=args.hpss_prepass,
            target_sample_rate=args.target_rate,
        )
        
        emit("result", **result)
        emit("progress", message="Done", percent=100)
    
    except Exception as exc:
        emit("error", message=str(exc))
        sys.exit(1)
