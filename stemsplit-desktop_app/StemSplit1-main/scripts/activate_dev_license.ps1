# Activates a local dev Pro license for testing (VST, FX, unlimited splits).
# Safe for local use only — writes source "dev_bypass" to %LOCALAPPDATA%\StemSplit\license.json

param(
    [string]$Email = "dev@liminal.local"
)

$ErrorActionPreference = "Stop"

$licenseDir = Join-Path $env:LOCALAPPDATA "StemSplit"
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null

$now = (Get-Date).ToUniversalTime().ToString("o")
$stored = [ordered]@{
    license_key  = "LIMINAL-DEV-LOCAL"
    email        = $Email
    activated_at = $now
    last_verified = [int][double]::Parse((Get-Date -UFormat %s))
    is_valid     = $true
    source       = "dev_bypass"
}

$licensePath = Join-Path $licenseDir "license.json"
$stored | ConvertTo-Json | Set-Content -Path $licensePath -Encoding UTF8

Write-Host "Dev Pro license activated." -ForegroundColor Green
Write-Host "  File: $licensePath"
Write-Host "  Email: $Email"
Write-Host "  Features: VST preview/apply, full FX rack, unlimited splits"
Write-Host ""
Write-Host "Restart Liminal if it is already running."