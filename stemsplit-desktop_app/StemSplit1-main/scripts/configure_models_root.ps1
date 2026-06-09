# Pins the shared separation model library for Liminal / StemSplit.
param(
    [string]$ModelsRoot = "D:\AudioSeperationModels"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ModelsRoot)) {
    throw "Models root not found: $ModelsRoot"
}

$mdx = Join-Path $ModelsRoot "MVSEP-MDX23-music-separation-model-main\inference.py"
if (-not (Test-Path $mdx)) {
    Write-Warning "MVSEP-MDX23 bundle not found under $ModelsRoot. MDX engine will still fail until it is installed."
}

$configDir = Join-Path $env:LOCALAPPDATA "StemSplit"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$configPath = Join-Path $configDir "models_root.txt"
Set-Content -Path $configPath -Value $ModelsRoot -Encoding UTF8

Write-Host "Models root configured." -ForegroundColor Green
Write-Host "  Path: $ModelsRoot"
Write-Host "  Saved: $configPath"
Write-Host ""
Write-Host "Restart Liminal, then retry MDX / Drumsep splits."