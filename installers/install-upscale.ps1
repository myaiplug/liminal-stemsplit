<#
.SYNOPSIS
  Install Real-ESRGAN + GFPGAN + CodeFormer — image upscaling and face restoration.
#>

$ErrorActionPreference = "Stop"
$ComfyDir = "D:\ComfyUI"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. Real-ESRGAN (standalone + ComfyUI node) ──
$esrganCheck = pip show realesrgan 2>$null
if ($esrganCheck) {
  Status "Real-ESRGAN already installed"
} else {
  Status "Installing Real-ESRGAN..."
  pip install realesrgan --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  Real-ESRGAN installed" }
}

# download ESRGAN models
$esrDir = Join-Path $ComfyDir "models\upscale_models"
$null = New-Item -ItemType Directory -Path $esrDir -Force
$esrModels = @(
  @{ Name = "RealESRGAN_x4plus.pth"; Url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" }
  @{ Name = "RealESRGAN_x4plus_anime_6B.pth"; Url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth" }
)
foreach ($m in $esrModels) {
  $out = Join-Path $esrDir $m.Name
  if (Test-Path $out) { Status "ESRGAN model cached: $($m.Name)" } else {
    Status "Downloading $($m.Name)..."
    try { Invoke-WebRequest -Uri $m.Url -OutFile $out -UseBasicParsing -TimeoutSec 300 } catch { Write-Host "  ⚠ Failed" -ForegroundColor Yellow }
  }
}

# ── 2. GFPGAN (face restoration) ──
$gfpganCheck = pip show gfpgan 2>$null
if ($gfpganCheck) {
  Status "GFPGAN already installed"
} else {
  Status "Installing GFPGAN..."
  pip install gfpgan --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  GFPGAN installed" }
}

$gfpDir = Join-Path $ComfyDir "models\face_restore"
$null = New-Item -ItemType Directory -Path $gfpDir -Force
$gfpModels = @(
  @{ Name = "GFPGANv1.4.pth"; Url = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth" }
  @{ Name = "GFPGANv1.3.pth"; Url = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth" }
)
foreach ($m in $gfpModels) {
  $out = Join-Path $gfpDir $m.Name
  if (Test-Path $out) { Status "GFPGAN model cached: $($m.Name)" } else {
    Status "Downloading $($m.Name)..."
    try { Invoke-WebRequest -Uri $m.Url -OutFile $out -UseBasicParsing -TimeoutSec 300 } catch { Write-Host "  ⚠ Failed" -ForegroundColor Yellow }
  }
}

# ── 3. CodeFormer (face restore alternative) ──
$codeformerCheck = pip show codeformer 2>$null
if ($codeformerCheck) {
  Status "CodeFormer already installed"
} else {
  Status "Installing CodeFormer..."
  pip install codeformer --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  CodeFormer installed" }
}

# CodeFormer model
$cfDir = Join-Path $ComfyDir "models\codeformer"
$null = New-Item -ItemType Directory -Path $cfDir -Force
$cfModel = Join-Path $cfDir "codeformer.pth"
if (-not (Test-Path $cfModel)) {
  Status "Downloading CodeFormer model..."
  $url = "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth"
  try { Invoke-WebRequest -Uri $url -OutFile $cfModel -UseBasicParsing -TimeoutSec 300 } catch { Write-Host "  ⚠ Failed" -ForegroundColor Yellow }
}

# ── 4. ComfyUI nodes for upscale/restore ──
$customDir = Join-Path $ComfyDir "custom_nodes"
$null = New-Item -ItemType Directory -Path $customDir -Force
$nodes = @(
  "https://github.com/Gourieff/comfyui-reactor-node",
  "https://github.com/pythongosssss/ComfyUI-Custom-Scripts"
)
foreach ($repo in $nodes) {
  $name = Split-Path $repo -Leaf
  $nodePath = Join-Path $customDir $name
  if (-not (Test-Path $nodePath)) {
    Status "Installing $name..."
    git clone $repo $nodePath --depth 1 2>&1 | Out-Null
  }
}

Write-Host "`n  ✓ Upscaling & Restoration ready" -ForegroundColor Green
Write-Host "  → CLI: realesrgan -i input.jpg -o output.png -s 4" -ForegroundColor DarkGray
