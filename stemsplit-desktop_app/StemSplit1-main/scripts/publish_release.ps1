param (
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$Notes = "Official Liminal StemSplit release",

    [Parameter(Mandatory = $false)]
    [switch]$Draft
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) was not found. Install it and run gh auth login."
}

if ($Version -notmatch '^v\d+\.\d+\.\d+$') {
    Write-Error "Version must be semver with leading v, e.g. v0.4.6. Got: $Version"
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host "Publishing release $Version..." -ForegroundColor Cyan

$Assets = @()
$patterns = @(
    "installers/Liminal-StemSplit-Setup-*-Windows-x64-Online.exe",
    "installers/Liminal-StemSplit-Setup-*-Windows-x64.exe",
    "src-tauri/target/release/bundle/msi/*.msi",
    "src-tauri/target/release/bundle/nsis/*.exe",
    "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg",
    "installers/release-staging/Liminal-StemSplit-Setup-*-Windows-x64-Online.exe",
    "dist/Liminal-StemSplit-Setup-*-Windows-x64-Online.exe",
    "installers/StemSplit_Setup_*_Online.exe",
    "installers/StemSplit_Online_Setup.dmg",
    "installers/checksums-windows.sha256",
    "installers/checksums-mac.sha256",
    "installers/release-staging/checksums-windows.sha256"
)

foreach ($pattern in $patterns) {
    Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
        if ($Assets -notcontains $_.FullName) {
            $Assets += $_.FullName
        }
    }
}

if ($Assets.Count -eq 0) {
    Write-Warning "No installer assets found. Release will be created without binaries."
} else {
    Write-Host "Uploading $($Assets.Count) asset(s):"
    $Assets | ForEach-Object { Write-Host " - $_" }
}

$releaseExists = $false
try {
    gh release view $Version --repo myaiplug/liminal-stemsplit 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) { $releaseExists = $true }
} catch {
    $releaseExists = $false
}

if ($releaseExists) {
    Write-Host "Release $Version already exists — uploading assets..." -ForegroundColor Yellow
    foreach ($asset in $Assets) {
        gh release upload $Version $asset --clobber --repo myaiplug/liminal-stemsplit
        if ($LASTEXITCODE -ne 0) { throw "Failed to upload $asset" }
    }
    if ($Notes) {
        gh release edit $Version --notes $Notes --repo myaiplug/liminal-stemsplit
    }
} else {
    $args = @(
        "release", "create", $Version,
        "--repo", "myaiplug/liminal-stemsplit",
        "--title", "Liminal StemSplit $Version",
        "--notes", $Notes
    )
    if ($Draft) { $args += "--draft" }
    if ($Assets.Count -gt 0) { $args += $Assets }
    Write-Host "Running: gh $($args -join ' ')"
    & gh @args
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
}

Write-Host "Release $Version is live:" -ForegroundColor Green
Write-Host "https://github.com/myaiplug/liminal-stemsplit/releases/tag/$Version" -ForegroundColor Yellow