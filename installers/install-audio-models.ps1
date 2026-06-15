<#
.SYNOPSIS
  Install Stem Splitter (Demucs), Transcription (Whisper), TTS (XTTSv2, Kokoro), MelBand Roformer.
#>

$ErrorActionPreference = "Stop"
$ModelsDir = "D:\Models"
$null = New-Item -ItemType Directory -Path $ModelsDir -Force

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. Demucs v4 (HTDemucs) ──
$demucsCheck = pip show demucs 2>$null
if ($demucsCheck) {
  Status "Demucs already installed"
} else {
  Status "Installing Demucs v4..."
  pip install demucs --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  Demucs installed — run: demucs song.mp3"
  } else {
    Write-Host "  ⚠ Demucs install failed" -ForegroundColor Yellow
  }
}

# ── 2. Whisper (openai-whisper) ──
$whisperCheck = pip show openai-whisper 2>$null
if ($whisperCheck) {
  Status "Whisper already installed"
} else {
  Status "Installing Whisper (latest)..."
  pip install openai-whisper --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  Whisper installed"
  }
}

# pull large-v3 model
$whisperModelDir = "$env:USERPROFILE\.cache\whisper"
if (-not (Test-Path (Join-Path $whisperModelDir "large-v3.pt"))) {
  Status "Downloading Whisper large-v3 model..."
  python -c "import whisper; whisper.load_model('large-v3')" 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  Whisper large-v3 cached" }
}

# ── 3. XTTSv2 ──
$xttsCheck = pip show TTS 2>$null
if ($xttsCheck) {
  Status "XTTSv2 (TTS) already installed"
} else {
  Status "Installing XTTSv2..."
  pip install TTS --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  XTTSv2 installed"
    Status "  Pre-downloading XTTSv2 model..."
    python -c "from TTS.api import TTS; TTS(model_name='tts_models/multilingual/multi-dataset/xtts_v2')" 2>&1 | Out-Null
  }
}

# ── 4. Kokoro TTS ──
$kokoroCheck = pip show kokoro 2>$null
if ($kokoroCheck) {
  Status "Kokoro TTS already installed"
} else {
  Status "Installing Kokoro TTS..."
  pip install kokoro --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  Kokoro installed" }
}

# ── 5. MelBand Roformer ──
$roformerDir = Join-Path $ModelsDir "MelBandRoformer"
if (-not (Test-Path (Join-Path $roformerDir "MelBandRoformer.ckpt"))) {
  Status "Downloading MelBand Roformer (best vocal separation)..."
  $null = New-Item -ItemType Directory -Path $roformerDir -Force
  $url = "https://github.com/Anjok07/aufr33/releases/download/v1.0.0/MelBandRoformer.ckpt"
  $out = Join-Path $roformerDir "MelBandRoformer.ckpt"
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 120
    Status "  MelBand Roformer downloaded"
  } catch {
    Write-Host "  ⚠ MelBand Roformer download failed. Manual: $url → $out" -ForegroundColor Yellow
  }
} else {
  Status "MelBand Roformer already cached"
}

# ── 6. AudioSep ──
$audioSepDir = Join-Path $ModelsDir "AudioSep"
if (-not (Test-Path $audioSepDir)) {
  Status "Setting up AudioSep..."
  $null = New-Item -ItemType Directory -Path $audioSepDir -Force
  git clone "https://github.com/AudioSep/AudioSep" "$audioSepDir\temp" --depth 1 2>&1 | Out-Null
  if (Test-Path "$audioSepDir\temp") {
    Copy-Item -Path "$audioSepDir\temp\*" -Destination $audioSepDir -Recurse -Force
    Remove-Item "$audioSepDir\temp" -Recurse -Force
    pip install -r (Join-Path $audioSepDir "requirements.txt") --quiet 2>&1 | Out-Null
    Status "  AudioSep installed"
  }
} else {
  Status "AudioSep already present"
}

Write-Host "`n  ✓ Audio ML models ready" -ForegroundColor Green
Write-Host "  → Demucs: demucs song.mp3" -ForegroundColor DarkGray
Write-Host "  → Whisper: whisper audio.mp3 --model large-v3" -ForegroundColor DarkGray
Write-Host "  → XTTSv2: tts-server --model_name tts_models/multilingual/multi-dataset/xtts_v2" -ForegroundColor DarkGray
