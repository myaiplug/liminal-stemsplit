# Build the optional demix-rs binary (Rust / Candle BS-RoFormer) for Liminal's "Rust engine (demix-rs)" models.
#   powershell -ExecutionPolicy Bypass -File build_demix.ps1          CPU build
#   powershell -ExecutionPolicy Bypass -File build_demix.ps1 -Cuda    NVIDIA build (needs the CUDA toolkit; RTX 20xx = compute 75)
# Needs git, rustup (https://rustup.rs) and the MSVC build tools. Installs to %LOCALAPPDATA%\StemSplit\models\demix\bin
# (or $env:STEMSPLIT_MODELS_ROOT\demix\bin). demix-rs is Apache-2.0; the binary statically links symphonia (MPL-2.0),
# so Liminal does not ship it in the installer.
param([switch]$Cuda)
$ErrorActionPreference = 'Stop'
$Commit = '4b9c6fdf976c839006ee946e1ee922ba64548a9a'
$Root = if ($env:STEMSPLIT_MODELS_ROOT) { $env:STEMSPLIT_MODELS_ROOT } else { Join-Path $env:LOCALAPPDATA 'StemSplit\models' }
$Src = Join-Path $Root 'demix\src'
if (-not (Test-Path (Join-Path $Src '.git'))) { git clone https://github.com/rzafiamy/demix-rs $Src }
git -C $Src fetch --quiet origin
git -C $Src checkout --quiet $Commit
$cargoArgs = @('build', '--release', '--locked', '-p', 'demix-cli')
if ($Cuda) {
  if (-not $env:CUDA_COMPUTE_CAP) { $env:CUDA_COMPUTE_CAP = '75' }
  $cargoArgs += @('--features', 'cuda')
}
Push-Location $Src
try { & cargo @cargoArgs; if ($LASTEXITCODE -ne 0) { throw "cargo build failed ($LASTEXITCODE)" } } finally { Pop-Location }
$Bin = Join-Path $Root 'demix\bin'
New-Item -ItemType Directory -Force -Path $Bin | Out-Null
Copy-Item (Join-Path $Src 'target\release\demix.exe') (Join-Path $Bin 'demix.exe') -Force
& (Join-Path $Bin 'demix.exe') --version
Write-Host "Installed $Bin\demix.exe"
