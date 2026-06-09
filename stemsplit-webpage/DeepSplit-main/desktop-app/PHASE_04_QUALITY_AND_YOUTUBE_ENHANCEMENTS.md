# PHASE 04 — Quality Enhancement & YouTube Feature Expansion

**Date:** April 4, 2026  
**Status:** 🟡 PLANNING  
**Builds On:** Phase 03 (Fail-Proof Installer), v0.4.0 baseline  

---

## Executive Summary

Three independent improvement pillars addressing the current pain points:

1. **Stem Split Quality** — eliminate artifacts before the separator even sees the audio
2. **YouTube Downloader Expansion** — full-featured download suite (MP4 qualities, WAV, FLAC, thumbnail, metadata)
3. **Whisper Transcription Accuracy** — pipeline tricks that measurably improve word-error-rate

These changes are additive. None break existing behavior. Each can ship independently.

---

## PILLAR 1 — Stem Split Quality Pipeline

### Problem
Current flow feeds raw input (often a lossy MP3) directly to Demucs. Compressed-domain artifacts in the source get amplified by the separator, especially on transients and high-frequency content (cymbals, breath, sibilance).

### Proposed Pre-Split Preprocessing Chain

```
Input File
     │
     ▼
[ 1. Decode + Resample ]  →  PCM 32-bit float WAV, 44100 Hz stereo
     │                         (eliminates codec artifacts from any lossy format)
     ▼
[ 2. Optional: Loudness Normalize ]  →  LUFS -16 target (prevents clipping in model)
     │
     ▼
[ 3. Optional: Harmonic-Percussive Separation Pre-Pass ]
     │   librosa.effects.hpss() — splits harmonics vs percussive energy
     │   Feed harmonic channel to vocal/instrument separator
     │   Feed percussive channel to drums separator directly
     │   Result: model sees clean signal domain per stem type
     ▼
[ 4. Demucs / Model Separation ]
     │
     ▼
[ 5. Optional: Post-Wiener Filter ]  →  spectral smoothing pass on each stem output
     │   scipy/librosa spectrogram masking to suppress bleed noise floor
     ▼
[ 6. Output ]  →  WAV 32-bit float OR user-selected format
```

### Implementation Plan

#### A. Preprocessing Script — `scripts/pre_split_processor.py`

**Responsibilities:**
- Accept any audio format input (MP3, M4A, AAC, FLAC, WAV, OGG)
- Convert to 32-bit float WAV at native or target sample rate (default 44100 Hz)
- Apply optional loudness normalization (pyloudnorm, target: -16 LUFS, true peak: -1 dBTP)
- Apply optional HPSS pre-pass (librosa)
- Emit JSON progress events compatible with existing Tauri IPC model

**Key FFmpeg Command for WAV Conversion:**
```bash
ffmpeg -y -i "<input>" \
  -vn \
  -acodec pcm_f32le \
  -ar 44100 \
  -ac 2 \
  "<output>.wav"
```
This alone eliminates most audible ghosting on cymbals and hi-hats by removing lossy codec reconstruction assumptions.

**Loudness Normalization (pyloudnorm wrapper):**
```python
import pyloudnorm as pyln
import soundfile as sf

data, rate = sf.read(wav_path)
meter = pyln.Meter(rate)
loudness = meter.integrated_loudness(data)
normalized = pyln.normalize.loudness(data, loudness, -16.0)
sf.write(processed_path, normalized, rate, subtype='FLOAT')
```

#### B. UI Controls in Config Modal

Add a "PRE-SPLIT QUALITY" section inside the existing Config Options modal:

| Toggle | Default | Description |
|--------|---------|-------------|
| Convert to WAV first | ✅ ON | Always convert lossy source to PCM float WAV before separation |
| Loudness normalize | ✅ ON | LUFS -16 normalization to prevent separator overload |
| HPSS pre-pass | ⬜ OFF | Advanced: harmonic/percussive domain split before model |
| Post Wiener filter | ⬜ OFF | Spectral bleed suppression on outputs (slower) |

#### C. Tauri Backend Changes — `src-tauri/src/main.rs`

New Tauri command:
```rust
#[tauri::command]
async fn preprocess_audio_for_split(input_path: String, options: PreSplitOptions) -> Result<PreSplitResult, String>
```

`PreSplitOptions` struct:
- `convert_to_wav: bool`
- `normalize_loudness: bool`
- `hpss_prepass: bool`
- `target_sample_rate: u32`

`PreSplitResult`:
- `output_path: String`
- `original_format: String`
- `duration_seconds: f64`
- `loudness_lufs: f64`

The command invokes `pre_split_processor.py`, then hands the output path to the existing stem separation pipeline — the caller substitutes the preprocessed WAV as the new source.

#### D. Slow-Down Trick for Transcription (NOT Splitting)

When routing audio to Whisper transcription, applying a 0.75x time stretch (pitch-preserved) before the Whisper call measurably improves word error rate (WER) on fast speakers and dense lyric content. The stretch is reversed in timestamps so outputs remain time-accurate.

**FFmpeg time-stretch command:**
```bash
ffmpeg -y -i "<input.wav>" \
  -af "rubberband=tempo=0.75:pitch=1.0:smoothing=1" \
  -ar 16000 -ac 1 \
  "<slowed_16k.wav>"
```
Or with the `atempo` filter for portability (no rubberband needed):
```bash
-af "atempo=0.75,aresample=16000"
```

After Whisper returns timestamps, multiply all `start` and `end` values by `1/0.75 = 1.333...` to re-align to the original audio timeline.

**Add to Whisper presets as "lyric_slow":**
```python
"lyric_slow": [
    "atempo=0.75",
    "highpass=f=80",
    "lowpass=f=10000",
    "loudnorm=I=-16:TP=-1.5:LRA=9",
]
```
Resample to 16 kHz mono (Whisper's native input) after the tempo filter.

---

## PILLAR 2 — YouTube Download Suite Expansion

### Problem
Current `youtube_dl.py` only supports a single output: MP3 320kbps. Users want:
- Video downloads in multiple resolutions
- Thumbnail extraction (highest available resolution)
- Lossless audio (WAV, FLAC)
- Multiple MP3 bitrates for smaller file needs
- Metadata embedded in all outputs

### Proposed Download Options Architecture

#### Download Mode Enum

```
YT_DOWNLOAD_MODE:
  "audio_mp3_320"   →  MP3 320kbps (current default, unchanged)
  "audio_mp3_192"   →  MP3 192kbps
  "audio_mp3_128"   →  MP3 128kbps
  "audio_wav"       →  WAV PCM 16-bit 44.1kHz (lossless audio)
  "audio_flac"      →  FLAC lossless (smaller than WAV, same quality)
  "video_360p"      →  MP4 video + audio, 360p
  "video_480p"      →  MP4 video + audio, 480p
  "video_720p"      →  MP4 video + audio, 720p (HD)
  "video_1080p"     →  MP4 video + audio, 1080p (Full HD)
  "video_1440p"     →  MP4 video + audio, 1440p (2K, if available)
  "video_4k"        →  MP4 video + audio, 4K UHD (if available)
  "thumbnail"       →  Highest-res JPEG/WEBP thumbnail only
  "stem_source"     →  (current behavior) MP3 320kbps for stem splitting
```

#### `scripts/youtube_dl.py` Rewrite Plan

**New arguments:**
```
--url         YouTube URL (required)
--output      Output directory (required)
--mode        One of the YT_DOWNLOAD_MODE values (default: stem_source)
--embed-meta  Embed title/artist/thumbnail as ID3/mp4 tags (default: true)
```

**Audio mode implementation (MP3/WAV/FLAC):**
```python
AUDIO_MODES = {
    "audio_mp3_320": {"codec": "mp3", "quality": "320"},
    "audio_mp3_192": {"codec": "mp3", "quality": "192"},
    "audio_mp3_128": {"codec": "mp3", "quality": "128"},
    "audio_wav":     {"codec": "wav", "quality": None},
    "audio_flac":    {"codec": "flac", "quality": "best"},
    "stem_source":   {"codec": "mp3", "quality": "320"},
}

postprocessors = [{
    "key": "FFmpegExtractAudio",
    "preferredcodec": mode_cfg["codec"],
    "preferredquality": mode_cfg["quality"] or "",
}]
if embed_meta:
    postprocessors.append({"key": "FFmpegMetadata", "add_metadata": True})
    postprocessors.append({"key": "EmbedThumbnail"})
```

**Video mode implementation (MP4 adaptive):**
```python
VIDEO_FORMAT_MAP = {
    "video_360p":  "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]",
    "video_480p":  "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]",
    "video_720p":  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]",
    "video_1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]",
    "video_1440p": "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440][ext=mp4]",
    "video_4k":    "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]",
}

# Fallback chain: requested res → next lower → best available
ydl_opts["format"] = VIDEO_FORMAT_MAP[mode] + "/bestvideo+bestaudio/best"
ydl_opts["merge_output_format"] = "mp4"
ydl_opts["postprocessors"] = [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}]
```

**Thumbnail mode:**
```python
if mode == "thumbnail":
    ydl_opts["skip_download"] = True
    ydl_opts["writethumbnail"] = True
    ydl_opts["postprocessors"] = [{"key": "FFmpegThumbnailsConvertor", "format": "jpg"}]
    # Emits result with thumbnail_path
```

**Metadata extraction for result event:**
```json
{
  "event": "result",
  "status": "ok",
  "file": "/path/to/source.mp3",
  "thumbnail_path": "/path/to/source.jpg",
  "title": "Track Title",
  "artist": "Channel / Uploader",
  "duration": 243,
  "view_count": 1200000,
  "like_count": 45000,
  "upload_date": "20240315",
  "description_snippet": "First 200 chars of description...",
  "formats_available": ["360p", "720p", "1080p"],
  "mode_used": "audio_mp3_320"
}
```

#### UI Redesign — YouTube Import Modal

**Current:** Single URL input + import button

**New Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  YOUTUBE IMPORT                                 [×]     │
├─────────────────────────────────────────────────────────┤
│  URL  [______________________________________]  PROBE   │
│                                                         │
│  ┌──── DOWNLOAD TARGET ────────────────────────────┐   │
│  │ ⦿ STEM SOURCE (MP3 320kbps)  ← use for splits  │   │
│  │ ○ MP3 192kbps   ○ MP3 128kbps                  │   │
│  │ ○ WAV (lossless)  ○ FLAC (lossless)             │   │
│  │                                                 │   │
│  │ ── VIDEO EXPORT ──────────────────────────────  │   │
│  │ ○ 360p MP4   ○ 480p MP4   ○ 720p HD            │   │
│  │ ○ 1080p FHD  ○ 1440p 2K  ○ 4K UHD             │   │
│  │                                                 │   │
│  │ ── EXTRAS ────────────────────────────────────  │   │
│  │ ☑ Thumbnail JPG   ☑ Embed Metadata             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [ 00:00 / 00:00 ] ████████████░░░░  67%               │
│                                                         │
│  [  CANCEL  ]              [  DOWNLOAD  ]               │
└─────────────────────────────────────────────────────────┘
```

**Probe button behavior:**
- Calls yt-dlp `--dump-json --skip-download` on the URL
- Returns title, thumbnail preview, duration, available format list
- Populates a mini info card above the options panel
- Disables unavailable resolution tiers (grayed out, not hidden)

**Info card (shown after probe):**
```
┌─ VIDEO INFO ──────────────────────────────────────────┐
│  [THUMB]  Track Title — Artist Name                   │
│           Duration: 3:24  |  Views: 1.2M              │
│           Available: 360p ✓  720p ✓  1080p ✓  4K ✗   │
└───────────────────────────────────────────────────────┘
```

#### Tauri Backend — New Struct

```rust
#[derive(serde::Serialize, serde::Deserialize)]
struct YouTubeDownloadRequest {
    url: String,
    output_dir: String,
    mode: String,              // YT_DOWNLOAD_MODE value
    embed_metadata: bool,
    download_thumbnail: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct YouTubeDownloadResult {
    file: String,
    thumbnail_path: Option<String>,
    title: String,
    duration: u64,
    mode_used: String,
    formats_available: Vec<String>,
}
```

---

## PILLAR 3 — Whisper Transcription Quality

### Problem
Current implementation uses basic FFmpeg presets but doesn't take advantage of several techniques that significantly reduce word error rate (WER):
1. Vocal isolation (separate vocals FROM music before transcribing)
2. Time-stretching for fast speech
3. VAD (Voice Activity Detection) to reduce hallucinations on silence
4. Word-level timestamps
5. Initial prompt hints for domain context (music lyrics vs podcast vs interview)
6. Chunk overlap for long-form content accuracy

### Improvement Pipeline

```
Input Audio
     │
     ▼
[ A. Vocal Isolation ]  →  Run Demucs "vocals" stem if music detected
     │                       (massively reduces hallucination on songs)
     ▼
[ B. VAD Preprocessing ]  →  Silero VAD or WebRTC VAD to strip silence
     │                        Segments silence into non-speech markers
     │                        Reduces Whisper hallucination on quiet gaps
     ▼
[ C. Speed-to-Rate Analysis ]  →  Detect syllables/sec via onset detection
     │                             If rate > 5 syl/sec → apply 0.80x stretch
     ▼
[ D. Time Stretch (if needed) ]  →  rubberband or atempo, pitch-preserved
     │                               16 kHz mono output as Whisper input
     ▼
[ E. Whisper Inference ]  →  word_timestamps=True, beam_size=5, best_of=5
     │                        initial_prompt = mode-specific hint string
     │                        condition_on_previous_text=True
     ▼
[ F. Timestamp Re-alignment ]  →  multiply timestamps by stretch factor
     │
     ▼
[ G. Output ]  →  TXT, SRT, JSON (with word-level timing), VTT
```

#### New Presets Dictionary

```python
PRESETS = {
    "none": {
        "filters": [],
        "description": "Raw input, no preprocessing",
    },
    "clean_speech": {
        "filters": ["highpass=f=80", "lowpass=f=8000", "afftdn=nf=-24",
                    "acompressor=threshold=-20dB:ratio=2:attack=20:release=200"],
        "description": "Office/studio speech — light denoising",
    },
    "podcast_voice": {
        "filters": ["highpass=f=90", "lowpass=f=9000",
                    "equalizer=f=220:width_type=o:width=1.2:g=2",
                    "equalizer=f=3500:width_type=o:width=1.2:g=2",
                    "acompressor=threshold=-18dB:ratio=3:attack=10:release=220",
                    "loudnorm=I=-16:TP=-1.5:LRA=7"],
        "description": "Podcast voice, consistent loudness",
    },
    "noisy_room": {
        "filters": ["highpass=f=100", "lowpass=f=7000",
                    "afftdn=nf=-30", "anlmdn=s=7:p=0.003",
                    "acompressor=threshold=-22dB:ratio=2.5:attack=15:release=250"],
        "description": "Background noise / reverb reduction",
    },
    "phone_call": {
        "filters": ["highpass=f=250", "lowpass=f=3400",
                    "acompressor=threshold=-20dB:ratio=2:attack=8:release=120"],
        "description": "Telephone / VoIP bandwidth",
    },
    # NEW PRESETS:
    "lyric_slow": {
        "filters": ["atempo=0.80", "highpass=f=80", "lowpass=f=10000",
                    "loudnorm=I=-16:TP=-1.5:LRA=9"],
        "stretch_factor": 1.25,   # timestamps multiplied by this after inference
        "description": "Fast-rap / dense lyric — slowed 20% for accuracy",
    },
    "vad_clean": {
        "filters": ["highpass=f=80", "silenceremove=start_periods=1:stop_periods=-1:stop_threshold=-40dB"],
        "description": "VAD-strip silence to reduce hallucination",
    },
    "music_vocal": {
        "requires_vocal_isolate": True,
        "filters": ["highpass=f=80", "loudnorm=I=-16:TP=-1.5:LRA=9"],
        "description": "Run Demucs vocal isolation first, then transcribe",
        "note": "Requires vocal stem separation pass (~2-5 min)"
    },
}
```

#### Word-Level Timestamps — New Output Formats

Enable `word_timestamps=True` in Whisper call:
```python
result = whisper_model.transcribe(
    processed_path,
    task=task,
    language=language if language != "auto" else None,
    word_timestamps=True,
    beam_size=5,
    best_of=5,
    temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # cascade fallback
    condition_on_previous_text=True,
    initial_prompt=INITIAL_PROMPTS.get(prompt_mode, ""),
    verbose=False,
)
```

**New output formats:**
- `.srt` — segment-level (current, kept)
- `.word.srt` — NEW: word-level subtitle file (one word per cue, tight karaoke-style)
- `.vtt` — NEW: WebVTT for browser-compatible usage
- `.json` — enhanced with `words[{word, start, end, probability}]` per segment
- `.txt` — unchanged

#### Mode-Specific Initial Prompts

```python
INITIAL_PROMPTS = {
    "music_lyrics": "Song lyrics with line breaks. Verses, chorus, bridge.",
    "podcast":      "Podcast episode transcript. Speaker turns may be present.",
    "interview":    "Interview transcript. Questions and answers between speakers.",
    "lecture":      "Academic lecture. Technical terminology expected.",
    "meeting":      "Business meeting transcript. Action items and decisions discussed.",
    "default":      "",
}
```

Exposed as a "Content Type" dropdown in the Whisper modal.

#### Speaker Diarization (Optional, Phase 04B)

Requires `pyannote.audio` — heavier dependency. Phase 04B only.
- Identifies speakers (Speaker A, Speaker B...)
- Integrates with word timestamps to assign per-word speaker labels
- SRT/VTT output includes `SPEAKER_00:` prefixes

---

## PILLAR 4 — Format Conversion Utility (Bonus)

A lightweight "Convert Audio" tool available from the main action row:

```
Input: any format
Output options:
  - WAV 32-bit float
  - WAV 16-bit PCM
  - FLAC
  - MP3 (128/192/256/320 kbps)
  - AAC/M4A
  - OGG Vorbis

Sample rate options: 44.1 kHz | 48 kHz | 96 kHz

Channel options: Keep original | Stereo | Mono

Loudness normalization: Off | -16 LUFS | -23 LUFS (broadcast)
```

Lives in `scripts/convert_audio.py` — thin wrapper around FFmpeg.

---

## Implementation Roadmap

### Phase 04A (Core Quality — 1-2 days)

| Task | File(s) | Priority |
|------|---------|----------|
| `pre_split_processor.py` — WAV conversion + loudness norm | `scripts/pre_split_processor.py` | 🔴 HIGH |
| Tauri command `preprocess_audio_for_split` | `src-tauri/src/main.rs` | 🔴 HIGH |
| Config modal "Pre-Split Quality" toggle section | `ReactorZone.tsx` | 🔴 HIGH |
| tauri-bridge.ts wrapper for new command | `src/lib/tauri-bridge.ts` | 🔴 HIGH |
| Whisper: `lyric_slow` + `vad_clean` presets | `scripts/whisper_transcribe.py` | 🟡 MED |
| Whisper: word-level timestamps + VTT output | `scripts/whisper_transcribe.py` | 🟡 MED |
| Whisper: initial_prompt Content Type dropdown | `ReactorZone.tsx` | 🟡 MED |

### Phase 04B (YouTube Expansion — 2-3 days)

| Task | File(s) | Priority |
|------|---------|----------|
| `youtube_dl.py` rewrite with mode system | `scripts/youtube_dl.py` | 🔴 HIGH |
| Tauri: `YouTubeDownloadRequest` struct update | `src-tauri/src/main.rs` | 🔴 HIGH |
| YouTube Modal: probe + format picker UI | `ReactorZone.tsx` | 🔴 HIGH |
| tauri-bridge.ts: probe + download signatures | `src/lib/tauri-bridge.ts` | 🔴 HIGH |
| Thumbnail rendering in info card | `ReactorZone.tsx` | 🟡 MED |
| Format availability graying from probe result | `ReactorZone.tsx` | 🟡 MED |
| MP4 merge with FFmpeg postprocessor | `scripts/youtube_dl.py` | 🔴 HIGH |

### Phase 04C (Vocal Isolation for Whisper — 1 day)

| Task | File(s) | Priority |
|------|---------|----------|
| `music_vocal` preset: run Demucs vocals stem | `scripts/whisper_transcribe.py` | 🟡 MED |
| Whisper modal: Content Type dropdown | `ReactorZone.tsx` | 🟡 MED |
| Speaker diarization scaffolding (pyannote) | `scripts/whisper_transcribe.py` | 🔵 LOW |

---

## Dependency Additions

```
# requirements.txt additions
yt-dlp                 # already present
openai-whisper         # already present
rubberband-audio       # pitch-preserved time stretch (optional, fallback: atempo)
pyannote.audio         # speaker diarization (Phase 04C, optional)
```

```powershell
# setup_embedded_python.ps1 — add to OPTIONAL_IMPORTS
"rubberband"           # optional, time stretch
```

---

## Quality Metrics Targets

| Metric | Baseline (v0.4.0) | Phase 04A Target |
|--------|------------------|-----------------|
| Stem bleed (cymbals) | Moderate | 30-50% reduction via WAV pre-conv |
| Whisper WER on music | ~35% | <20% via vocal isolation + lyric_slow |
| Whisper WER on podcast | ~12% | <8% via VAD + podcast preset |
| YouTube download modes | 1 (MP3 320) | 12 modes across audio/video/thumbnail |
| Transcript output formats | 3 (TXT/SRT/JSON) | 5 (+ VTT + word.srt) |
| Time-to-first-transcription on fast speech | baseline | -20 to -35% with stretch trick |

---

## Risk / Mitigation

| Risk | Mitigation |
|------|-----------|
| WAV pre-processing adds 5-15s latency | Show progress in HUD, skip for already-WAV inputs |
| MP4 video downloads require FFmpeg merge | FFmpeg already bundled in app, use merge_output_format=mp4 |
| 4K not available on all videos | Probe-first flow grays out unavailable resolutions |
| rubberband not in embedded Python path | Graceful fallback to atempo filter (FFmpeg built-in) |
| Whisper vocal isolation doubles run time | User-opt-in only, clearly labeled in UI |
| pyannote.audio large model (~300MB) | Phase 04C only, lazy-download on first use |

---

## Files to Create/Modify

```
CREATE:
  scripts/pre_split_processor.py     ← WAV conversion, loudness norm, HPSS
  scripts/convert_audio.py           ← General format converter utility

MODIFY:
  scripts/youtube_dl.py              ← Add mode system, MP4, WAV, FLAC, thumbnail
  scripts/whisper_transcribe.py      ← Add lyric_slow/vad_clean/music_vocal presets,
                                        word timestamps, VTT output, initial_prompt
  src-tauri/src/main.rs              ← Add preprocess_audio_for_split command,
                                        update YouTubeDownloadRequest struct
  src/lib/tauri-bridge.ts            ← Add probe + new download signatures,
                                        preprocess command wrapper
  src/components/ReactorZone.tsx     ← YouTube modal redesign with format picker,
                                        Config modal pre-split toggles,
                                        Whisper modal content-type dropdown
  requirements.txt                   ← rubberband-audio (optional), pyannote (Phase 04C)
  setup_embedded_python.ps1          ← OPTIONAL_IMPORTS update
```

---

## Quick-Win Priority Order

If only doing one thing first, the highest ROI is:

> **Convert to WAV before splitting** — implemented in ~2 hours, zero UI change needed (auto-applied), measurably reduces artifact bleed on compressed inputs (MP3/AAC sources).

Second best:

> **YouTube multi-format modal** — high user-visible value, leverages existing yt-dlp infrastructure.

Third:

> **Whisper `lyric_slow` preset + word timestamps** — 0 new dependencies, pure FFmpeg + Whisper API changes.

---

*StemSplit Phase 04 — drafted April 4, 2026*
