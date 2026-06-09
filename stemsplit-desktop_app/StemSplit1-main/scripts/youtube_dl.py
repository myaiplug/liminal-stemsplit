"""YouTube Audio/Video Downloader with Multi-Format Support

Supports:
- Audio: MP3 (128/192/320), WAV, FLAC (lossless)
- Video: MP4 at 360p, 480p, 720p, 1080p, 1440p, 4K UHD
- Extras: Thumbnail JPG, metadata embedding

Downloads are saved using the YouTube video title for both folder and filename.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path


def emit(event: str, **payload):
    print(json.dumps({"event": event, **payload}), flush=True)


def detect_js_runtimes():
    runtimes = {}
    for runtime in ("node", "deno", "bun", "quickjs"):
        runtime_path = shutil.which(runtime)
        if runtime_path:
            runtimes[runtime] = {"path": runtime_path}
    return runtimes


DOWNLOAD_MODES = {
    "audio_mp3_320": {"type": "audio", "codec": "mp3", "quality": "320", "format": "bestaudio", "ext": "mp3", "desc": "MP3 320kbps"},
    "audio_mp3_192": {"type": "audio", "codec": "mp3", "quality": "192", "format": "bestaudio", "ext": "mp3", "desc": "MP3 192kbps"},
    "audio_mp3_128": {"type": "audio", "codec": "mp3", "quality": "128", "format": "bestaudio", "ext": "mp3", "desc": "MP3 128kbps"},
    "audio_wav": {"type": "audio", "codec": "wav", "quality": None, "format": "bestaudio", "ext": "wav", "desc": "WAV lossless"},
    "audio_flac": {"type": "audio", "codec": "flac", "quality": "best", "format": "bestaudio", "ext": "flac", "desc": "FLAC lossless"},
    "video_360p": {"type": "video", "format": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]", "ext": "mp4", "desc": "360p"},
    "video_480p": {"type": "video", "format": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]", "ext": "mp4", "desc": "480p"},
    "video_720p": {"type": "video", "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]", "ext": "mp4", "desc": "720p HD"},
    "video_1080p": {"type": "video", "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]", "ext": "mp4", "desc": "1080p"},
    "video_1440p": {"type": "video", "format": "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]", "ext": "mp4", "desc": "1440p 2K"},
    "video_4k": {"type": "video", "format": "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]", "ext": "mp4", "desc": "4K UHD"},
    "thumbnail": {"type": "thumbnail", "ext": "jpg", "desc": "Thumbnail JPG"},
}

INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_title(title: str, max_len: int = 120) -> str:
    cleaned = INVALID_FILENAME_CHARS.sub("", title or "Untitled")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".")
    if not cleaned:
        cleaned = "Untitled"
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip(". ")
    return cleaned


def allocate_title_workspace(base_dir: Path, title: str) -> tuple[Path, str]:
    safe_title = sanitize_title(title)
    candidate_name = safe_title
    candidate_dir = base_dir / candidate_name
    counter = 2

    while candidate_dir.exists():
        candidate_name = f"{safe_title} ({counter})"
        candidate_dir = base_dir / candidate_name
        counter += 1

    candidate_dir.mkdir(parents=True, exist_ok=True)
    return candidate_dir, candidate_name


def progress_hook(data):
    status = data.get("status")
    if status == "downloading":
        percent_raw = str(data.get("_percent_str", "0%")).replace("%", "").strip()
        try:
            percent = max(0, min(100, int(float(percent_raw))))
        except ValueError:
            percent = 0
        emit("progress", message="Downloading...", percent=percent,
             downloaded_bytes=data.get("downloaded_bytes"),
             total_bytes=data.get("total_bytes") or data.get("total_bytes_estimate"))
    elif status == "finished":
        emit("progress", message="Processing...", percent=92)


def download_youtube(url: str, output_dir: Path, mode: str = "audio_mp3_320", embed_meta: bool = True):
    try:
        import yt_dlp
    except ImportError:
        emit("error", message="yt-dlp not installed")
        sys.exit(1)

    if mode not in DOWNLOAD_MODES:
        emit("error", message=f"Unknown mode: {mode}")
        sys.exit(1)

    cfg = DOWNLOAD_MODES[mode]
    output_dir.mkdir(parents=True, exist_ok=True)

    emit("progress", message=f"Resolving ({cfg['desc']})...", percent=5)

    try:
        probe_opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "js_runtimes": detect_js_runtimes()}
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        title = info.get("title", "Untitled")
        uploader = info.get("uploader", "Unknown")
        duration = info.get("duration", 0)
        thumb_url = info.get("thumbnail")

        work_dir, safe_title = allocate_title_workspace(output_dir, title)

        emit("progress", message=f"Found: {safe_title[:40]}...", percent=10)

        if mode == "thumbnail":
            if thumb_url:
                import urllib.request
                thumb_path = work_dir / f"{safe_title}.jpg"
                urllib.request.urlretrieve(thumb_url, str(thumb_path))
                emit("result", status="ok", file=str(thumb_path), title=title, safe_title=safe_title,
                     duration=duration, uploader=uploader, webpage_url=url, mode_used=mode,
                     formats_available=list(DOWNLOAD_MODES.keys()), output_directory=str(work_dir))
            else:
                emit("error", message="No thumbnail available")
                sys.exit(1)
            return

        output_template = str(work_dir / f"{safe_title}.%(ext)s")
        ydl_opts = {"outtmpl": output_template, "quiet": True, "no_warnings": True, "noplaylist": True,
                    "progress_hooks": [progress_hook], "js_runtimes": detect_js_runtimes()}

        if cfg["type"] == "audio":
            ydl_opts["format"] = cfg["format"]
            ydl_opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": cfg["codec"], "preferredquality": cfg["quality"] or ""}]
            if embed_meta:
                ydl_opts["postprocessors"].append({"key": "FFmpegMetadata", "add_metadata": True})

        elif cfg["type"] == "video":
            ydl_opts["format"] = cfg["format"] + "/bestvideo+bestaudio/best"
            ydl_opts["merge_output_format"] = "mp4"
            ydl_opts["postprocessors"] = [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}]
            if embed_meta:
                ydl_opts["postprocessors"].append({"key": "FFmpegMetadata", "add_metadata": True})
                ydl_opts["postprocessors"].append({"key": "EmbedThumbnail"})

        emit("progress", message="Starting download...", percent=15)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)

        expected_suffix = f".{cfg['ext']}"
        final_path = work_dir / f"{safe_title}{expected_suffix}"
        if not final_path.exists():
            matches = [
                candidate for candidate in work_dir.iterdir()
                if candidate.is_file() and candidate.suffix.lower() == expected_suffix and not candidate.name.endswith(".part")
            ]
            if len(matches) == 1:
                final_path = matches[0]
            elif matches:
                final_path = max(matches, key=lambda item: item.stat().st_mtime)

        if not final_path.exists():
            emit("error", message="Output file not found")
            sys.exit(1)

        emit("progress", message="Download complete", percent=98)
        emit("result", status="ok", file=str(final_path), title=title, safe_title=safe_title,
             duration=duration, uploader=uploader, webpage_url=url, mode_used=mode,
             formats_available=list(DOWNLOAD_MODES.keys()), output_directory=str(work_dir))

    except Exception as exc:
        emit("error", message=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YouTube downloader for StemSplit")
    parser.add_argument("--url", required=True, help="YouTube URL")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--mode", default="audio_mp3_320", choices=list(DOWNLOAD_MODES.keys()), help="Download mode")
    parser.add_argument("--embed-meta", action="store_true", default=True, help="Embed metadata")
    args = parser.parse_args()

    download_youtube(args.url, Path(args.output), mode=args.mode, embed_meta=args.embed_meta)