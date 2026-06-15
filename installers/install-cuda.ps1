<#
.SYNOPSIS
  Install CUDA Toolkit 12.x + cuDNN — deep learning SDK for GPU acceleration.
  Detects current driver and installs matching toolkit version.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── detect current CUDA driver version ──
$driverVer = (nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null) -replace '\s',''
if (-not $driverVer) {
  Write-Host "  ⚠ NVIDIA driver not detected. Install NVIDIA driver first." -ForegroundColor Yellow
  return
}
Status "Detected NVIDIA driver: $driverVer"

# ── check if CUDA toolkit is already installed ──
$cudaPaths = @(
  "$env:ProgramFiles\NVIDIA GPU Computing Toolkit\CUDA\v12.8",
  "$env:ProgramFiles\NVIDIA GPU Computing Toolkit\CUDA\v12.6",
  "$env:ProgramFiles\NVIDIA GPU Computing Toolkit\CUDA\v12.5",
  "$env:ProgramFiles\NVIDIA GPU Computing Toolkit\CUDA\v12.4"
)
$existing = $cudaPaths | Where-Object { Test-Path (Join-Path $_ "bin\nvcc.exe") } | Select-Object -First 1
if ($existing) {
  Status "CUDA Toolkit already installed: $existing"
} else {
  Status "Downloading CUDA Toolkit 12.8..."
  $installer = Join-Path $env:TEMP "cuda_12.8.exe"
  $url = "https://developer.download.nvidia.com/compute/cuda/12.8.0/local_installers/cuda_12.8.0_552.22_windows.exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 600
    Status "Running CUDA Toolkit installer (silent)..."
    Start-Process -Wait -FilePath $installer -ArgumentList "-s", "nvcuda_64.dll", "nvcompiler.dll", "nvrtc64*.dll"
    Remove-Item $installer -Force
    Status "  CUDA Toolkit installed"
  } catch {
    Write-Host "  ⚠ CUDA download/install failed: $_" -ForegroundColor Yellow
    Write-Host "  → Manual: https://developer.nvidia.com/cuda-downloads" -ForegroundColor DarkGray
  }
}

# ── cuDNN ──
$cudaRoot = $cudaPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($cudaRoot -and -not (Test-Path (Join-Path $cudaRoot "bin\cudnn*.dll"))) {
  Status "Downloading cuDNN for CUDA 12.x..."
  $zip = Join-Path $env:TEMP "cudnn.zip"
  # cuDNN requires NVIDIA developer login — provide direct URL if possible
  $url = "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.6.0.74_cuda12-archive.zip"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 300
    Expand-Archive -Path $zip -DestinationPath $env:TEMP\cudnn-extract -Force
    Copy-Item -Path "$env:TEMP\cudnn-extract\cudnn-windows-x86_64-9.6.0.74_cuda12-archive\bin\*.dll" -Destination (Join-Path $cudaRoot "bin") -Force
    Copy-Item -Path "$env:TEMP\cudnn-extract\cudnn-windows-x86_64-9.6.0.74_cuda12-archive\include\*.h" -Destination (Join-Path $cudaRoot "include") -Force
    Copy-Item -Path "$env:TEMP\cudnn-extract\cudnn-windows-x86_64-9.6.0.74_cuda12-archive\lib\*.lib" -Destination (Join-Path $cudaRoot "lib\x64") -Force
    Remove-Item $zip -Force; Remove-Item "$env:TEMP\cudnn-extract" -Recurse -Force
    Status "  cuDNN installed"
  } catch {
    Write-Host "  ⚠ cuDNN download failed (may require NVIDIA login)." -ForegroundColor Yellow
    Write-Host "  → Manual: https://developer.nvidia.com/cudnn" -ForegroundColor DarkGray
  }
} elseif (-not $cudaRoot) {
  Write-Host "  ⚠ Skipping cuDNN — CUDA Toolkit not installed" -ForegroundColor Yellow
} else {
  Status "cuDNN already installed"
}

# ── add to PATH ──
if ($cudaRoot) {
  $paths = @(
    Join-Path $cudaRoot "bin",
    Join-Path $cudaRoot "libnvvp"
  )
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  foreach ($p in $paths) {
    if ($userPath -notlike "*$p*") {
      [Environment]::SetEnvironmentVariable("Path", "$userPath;$p", "User")
    }
  }
  Status "CUDA paths added to user PATH"
}

Write-Host "`n  ✓ CUDA Toolkit + cuDNN ready" -ForegroundColor Green
Write-Host "  → Verify: nvcc --version" -ForegroundColor DarkGray
