# Pins the Ultimate Vocal Remover install path for Liminal / StemSplit.
param(
    [string]$UvrPath = "D:\Ultimate Vocal Remover"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $UvrPath)) {
    throw "UVR install not found: $UvrPath"
}

$libV5 = Join-Path $UvrPath "lib_v5"
if (-not (Test-Path $libV5)) {
    throw "Not a valid UVR install (missing lib_v5): $UvrPath"
}

$configDir = Join-Path $env:LOCALAPPDATA "StemSplit"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$configPath = Join-Path $configDir "uvr_path.txt"
Set-Content -Path $configPath -Value $UvrPath -Encoding UTF8

Write-Host "UVR install configured." -ForegroundColor Green
Write-Host "  Path: $UvrPath"
Write-Host "  Saved: $configPath"
Write-Host ""
Write-Host "VR denoise, MDX_Net_Models, and Demucs_Models from this install are now discoverable."
Write-Host "Restart Liminal after changing paths."