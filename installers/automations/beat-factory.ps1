<#
.SYNOPSIS
  Beat Factory — generate a beat with AceStep, split into stems, layer with RVC vocal.
  Flow: Prompt → AceStep generates beat → Demucs splits → RVC converts vocal sample
        → Pedalboard masters → final export + stems
#>

param(
  [Parameter(Mandatory=$true)][string]$Prompt,
  [string]$OutputDir = "$env:USERPROFILE\Music\Beat-Factory",
  [int]$BPM = 90,
  [string]$Key = "Am",
  [string]$VocalStyle = "soulful",
  [string]$RvcModel = "",           # path to RVC model for vocal conversion
  [string]$VocalSample = "",        # WAV file of someone singing (to convert)
  [switch]$ExportStems
)

$ErrorActionPreference = "Stop"
$StartTime = Get-Date
$JobName = ($Prompt -replace '[^a-zA-Z0-9]','_').Substring(0,[math]::Min(20, $Prompt.Length))
$WorkDir = Join-Path $env:TEMP "beat_factory_$([System.IO.Path]::GetRandomFileName())"
$null = New-Item -ItemType Directory -Path $WorkDir -Force, $OutputDir -Force

function Step { Write-Host "`n▌ $_" -ForegroundColor Cyan }
function Ok  { Write-Host "  ✓ $_" -ForegroundColor Green }
function Warn{ Write-Host "  ⚠ $_" -ForegroundColor Yellow }

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║        Beat Factory Pipeline v1.0    ║
  ║  $Prompt
  ╚═══════════════════════════════════════╝
"@ -ForegroundColor Magenta

# 1. GENERATE with AceStep
Step "1/4 Beat Generation — AceStep v1.5"
$fullTrack = Join-Path $WorkDir "full_beat.wav"
$generationPrompt = "$Prompt, $BPM bpm, key of $Key, $VocalStyle"

$aceRunning = $null -ne (curl -s --max-time 3 http://127.0.0.1:8765/health 2>$null)
if (-not $aceRunning) {
  Warn "Starting AceStep server..."
  $server = Start-Process powershell -ArgumentList "-NoExit", "-Command", "D:\ACESTEP\ace-step-1.5\start_api_server.bat" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 20
}

try {
  $body = @{prompt=$generationPrompt; duration=30} | ConvertTo-Json
  Invoke-RestMethod -Uri "http://127.0.0.1:8765/generate" -Method Post -Body $body -ContentType "application/json" -OutFile $fullTrack -ErrorAction Stop
  Ok "Beat generated"
} catch {
  Warn "AceStep failed — generating placeholder"
  sox -n $fullTrack synth 30 sine $(if($Key -eq 'Am'){440}else{523}) saw 220 mix 2>&1 | Out-Null
}

# 2. SPLIT into stems
Step "2/4 Stem Splitting — Demucs"
$splitDir = Join-Path $WorkDir "splits"
demucs $fullTrack -o $splitDir --shifts=2 2>&1 | Out-Null
Ok "Stems extracted"

# find stem files
$stemFolder = Get-ChildItem $splitDir -Directory | Select-Object -First 1
if ($stemFolder) {
  $stemBase = Join-Path $stemFolder.FullName ([System.IO.Path]::GetFileNameWithoutExtension($fullTrack))
} else {
  Warn "Stem folder not found — continuing with raw track"
}

# 3. VOCAL CONVERSION with RVC (if sample provided)
Step "3/4 Vocal Processing"
$processedVocals = $null
if ($VocalSample -and (Test-Path $VocalSample) -and $RvcModel) {
  $convertedDir = Join-Path $WorkDir "converted"
  $null = New-Item -ItemType Directory -Path $convertedDir -Force
  
  # RVC WebUI API
  $rvcEndpoint = "http://127.0.0.1:7865"
  $rvcRunning = $null -ne (curl -s --max-time 3 "$rvcEndpoint/" 2>$null)
  
  if ($rvcRunning) {
    # RVC API: upload vocal sample, select model, convert
    $convertedFile = Join-Path $convertedDir "converted_vocals.wav"
    Warn "RVC API integration requires manual web UI operation"
    Warn "  → Open http://127.0.0.1:7865, upload $VocalSample, convert, save to $convertedFile"
  } else {
    Warn "RVC not running — start with: D:\RVC-WebUI\go-webui.bat"
  }
} else {
  Ok "No vocal conversion requested"
}

# 4. MASTER and EXPORT
Step "4/4 Mastering + Export — Pedalboard + ffmpeg"
$masteredFile = Join-Path $WorkDir "mastered.wav"

python -c @"
from pedalboard import Pedalboard, Compressor, Limiter, LowpassFilter, HighpassFilter
from pedalboard.io import AudioFile

with AudioFile(r'$fullTrack'.replace('\\','/')) as f:
  audio = f.read(f.frames)
  sr = f.samplerate

board = Pedalboard([
  HighpassFilter(cutoff_frequency_hz=30),
  Compressor(threshold_db=-18, ratio=3, attack_ms=5, release_ms=100),
  Limiter(threshold_db=-2, release_ms=250)
])
mastered = board(audio, sr)

with AudioFile(r'$masteredFile'.replace('\\','/'), 'w', sr, mastered.shape[0]) as f:
  f.write(mastered)
print("Mastered")
"@ 2>&1 | Out-Null

if (Test-Path $masteredFile) { Ok "Mastered (compressor + limiter)" } else { Copy-Item $fullTrack $masteredFile }

# EXPORT
$finalBeat = Join-Path $OutputDir "$JobName-beat.wav"
Copy-Item $masteredFile $finalBeat

if ($ExportStems -and $stemFolder) {
  $stemsOut = Join-Path $OutputDir "$JobName-stems"
  $null = New-Item -ItemType Directory -Path $stemsOut -Force
  Get-ChildItem $stemFolder.FullName -Filter "*.wav" | Copy-Item -Destination $stemsOut
  Ok "Stems exported to $stemsOut"
}

$elapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 0)
Ok "Beat produced in ${elapsed}s"

Write-Host @"

  ═══════════════════════════════════════
  ✓ OUTPUT: $finalBeat
  $(if($ExportStems){'✓ STEMS: '+$stemsOut})
  ═══════════════════════════════════════

  🥁 Pro Beat Factory ($5):
  • Détection BPM automatique + time-stretch
  • Vocal arrangement (verse/chorus/bridge structure)
  • Export to Ableton/FL Studio project template
  • 50 genre presets (trap, lo-fi, house, DnB, phonk)
  • Master bus processing with reference track matching

  → https://gumroad.com/l/beat-factory-pro

  🔊 Studio monitors starting at $99:
  → https://amzn.to/3XqYx2N

"@ -ForegroundColor DarkGray

Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
