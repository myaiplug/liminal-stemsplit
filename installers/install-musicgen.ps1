<#
.SYNOPSIS
  Install Meta AudioCraft (MusicGen + AudioGen + encodec).
  Complements AceStep — better for instrumental generation, melody conditioning.
#>

$ErrorActionPreference = "Stop"
$TargetDir = "D:\AudioCraft"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. audiocraft pip package ──
$acCheck = pip show audiocraft 2>$null
if ($acCheck) {
  Status "AudioCraft already installed"
} else {
  Status "Installing AudioCraft from Meta..."
  pip install 'audiocraft @ git+https://github.com/facebookresearch/audiocraft.git' --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Status "  AudioCraft installed"
  } else {
    # fallback: clone + install
    Status "Trying clone + pip install..."
    $null = New-Item -ItemType Directory -Path $TargetDir -Force
    git clone "https://github.com/facebookresearch/audiocraft" $TargetDir --depth 1 2>&1 | Out-Null
    if (Test-Path $TargetDir) {
      pip install -e $TargetDir --quiet 2>&1 | Out-Null
      Status "  AudioCraft installed from cloned repo"
    }
  }
}

# ── 2. download pretrained models ──
$modelsDir = "D:\Models\AudioCraft"
$null = New-Item -ItemType Directory -Path $modelsDir -Force

$models = @(
  @{ Name = "musicgen-medium"; Url = "https://huggingface.co/facebook/musicgen-medium/resolve/main/musicgen-medium.pt" }
  @{ Name = "musicgen-small"; Url = "https://huggingface.co/facebook/musicgen-small/resolve/main/musicgen-small.pt" }
)

foreach ($m in $models) {
  $outPath = Join-Path $modelsDir "$($m.Name).pt"
  if (Test-Path $outPath) {
    Status "MusicGen model cached: $($m.Name)"
  } else {
    Status "Downloading $($m.Name) (~2GB)..."
    try {
      pip install huggingface-hub --quiet 2>&1 | Out-Null
      python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='facebook/$($m.Name)', filename='$($m.Name).pt', local_dir=r'$modelsDir')" 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { Status "  Downloaded: $($m.Name)" }
    } catch { Write-Host "  ⚠ Failed: $($m.Name)" -ForegroundColor Yellow }
  }
}

Write-Host "`n  ✓ AudioCraft (MusicGen) ready" -ForegroundColor Green
Write-Host "  → Generate: python -c 'from audiocraft.models import MusicGen; m = MusicGen.get_pretrained(\"musicgen-medium\"); m.generate([\"drum and bass, fast tempo\"])'" -ForegroundColor DarkGray
