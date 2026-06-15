&lt;#
.SYNOPSIS
  Install ffmpeg, sox, librosa, pedalboard, rubberband, soundfile
#&gt;

$ErrorActionPreference = "Stop"
$Base = "D:\AI-Tools"
$null = New-Item -ItemType Directory -Path $Base -Force

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. ffmpeg (latest master build) ──
$ffDir = Join-Path $Base "ffmpeg"
$ffBin = Join-Path $ffDir "bin\ffmpeg.exe"
if (-not (Test-Path $ffBin)) {
  Status "Downloading ffmpeg (latest master build)..."
  Remove-Item -Path $ffDir -Recurse -ErrorAction SilentlyContinue
  $url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
  $zip = Join-Path $env:TEMP "ffmpeg.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Base -Force
  Get-ChildItem "$Base\ffmpeg-*-essentials-build" | Rename-Item -NewName "ffmpeg"
  Remove-Item $zip -Force
  # add to PATH
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$ffDir\bin*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$ffDir\bin", "User")
  }
  Status "ffmpeg installed to $ffDir"
} else { Status "ffmpeg already present" }

# add to current session PATH
$env:Path = "$env:Path;$ffBin"

# ── 2. sox (latest) ──
$soxDir = Join-Path $Base "sox"
$soxBin = Join-Path $soxDir "sox.exe"
if (-not (Test-Path $soxBin)) {
  Status "Downloading SoX (latest)..."
  Remove-Item -Path $soxDir -Recurse -ErrorAction SilentlyContinue
  $url = "https://sourceforge.net/projects/sox/files/latest/download"
  $zip = Join-Path $env:TEMP "sox.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Base -Force
  Get-ChildItem "$Base\sox-*" | Rename-Item -NewName "sox" -ErrorAction SilentlyContinue
  Remove-Item $zip -Force
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$soxDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$soxDir", "User")
  }
  Status "SoX installed to $soxDir"
} else { Status "SoX already present" }
$env:Path = "$env:Path;$soxDir"

# ── 3. Python audio packages ──
$pipPkgs = @(
  "librosa",
  "soundfile",
  "pedalboard",
  "pyrubberband",
  "audioread",
  "pydub"
)
Status "Installing Python audio packages..."
foreach ($pkg in $pipPkgs) {
  $ver = (pip show $pkg 2>$null | Select-String "Version:" | ForEach-Object { $_ -replace '.*Version:\s*','' })
  if ($ver) {
    Status "  $pkg $ver already installed"
  } else {
    pip install $pkg --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Status "  $pkg installed" } else { Write-Host "  ⚠ $pkg failed" -ForegroundColor Yellow }
  }
}

Write-Host "  ✓ Audio tools ready" -ForegroundColor Green
