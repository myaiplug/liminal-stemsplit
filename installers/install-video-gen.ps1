<#
.SYNOPSIS
  Install Stable Video Diffusion + AnimateDiff for ComfyUI — text-to-video and image animation.
#>

$ErrorActionPreference = "Stop"
$ComfyDir = "D:\ComfyUI"
$ModelsDir = "D:\Models"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. AnimateDiff custom nodes for ComfyUI ──
$customDir = Join-Path $ComfyDir "custom_nodes"
$null = New-Item -ItemType Directory -Path $customDir -Force

$nodes = @(
  @{ Name = "ComfyUI-AnimateDiff-Evolved"; Url = "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved" }
  @{ Name = "ComfyUI-VideoHelperSuite"; Url = "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite" }
  @{ Name = "ComfyUI-Frame-Interpolation"; Url = "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation" }
)

foreach ($n in $nodes) {
  $nodePath = Join-Path $customDir $n.Name
  if (Test-Path $nodePath) {
    Status "Already installed: $($n.Name)"
  } else {
    Status "Installing $($n.Name)..."
    git clone $n.Url $nodePath --depth 1 2>&1 | Out-Null
  }
}

# ── 2. Motion modules (AnimateDiff models) ──
$motionDir = Join-Path $ComfyDir "custom_nodes\ComfyUI-AnimateDiff-Evolved\models"
$null = New-Item -ItemType Directory -Path $motionDir -Force

$motionModels = @(
  @{ Name = "mm_sd_v15_v2.ckpt"; Url = "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt" }
  @{ Name = "mm_sdxl_v10_beta.ckpt"; Url = "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sdxl_v10_beta.ckpt" }
)

foreach ($m in $motionModels) {
  $outPath = Join-Path $motionDir $m.Name
  if (Test-Path $outPath) {
    Status "Motion module cached: $($m.Name)"
  } else {
    Status "Downloading $($m.Name)..."
    try {
      Invoke-WebRequest -Uri $m.Url -OutFile $outPath -UseBasicParsing -TimeoutSec 300
      Status "  Downloaded: $($m.Name)"
    } catch { Write-Host "  ⚠ Failed: $($m.Name) — $_" -ForegroundColor Yellow }
  }
}

# ── 3. Stable Video Diffusion ──
$svdDir = Join-Path $ComfyDir "models\checkpoints"
$null = New-Item -ItemType Directory -Path $svdDir -Force

$svdModels = @(
  @{ Name = "svd.safetensors"; Url = "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid/resolve/main/svd.safetensors" }
  @{ Name = "svd_xt.safetensors"; Url = "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt/resolve/main/svd_xt.safetensors" }
)

foreach ($m in $svdModels) {
  $outPath = Join-Path $svdDir $m.Name
  if (Test-Path $outPath) {
    Status "SVD model cached: $($m.Name)"
  } else {
    Status "Downloading $($m.Name) (large file ~2GB)..."
    try {
      Invoke-WebRequest -Uri $m.Url -OutFile $outPath -UseBasicParsing -TimeoutSec 1800
      Status "  Downloaded: $($m.Name)"
    } catch { Write-Host "  ⚠ Failed: $($m.Name) — $_" -ForegroundColor Yellow }
  }
}

Write-Host "`n  ✓ Video Generation ready" -ForegroundColor Green
Write-Host "  → Launch ComfyUI, load AnimateDiff workflows from ComfyUI-Manager" -ForegroundColor DarkGray
