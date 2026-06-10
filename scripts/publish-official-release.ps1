<#
.SYNOPSIS
  Gate, build, publish, and link the official Liminal StemSplit installer.

.DESCRIPTION
  1) Validates the full model catalog is 100% runnable (--require-all-runnable)
  2) Builds the Windows online installer (Inno Setup)
  3) Creates a semver GitHub release on myaiplug/StemSplit1
  4) Copies the installer + checksum into the marketing site (public/downloads)
  5) Updates the website download link and pushes liminal-stemsplit

  Run only when every catalog model is confirmed working.

.PARAMETER Version
  Semver without leading v, e.g. 0.4.6. Defaults to src-tauri/tauri.conf.json.

.PARAMETER SkipBuild
  Skip installer compile; use the newest file in installers/ or dist/.

.PARAMETER SkipModelGate
  Emergency bypass only — do not use for official releases.

.PARAMETER DryRun
  Print planned actions without building, publishing, or pushing.
#>
param(
    [string]$Version = "",
    [switch]$SkipBuild,
    [switch]$SkipModelGate,
    [switch]$DryRun,
    [string]$ReleaseNotes = "",
    [string]$ModelsRoot = "D:\AudioSeperationModels",
    [string]$GithubRepo = "myaiplug/StemSplit1",
    [string]$WebsiteRemote = "origin"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path $PSScriptRoot -Parent
$AppRoot = Join-Path $RepoRoot "stemsplit-desktop_app\StemSplit1-main"
$WebsiteRoot = $RepoRoot
$ValidateScript = Join-Path $AppRoot "scripts\validate_all_models.py"
$TauriConf = Join-Path $AppRoot "src-tauri\tauri.conf.json"
$BuildScript = Join-Path $AppRoot "build_complete_installer.ps1"
$PublishScript = Join-Path $AppRoot "scripts\publish_release.ps1"
$DownloadsDir = Join-Path $WebsiteRoot "public\downloads"
$IndexHtml = Join-Path $WebsiteRoot "public\index.html"

function Get-AppVersion {
    if ($Version) { return $Version.Trim().TrimStart('v') }
    if (-not (Test-Path $TauriConf)) { throw "Missing $TauriConf" }
    $raw = Get-Content $TauriConf -Raw | ConvertFrom-Json
    return [string]$raw.version
}

function Assert-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $name"
    }
}

function Invoke-Step([string]$Title, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host "    [dry-run] skipped" -ForegroundColor DarkGray
        return
    }
    & $Action
}

$semver = Get-AppVersion
$tag = "v$semver"
$assetName = "Liminal-StemSplit-Setup-v$semver-Windows-x64-Online.exe"

Write-Host "Official release pipeline" -ForegroundColor Green
Write-Host "  App version:     $semver"
Write-Host "  GitHub tag:      $tag"
Write-Host "  Installer asset: $assetName"
Write-Host "  Model gate:      $(if ($SkipModelGate) { 'BYPASSED (not official)' } else { 'required 100% runnable' })"

Assert-Command python
Assert-Command git

Invoke-Step "Model catalog gate (100% runnable)" {
    if ($SkipModelGate) {
        Write-Warning "SkipModelGate is set — this build is NOT an official all-models-verified release."
        return
    }

    $env:STEMSPLIT_MODELS_ROOT = $ModelsRoot
    Push-Location (Join-Path $AppRoot "scripts")
    try {
        python $ValidateScript --json --require-all-runnable | Tee-Object -Variable validationJson | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $reportPath = Join-Path $AppRoot "installers\model-validation-report.json"
            New-Item -ItemType Directory -Path (Split-Path $reportPath) -Force | Out-Null
            $validationJson | Set-Content -Path $reportPath -Encoding UTF8
            throw "Model validation failed. Fix all catalog models before publishing. Report: $reportPath"
        }
        Write-Host "All catalog models passed runnable gate." -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

Invoke-Step "Build Windows online installer" {
    if ($SkipBuild) {
        Write-Host "SkipBuild set — searching for existing installer..." -ForegroundColor Yellow
        return
    }
    Push-Location $AppRoot
    try {
        $env:STEMSPLIT_RELEASE_TAG = $tag
        & $BuildScript -Online
        if ($LASTEXITCODE -ne 0) { throw "build_complete_installer.ps1 failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

$installer = $null
foreach ($dir in @(
    (Join-Path $AppRoot "installers"),
    (Join-Path $AppRoot "dist")
)) {
    if (-not (Test-Path $dir)) { continue }
    $installer = Get-ChildItem $dir -Filter "Liminal-StemSplit-Setup-*-Windows-x64-Online.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($installer) { break }
}

if (-not $installer) {
    throw "Installer not found. Build with -Online or place $assetName under installers/."
}

$checksum = (Get-FileHash -Path $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumLine = "$checksum  $assetName"

Write-Host ""
Write-Host "Installer ready:" -ForegroundColor Green
Write-Host "  Path: $([string]$installer.FullName)"
Write-Host "  Size: $([math]::Round($installer.Length / 1MB, 2)) MB"
Write-Host "  SHA256: $checksum"

Invoke-Step "Publish GitHub release ($GithubRepo)" {
    Assert-Command gh
    $notes = if ($ReleaseNotes) {
        $ReleaseNotes
    } else {
        @"
Liminal StemSplit v$semver

- Full catalog model validation: passed (--require-all-runnable)
- Windows online installer: $assetName
- SHA256: $checksum

Download from this release or https://liminal-stemsplit.onrender.com/#download
"@
    }

    $staging = Join-Path $AppRoot "installers\release-staging"
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    $stagedExe = Join-Path $staging $assetName
    Copy-Item -Path $installer.FullName -Destination $stagedExe -Force
    $stagedChecksum = Join-Path $staging "checksums-windows.sha256"
    $checksumLine | Set-Content -Path $stagedChecksum -Encoding UTF8

    Push-Location $AppRoot
    try {
        $publishArgs = @{
            Version = $tag
            Notes   = $notes
        }
        & $PublishScript @publishArgs
        if ($LASTEXITCODE -ne 0) { throw "publish_release.ps1 failed" }
    } finally {
        Pop-Location
    }
}

Invoke-Step "Link installer on marketing site" {
    New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
    $siteExe = Join-Path $DownloadsDir $assetName
    Copy-Item -Path $installer.FullName -Destination $siteExe -Force
    $checksumLine | Set-Content -Path (Join-Path $DownloadsDir "checksums-windows.sha256") -Encoding UTF8

    if (-not (Test-Path $IndexHtml)) { throw "Missing $IndexHtml" }
    $html = Get-Content $IndexHtml -Raw
    $pattern = 'id="windowsDownload" href="/downloads/[^"]+"'
    $replacement = "id=`"windowsDownload`" href=`"/downloads/$assetName`""
    if ($html -notmatch $pattern) {
        throw "Could not find windowsDownload href in public/index.html"
    }
    $html = [regex]::Replace($html, $pattern, $replacement, 1)
    $versionPattern = '(v0\.\d+\.\d+) • Free demo'
    $html = [regex]::Replace($html, $versionPattern, "v$semver • Free demo", 1)
    Set-Content -Path $IndexHtml -Value $html -Encoding UTF8 -NoNewline

    Push-Location $WebsiteRoot
    try {
        git add "public/downloads/$assetName" public/downloads/checksums-windows.sha256 public/index.html
        git commit -m "release(website): link official installer v$semver"
        git push $WebsiteRemote main
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Official release complete." -ForegroundColor Green
Write-Host "  GitHub:  https://github.com/$GithubRepo/releases/tag/$tag"
Write-Host "  Website: https://liminal-stemsplit.onrender.com/#download"
Write-Host ""
Write-Host "Next: trigger Render deploy if auto-deploy did not run (render deploys create ...)." -ForegroundColor Yellow