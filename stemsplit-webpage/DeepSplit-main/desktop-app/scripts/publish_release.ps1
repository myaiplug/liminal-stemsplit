param (
    [Parameter(Mandatory=$true)]
    [string]$Version,         # e.g., v0.1.1
    
    [Parameter(Mandatory=$false)]
    [string]$Notes = "Automated release of StemSplit",
    
    [Parameter(Mandatory=$false)]
    [switch]$Draft
)

$ErrorActionPreference = "Stop"

# Checking if gh cli is installed
if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) was not found. Please install it to use this script."
}

# Ensure we are in the project root
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host "Publishing Release $Version..." -ForegroundColor Cyan

# Gather files to upload
$Assets = @()

if (Test-Path "installers/StemSplit_Setup_*_Online.exe") {
    $Assets += Get-ChildItem "installers/StemSplit_Setup_*_Online.exe" | ForEach-Object { $_.FullName }
}
if (Test-Path "installers/StemSplit_Online_Setup.dmg") {
    $Assets += Get-ChildItem "installers/StemSplit_Online_Setup.dmg" | ForEach-Object { $_.FullName }
}
if (Test-Path "installers/checksums-windows.sha256") {
    $Assets += "installers/checksums-windows.sha256"
}
if (Test-Path "installers/checksums-mac.sha256") {
    $Assets += "installers/checksums-mac.sha256"
}

if ($Assets.Count -eq 0) {
    Write-Warning "No installer assets found in 'installers/' directory. Proceeding to create release with no binaries attached."
} else {
    Write-Host "Found $($Assets.Count) assets to upload:"
    $Assets | ForEach-Object { Write-Host " - $_" }
}

# Construct the gh release create command
$Command = @("gh", "release", "create", $Version, "--title", "StemSplit $Version", "--notes", $Notes)

if ($Draft) {
    $Command += "--draft"
}

if ($Assets.Count -gt 0) {
    $Command += $Assets
}

Write-Host "Running: $($Command -join ' ')"
& $Command[0] $Command[1..($Command.Length-1)]

if ($LASTEXITCODE -eq 0) {
    Write-Host "Release $Version successfully created!" -ForegroundColor Green
    Write-Host "You can view it here: https://github.com/myaiplug/StemSplit1/releases/tag/$Version" -ForegroundColor Yellow
} else {
    Write-Error "Failed to create GitHub release. See the output above."
}
