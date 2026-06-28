# Stage ReVerb-DeGloss.vst3 into bundled-vst/ for the Inno Setup installer.
# The app resolves plugins at: {InstallDir}\VST\ReVerb-DeGloss.vst3

param(
    [string]$Source = $env:STEMSPLIT_VST_SOURCE,
    [string]$DestRoot = "bundled-vst\ReVerb-DeGloss.vst3"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Source)) {
    $candidates = @(
        "D:\VST\ReVerb-DeGloss.vst3",
        "..\VST\ReVerb-DeGloss.vst3",
        "..\..\VST\ReVerb-DeGloss.vst3"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            $Source = $candidate
            break
        }
    }
}

if (-not $Source -or -not (Test-Path $Source)) {
    Write-Warning "ReVerb-DeGloss.vst3 not found. Set STEMSPLIT_VST_SOURCE or place the bundle at D:\VST\ReVerb-DeGloss.vst3"
    Write-Warning "Installer will skip the VST payload (skipifsourcedoesntexist)."
    exit 0
}

if (Test-Path $DestRoot) {
    Remove-Item $DestRoot -Recurse -Force
}

$destParent = Split-Path $DestRoot -Parent
if (-not (Test-Path $destParent)) {
    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
}

Copy-Item -Path $Source -Destination $DestRoot -Recurse -Force
$sizeMb = [math]::Round(((Get-ChildItem $DestRoot -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host "Staged ReVerb-DeGloss.vst3 -> $DestRoot ($sizeMb MB)" -ForegroundColor Green