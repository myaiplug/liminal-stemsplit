<#
.SYNOPSIS
  Install ComfyUI portable + SDXL + FLUX — Image Generation.
#>

$ErrorActionPreference = "Stop"
$Target = "D:\ComfyUI"
$PortableUrl = "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu12_or_cpu.7z"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

$installed = (Test-Path (Join-Path $Target "main.py"))
if ($installed) {
  Status "ComfyUI already present at $Target"
} else {
  Status "Downloading ComfyUI portable (latest)..."
  Remove-Item -Path $Target -Recurse -ErrorAction SilentlyContinue
  $zip = Join-Path $env:TEMP "comfyui.7z"
  Invoke-WebRequest -Uri $PortableUrl -OutFile $zip -UseBasicParsing
  Status "Extracting (this may take a minute)..."
  & "7z" x $zip "-o$Target" -y 2>&1 | Out-Null
  Remove-Item $zip -Force
  Status "ComfyUI installed to $Target"
}

# ── models ──
$modelsDir = Join-Path $Target "models"
$ckptDir = Join-Path $modelsDir "checkpoints"
$unetDir = Join-Path $modelsDir "unet"
$clipDir = Join-Path $modelsDir "clip"
$vaeDir = Join-Path $modelsDir "vae"
$null = New-Item -ItemType Directory -Path $ckptDir -Force, $unetDir -Force, $clipDir -Force, $vaeDir -Force

# check CUDA / prefer GPU runner
$gpuScript = Join-Path $Target "run_nvidia_gpu.bat"
$cpuScript = Join-Path $Target "run_cpu.bat"
if (Test-Path $gpuScript) {
  Status "GPU runner script found"
} elseif (Test-Path $cpuScript) {
  Status "CPU-only runner — CUDA may be unavailable"
}

# ── download best models ──
$models = @(
  @{ Name = "Juggernaut XL (SDXL)"; File = "juggernautXL_v10.safetensors"; Url = "https://huggingface.co/StabilityAI/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"; Dir = $ckptDir }
)

foreach ($m in $models) {
  $outPath = Join-Path $m.Dir $m.File
  if (Test-Path $outPath) {
    Status "Model already cached: $($m.Name)"
  } else {
    Status "Downloading $($m.Name)..."
    try {
      Invoke-WebRequest -Uri $m.Url -OutFile $outPath -UseBasicParsing -TimeoutSec 600
      Status "  Downloaded: $($m.Name)"
    } catch {
      Write-Host "  ⚠ Failed to download $($m.Name): $_" -ForegroundColor Yellow
      Write-Host "  → Download manually: $($m.Url) → $outPath" -ForegroundColor DarkGray
    }
  }
}

# ── custom nodes (best-of) ──
$customDir = Join-Path $Target "custom_nodes"
$null = New-Item -ItemType Directory -Path $customDir -Force
$nodes = @(
  "https://github.com/ltdrdata/ComfyUI-Manager",
  "https://github.com/cubiq/ComfyUI_IPAdapter_plus",
  "https://github.com/Fannovel16/comfyui_controlnet_aux"
)
foreach ($repo in $nodes) {
  $name = Split-Path $repo -Leaf
  $nodePath = Join-Path $customDir $name
  if (Test-Path $nodePath) {
    Status "Custom node already installed: $name"
  } else {
    Status "Installing custom node: $name..."
    git clone $repo $nodePath --depth 1 2>&1 | Out-Null
  }
}

Write-Host "`n  ✓ ComfyUI ready at $Target" -ForegroundColor Green
Write-Host "  → Launch: $gpuScript" -ForegroundColor DarkGray
Write-Host "  → Open:   http://localhost:8188" -ForegroundColor DarkGray
