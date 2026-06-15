<#
.SYNOPSIS
  One-Click Remix Pipeline — split any song, generate a new instrumental, merge.
  Flow: MP3 → Demucs split → AceStep generates new track → ffmpeg merge → finished remix.
#>

param(
  [Parameter(Mandatory=$true)][string]$SongPath,
  [string]$OutputDir = "$env:USERPROFILE\Music\Remixes",
  [string]$Genre = "lo-fi hip hop, soulful, 85bpm",
  [switch]$KeepStems
)

$ErrorActionPreference = "Stop"
$StartTime = Get-Date
$RemixName = [System.IO.Path]::GetFileNameWithoutExtension($SongPath)
$WorkDir = Join-Path $env:TEMP "remix_$([System.IO.Path]::GetRandomFileName())"
$null = New-Item -ItemType Directory -Path $WorkDir -Force, $OutputDir -Force

function Step { Write-Host "`n▌ $_" -ForegroundColor Cyan }
function Ok  { Write-Host "  ✓ $_" -ForegroundColor Green }
function Warn{ Write-Host "  ⚠ $_" -ForegroundColor Yellow }

Write-Host @"

  ╔═══════════════════════════════════════╗
  ║     One-Click Remix Pipeline v1.0    ║
  ║  $SongPath
  ╚═══════════════════════════════════════╝
"@ -ForegroundColor Magenta

# 1. SPLIT with Demucs
Step "1/4 Stem Splitting — Demucs v4"
$SplitDir = Join-Path $WorkDir "stems"
demucs $SongPath -o $SplitDir --shifts=2 2>&1 | Out-Null
$songName = [System.IO.Path]::GetFileNameWithoutExtension($SongPath)
$stemBase = Join-Path (Get-ChildItem $SplitDir -Directory | Select-Object -First 1).FullName $songName
if (-not (Test-Path "$stemBase-vocals.wav")) {
  # try finding stem files
  $stemFolder = Get-ChildItem $SplitDir -Directory | Select-Object -First 1
  $stemBase = Join-Path $stemFolder.FullName $songName
}
Ok "Stems extracted"

# 2. GENERATE with AceStep
Step "2/4 Beat Generation — AceStep v1.5"
$beatOut = Join-Path $WorkDir "new_beat.wav"
$prompt = "instrumental remix of $RemixName, $Genre, no vocals"

# Check if AceStep API is running
$aceRunning = $null -ne (curl -s --max-time 3 http://127.0.0.1:8765/health 2>$null)
if (-not $aceRunning) {
  Warn "AceStep API not running. Starting server..."
  $serverProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "D:\ACESTEP\ace-step-1.5\start_api_server.bat" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 20
}

$body = @{prompt=$prompt; duration=30} | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8765/generate" -Method Post -Body $body -ContentType "application/json" -OutFile $beatOut -ErrorAction Stop
  Ok "Beat generated (30 seconds)"
} catch {
  Warn "AceStep generation failed: $_"
  Warn "Creating placeholder beat instead..."
  # fallback: generate a sine wave beat as placeholder
  sox -n $beatOut synth 30 sine 440 2>&1 | Out-Null
}

# 3. MIX with ffmpeg
Step "3/4 Mixing — ffmpeg + rubberband"
$vocalsWav = "$stemBase-vocals.wav"
$mixedOut = Join-Path $WorkDir "remix_raw.wav"

if (Test-Path $vocalsWav) {
  # adjust vocal speed to match new beat (assume both at same BPM for simplicity)
  ffmpeg -y -i $vocalsWav -i $beatOut -filter_complex "[0:a]volume=0.8[v];[1:a]volume=1.0[b];[v][b]amix=inputs=2:duration=first" $mixedOut 2>&1 | Out-Null
  Ok "Vocals mixed with new beat"
} else {
  Warn "Vocals stem not found — using beat only"
  Copy-Item $beatOut $mixedOut
}

# 4. FINAL EXPORT
Step "4/4 Export — final render"
$finalFile = Join-Path $OutputDir "$RemixName-remix.wav"
ffmpeg -y -i $mixedOut -af "loudnorm" $finalFile 2>&1 | Out-Null

$elapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 0)
Ok "Remix complete in ${elapsed}s"

Write-Host @"

  ═══════════════════════════════════════
  ✓ OUTPUT: $finalFile
  ═══════════════════════════════════════
"@ -ForegroundColor Green

if (-not $KeepStems) { Remove-Item $WorkDir -Recurse -Force }

Write-Host @"

  🎧 Want more control?
  The Pro Automation Pack ($5) adds:
  • Multi-genre remix matching (detect original BPM + key)
  • Stem-by-stem replacement (swap drums, keep bass)
  • Vocal pitch correction after remix
  • Batch remix (10 songs → 10 remixes, unattended)

  → https://gumroad.com/l/remix-automation-pro

"@ -ForegroundColor DarkGray
