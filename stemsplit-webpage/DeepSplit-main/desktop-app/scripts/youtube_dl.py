"""YouTube Audio/Video Downloader with Multi-Format Support

Supports:
- Audio: MP3 (128/192/320), WAV, FLAC (lossless)
- Video: MP4 at 360p, 480p, 720p, 1080p, 1440p, 4K UHD
- Extras: Thumbnail JPG, metadata embedding

Usage:
    python youtube_dl.py --url "..." --output /path --mode audio_mp3_320
"""

import argparse
import json
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

        emit("progress", message=f"Found: {title[:30]}...", percent=10)

        if mode == "thumbnail":
            if thumb_url:
                import urllib.request
                thumb_path = output_dir / "thumbnail.jpg"
                urllib.request.urlretrieve(thumb_url, str(thumb_path))
                emit("result", status="ok", file=str(thumb_path), title=title, duration=duration,
                     uploader=uploader, webpage_url=url, mode_used=mode, formats_available=list(DOWNLOAD_MODES.keys()))
            else:
                emit("error", message="No thumbnail available")
                sys.exit(1)
            return

        output_template = str(output_dir / "source.%(ext)s")
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

        final_path = None
        for candidate in output_dir.iterdir():
            if candidate.name.startswith("source.") and candidate.suffix != ".part":
                final_path = candidate
                break

        if not final_path:
            emit("error", message="Output file not found")
            sys.exit(1)

        emit("progress", message="Download complete", percent=98)
        emit("result", status="ok", file=str(final_path), title=title, duration=duration,
             uploader=uploader, webpage_url=url, mode_used=mode, formats_available=list(DOWNLOAD_MODES.keys()))

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
