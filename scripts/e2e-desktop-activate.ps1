param(
    [string]$Email = 'myaiplug.com@gmail.com',
    [string]$LicenseKey = 'E2E-Prod-2026-Liminal',
    [string]$LicenseServer = 'https://liminal-stemsplit.onrender.com'
)

$ErrorActionPreference = 'Stop'

$validateUrl = "$LicenseServer/api/licenses/validate"
$body = @{ email = $Email; licenseKey = $LicenseKey } | ConvertTo-Json
$validation = Invoke-RestMethod -Uri $validateUrl -Method POST -ContentType 'application/json' -Body $body

if (-not $validation.valid) {
    throw "Production validation failed: $($validation.error)"
}

$licenseDir = Join-Path $env:LOCALAPPDATA 'StemSplit'
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null
$now = (Get-Date).ToUniversalTime().ToString('o')
$stored = [ordered]@{
    license_key = $LicenseKey
    email       = $Email
    activated_at = $validation.purchase_date ?? $now
    last_verified = [int][double]::Parse((Get-Date -UFormat %s))
    is_valid    = $true
    source      = 'remote_license_server'
}
$licensePath = Join-Path $licenseDir 'license.json'
$stored | ConvertTo-Json | Set-Content -Path $licensePath -Encoding UTF8

Write-Host "Production validation: OK"
Write-Host "License file: $licensePath"
Write-Host ($stored | ConvertTo-Json -Compress)