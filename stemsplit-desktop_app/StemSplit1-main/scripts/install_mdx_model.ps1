# Installs MVSEP-MDX23 inference bundle for the MDX engine.
# Model weights download automatically on first MDX run.

param(
    [string]$DestinationRoot = $(if (Test-Path "D:\AudioSeperationModels") { "D:\AudioSeperationModels" } else { Split-Path $PSScriptRoot -Parent })
)

$ErrorActionPreference = "Stop"
$folderName = "MVSEP-MDX23-music-separation-model-main"
$destination = Join-Path $DestinationRoot $folderName
$zipPath = Join-Path $env:TEMP "mvsep-mdx23-main.zip"
$repoZipUrl = "https://github.com/ZFTurbo/MVSEP-MDX23-music-separation-model/archive/refs/heads/main.zip"

function Test-MdxBundle([string]$Path) {
    return (Test-Path (Join-Path $Path "inference.py"))
}

if (Test-MdxBundle $destination) {
    Write-Host "MDX bundle already installed at: $destination" -ForegroundColor Green
    exit 0
}

Write-Host "Downloading MVSEP-MDX23 source..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $repoZipUrl -OutFile $zipPath

$extractRoot = Join-Path $env:TEMP "mvsep-mdx23-extract"
if (Test-Path $extractRoot) {
    Remove-Item $extractRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $extractRoot | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

$extracted = Get-ChildItem $extractRoot -Directory | Where-Object { $_.Name -like "MVSEP-MDX23-music-separation-model-*" } | Select-Object -First 1
if (-not $extracted) {
    throw "Downloaded archive did not contain the expected MVSEP folder."
}

if (Test-Path $destination) {
    Remove-Item $destination -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
Move-Item $extracted.FullName $destination

$modelsDir = Join-Path $destination "models"
if (-not (Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir | Out-Null
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "MDX bundle installed to: $destination" -ForegroundColor Green
Write-Host "Weights (Kim_Vocal_2.onnx, Kim_Inst.onnx, demucs hybrid) download on first MDX split." -ForegroundColor Yellow