<#
.SYNOPSIS
  Install AceStep v1.5 — Beat Generation (music generation with vocals).
#>

$ErrorActionPreference = "Stop"
$TargetDir = "D:\ACESTEP\ace-step-1.5"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

$installed = (Test-Path (Join-Path $TargetDir "start_api_server.bat"))
if ($installed) {
  Status "AceStep v1.5 already present at $TargetDir"
  # check for model weights
  $modelDir = "D:\Models\ace-step-v1.5"
  if (-not (Test-Path $modelDir)) {
    Status "Model weights missing — download from HuggingFace..."
    $null = New-Item -ItemType Directory -Path $modelDir -Force
    # try huggingface hub download
    pip install huggingface-hub --quiet 2>&1 | Out-Null
    python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='pzharrington/ace-step-v1.5', local_dir=r'$modelDir')" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Status "Model weights downloaded to $modelDir" } else { Write-Host "  ⚠ Model download failed — download manually from huggingface.co/pzharrington/ace-step-v1.5" -ForegroundColor Yellow }
  } else {
    Status "Model weights found at $modelDir"
  }
  Write-Host "  ✓ AceStep ready" -ForegroundColor Green
  return
}

Status "Cloning AceStep v1.5..."
$null = New-Item -ItemType Directory -Path "D:\ACESTEP" -Force
git clone "https://github.com/pzharrington/ace-step" $TargetDir 2>&1 | Out-Null
if (-not (Test-Path $TargetDir)) {
  # fallback: use local copy
  $localCopy = "D:\ACESTEP\ace-step-ACE-Step-1.5-cb49cb9"
  if (Test-Path $localCopy) {
    Status "Using local copy from $localCopy"
    Copy-Item -Path "$localCopy\*" -Destination $TargetDir -Recurse -Force
  }
}

if (Test-Path $TargetDir) {
  Status "Installing AceStep Python dependencies..."
  pip install -r (Join-Path $TargetDir "requirements.txt") --quiet 2>&1 | Out-Null
  Write-Host "  ✓ AceStep v1.5 installed at $TargetDir" -ForegroundColor Green
  Write-Host "  → Start: $TargetDir\start_api_server.bat" -ForegroundColor DarkGray
} else {
  Write-Host "  ⚠ AceStep clone failed. Manual: git clone https://github.com/pzharrington/ace-step D:\ACESTEP\ace-step-1.5" -ForegroundColor Yellow
}
