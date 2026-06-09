import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def emit(event: str, **payload):
    print(json.dumps({"event": event, **payload}), flush=True)


def run_cmd(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"Command failed")
    return proc


def get_audio_duration_seconds(input_path: Path) -> float:
    proc = run_cmd(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)])
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def select_auto_model(input_path: Path) -> str:
    duration = get_audio_duration_seconds(input_path)
    try:
        import torch
        has_cuda = torch.cuda.is_available()
    except Exception:
        has_cuda = False

    if has_cuda:
        return "small" if duration > 1800 else "base"
    return "tiny" if duration > 1800 else "base"


PRESETS = {
    "none": [],
    "clean_speech": ["highpass=f=80", "lowpass=f=8000", "afftdn=nf=-24", "acompressor=threshold=-20dB:ratio=2:attack=20:release=200"],
    "podcast_voice": ["highpass=f=90", "lowpass=f=9000", "equalizer=f=220:width_type=o:width=1.2:g=2", "equalizer=f=3500:width_type=o:width=1.2:g=2", "acompressor=threshold=-18dB:ratio=3:attack=10:release=220", "loudnorm=I=-16:TP=-1.5:LRA=7"],
    "noisy_room": ["highpass=f=100", "lowpass=f=7000", "afftdn=nf=-30", "anlmdn=s=7:p=0.003", "acompressor=threshold=-22dB:ratio=2.5:attack=15:release=250"],
    "phone_call": ["highpass=f=250", "lowpass=f=3400", "acompressor=threshold=-20dB:ratio=2:attack=8:release=120"],
    "lyric_slow": ["atempo=0.80", "highpass=f=80", "lowpass=f=10000", "loudnorm=I=-16:TP=-1.5:LRA=9"],
    "vad_clean": ["highpass=f=80", "silenceremove=start_periods=1:stop_periods=-1:stop_threshold=-40dB"],
}

INITIAL_PROMPTS = {
    "music_lyrics": "Song lyrics with verses, chorus, and bridge.",
    "podcast": "Podcast episode transcript. Speaker turns may be present.",
    "interview": "Interview between two or more speakers.",
    "lecture": "Academic lecture. Technical terminology expected.",
    "meeting": "Business meeting transcript. Action items discussed.",
}


def preprocess_audio(input_path: Path, output_path: Path, preset: str):
    filters = PRESETS.get(preset, PRESETS["clean_speech"])
    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-vn", "-ac", "1", "-ar", "16000"]
    if filters:
        cmd.extend(["-af", ",".join(filters)])
    cmd.append(str(output_path))
    run_cmd(cmd)


def to_srt_ts(seconds: float):
    ms = int(round(seconds * 1000))
    hh = ms // 3600000
    ms %= 3600000
    mm = ms // 60000
    ms %= 60000
    ss = ms // 1000
    ms %= 1000
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


def to_vtt_ts(seconds: float):
    hh = int(seconds // 3600)
    mm = int((seconds % 3600) // 60)
    ss = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{hh:02d}:{mm:02d}:{ss:02d}.{ms:03d}"


def transcribe_audio(input_path: Path, output_dir: Path, preset: str, model: str, language: str, task: str, content_type: str = "default"):
    try:
        import whisper
    except Exception as exc:
        raise RuntimeError(f"openai-whisper not installed: {exc}") from exc

    selected_model = select_auto_model(input_path) if model == "auto" else model
    emit("progress", message=f"Loading Whisper {selected_model}...", percent=36)
    whisper_model = whisper.load_model(selected_model)

    kwargs = {"task": task, "fp16": False, "word_timestamps": True,
              "beam_size": 5, "best_of": 5, "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
              "condition_on_previous_text": True}
    if language:
        kwargs["language"] = language
    if content_type in INITIAL_PROMPTS:
        kwargs["initial_prompt"] = INITIAL_PROMPTS[content_type]

    emit("progress", message="Running transcription...", percent=68)
    result = whisper_model.transcribe(str(input_path), **kwargs)

    txt_path = output_dir / "transcript.txt"
    json_path = output_dir / "transcript.json"
    srt_path = output_dir / "transcript.srt"
    vtt_path = output_dir / "transcript.vtt"
    word_srt_path = output_dir / "transcript.word.srt"

    emit("progress", message="Writing outputs...", percent=90)
    txt_path.write_text(result.get("text", "").strip() + "\n", encoding="utf-8")
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    segments = result.get("segments", [])
    
    # SRT segment-level
    srt_lines = []
    for index, segment in enumerate(segments, start=1):
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", 0.0))
        text = str(segment.get("text", "")).strip()
        srt_lines.extend([str(index), f"{to_srt_ts(start)} --> {to_srt_ts(end)}", text, ""])
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

    # VTT segment-level
    vtt_lines = ["WEBVTT\n"]
    for segment in segments:
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", 0.0))
        text = str(segment.get("text", "")).strip()
        vtt_lines.extend([f"{to_vtt_ts(start)} --> {to_vtt_ts(end)}", text, ""])
    vtt_path.write_text("\n".join(vtt_lines), encoding="utf-8")

    # Word-level SRT (karaoke style)
    word_lines = []
    word_counter = 1
    for segment in segments:
        words = segment.get("words", [])
        for word_data in words:
            word_text = word_data.get("word", "").strip()
            if not word_text:
                continue
            start = float(word_data.get("start", 0.0))
            end = float(word_data.get("end", 0.0))
            word_lines.extend([str(word_counter), f"{to_srt_ts(start)} --> {to_srt_ts(end)}", word_text, ""])
            word_counter += 1
    if word_lines:
        word_srt_path.write_text("\n".join(word_lines), encoding="utf-8")

    preview = result.get("text", "").strip()[:600]
    emit("result", status="ok", textFile=str(txt_path), jsonFile=str(json_path), srtFile=str(srt_path),
         vttFile=str(vtt_path), wordSrtFile=str(word_srt_path) if word_lines else None,
         model=selected_model, preset=preset, task=task, contentType=content_type,
         transcriptPreview=preview, segmentCount=len(segments), detectedLanguage=result.get("language", language or None))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe with Whisper for StemSplit")
    parser.add_argument("--input", required=True, help="Input audio")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--preset", default="clean_speech", choices=list(PRESETS.keys()), help="Audio preset")
    parser.add_argument("--model", default="auto", help="Whisper model")
    parser.add_argument("--language", default="", help="Language code")
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"], help="Task")
    parser.add_argument("--content-type", default="default", choices=list(INITIAL_PROMPTS.keys()) + ["default"], help="Content type for prompt hints")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        emit("error", message=f"Input not found: {input_path}")
        sys.exit(1)

    try:
        transcribe_audio(input_path, output_dir, args.preset, args.model, args.language, args.task, args.content_type)
    except Exception as exc:
        emit("error", message=str(exc))
        sys.exit(1)

    with tempfile.TemporaryDirectory(prefix="stemsplit_whisper_") as temp_dir:
        processed_path = Path(temp_dir) / "preprocessed.wav"
        try:
            emit("progress", message="Preparing audio for transcription...", percent=12)
            preprocess_audio(input_path, processed_path, args.preset)
            transcribe_audio(processed_path, output_dir, args.preset, args.model, args.language, args.task)
        except Exception as exc:
            emit("error", message=str(exc))
            sys.exit(1)
