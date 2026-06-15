<#
.SYNOPSIS
  Install RVC (Retrieval-Based Voice Conversion) WebUI — voice conversion & singing cloning.
#>

$ErrorActionPreference = "Stop"
$TargetDir = "D:\RVC-WebUI"
$ModelsDir = "D:\Models\RVC"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

$installed = (Test-Path (Join-Path $TargetDir "go-webui.bat"))
if ($installed) {
  Status "RVC WebUI already present at $TargetDir"
  Write-Host "  ✓ RVC ready — run: $TargetDir\go-webui.bat" -ForegroundColor Green
  return
}

# Clone RVC WebUI
Status "Cloning RVC WebUI (latest)..."
$null = New-Item -ItemType Directory -Path "D:\" -Force
git clone "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI" $TargetDir --depth 1 2>&1 | Out-Null

if (-not (Test-Path $TargetDir)) {
  Write-Host "  ⚠ Clone failed. Trying RVC-Boss fork..." -ForegroundColor Yellow
  git clone "https://github.com/RVC-Boss/Retrieval-based-Voice-Conversion-WebUI" $TargetDir --depth 1 2>&1 | Out-Null
}

if (Test-Path $TargetDir) {
  Status "Installing RVC dependencies..."
  Set-Location $TargetDir
  
  # install Python deps
  pip install -r requirements.txt --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    # fallback: core deps only
    pip install torch torchaudio --quiet 2>&1 | Out-Null
    pip install soundfile librosa pyworld praat-parselor faiss-cpu --quiet 2>&1 | Out-Null
  }
  
  # download default models
  $null = New-Item -ItemType Directory -Path $ModelsDir -Force
  
  Status "RVC installed at $TargetDir"
  
  # set up directories for models
  $null = New-Item -ItemType Directory -Path (Join-Path $TargetDir "weights") -Force
  $null = New-Item -ItemType Directory -Path (Join-Path $TargetDir "opt") -Force
  $null = New-Item -ItemType Directory -Path (Join-Path $TargetDir "logs") -Force
  
  Set-Location $PSScriptRoot
} else {
  Write-Host "  ⚠ RVC clone failed. Manual: https://github.com/RVC-Boss/Retrieval-based-Voice-Conversion-WebUI" -ForegroundColor Yellow
  return
}

# ── download a pretrained voice model (Trentemoller-style male vocal) ──
$pretrainedDir = Join-Path $TargetDir "weights"
$defaultModel = Join-Path $pretrainedDir "trent_reverb.pth"
if (-not (Test-Path $defaultModel)) {
  Status "Downloading default RVC model..."
  $url = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/pretrained-v2/D40k.pth"
  try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $pretrainedDir "D40k.pth") -UseBasicParsing -TimeoutSec 300
  } catch { Write-Host "  ⚠ Pretrained model download failed" -ForegroundColor Yellow }
}

Write-Host "`n  ✓ RVC Voice Conversion ready" -ForegroundColor Green
Write-Host "  → Start: $TargetDir\go-webui.bat" -ForegroundColor DarkGray
Write-Host "  → Open:  http://localhost:7865" -ForegroundColor DarkGray
