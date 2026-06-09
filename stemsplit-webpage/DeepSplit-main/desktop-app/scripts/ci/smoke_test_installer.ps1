param(
    [string]$InstallerPath,
    [string]$InstallDir = "$Env:ProgramFiles\StemSplit",
    [string]$ReportPath = "installers\smoke-windows.json"
)

$ErrorActionPreference = "Stop"

function Resolve-InstallerPath {
    param([string]$InputPath)

    if ($InputPath -and (Test-Path $InputPath)) {
        return (Resolve-Path $InputPath).Path
    }

    $candidate = Get-ChildItem "installers" -Filter "StemSplit_Setup_*_Online.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $candidate) {
        throw "No installer found. Expected 'installers\\StemSplit_Setup_*_Online.exe'."
    }

    return $candidate.FullName
}

function Invoke-SilentInstall {
    param([string]$Path)

    Write-Host "[Smoke] Installing: $Path"
    $proc = Start-Process -FilePath $Path -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Installer exited with code $($proc.ExitCode)."
    }
}

function Invoke-SilentUninstall {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Uninstaller not found: $Path"
    }

    Write-Host "[Smoke] Uninstalling: $Path"
    $proc = Start-Process -FilePath $Path -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait -PassThru
    return $proc.ExitCode
}

$resolvedInstaller = Resolve-InstallerPath -InputPath $InstallerPath
$mainExeCandidates = @(
    (Join-Path $InstallDir "StemSplit.exe"),
    (Join-Path $InstallDir "stem-split.exe")
)
$uninstaller = Join-Path $InstallDir "unins000.exe"

function Get-InstalledMainExe {
    foreach ($candidate in $mainExeCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    return $null
}

$report = [ordered]@{
    platform = "windows"
    passed = $false
    installer_path = $resolvedInstaller
    install_dir = $InstallDir
    checks = [ordered]@{
        baseline_uninstall = $false
        install_main_exe = $false
        install_uninstaller = $false
        uninstall_removed_main_exe = $false
        reinstall_main_exe = $false
    }
    message = "Smoke test did not complete"
}

function Write-SmokeReport {
    param(
        [string]$Path,
        [hashtable]$Body
    )

    $parent = Split-Path -Path $Path -Parent
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $Body | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

Write-Host "[Smoke] Target install directory: $InstallDir"
Write-Host "[Smoke] Using installer: $resolvedInstaller"

try {
    # Clean baseline if previous installation exists
    if (Test-Path $uninstaller) {
        $baselineExit = Invoke-SilentUninstall -Path $uninstaller
        if ($baselineExit -ne 0) {
            Write-Warning "Baseline uninstall returned non-zero exit code $baselineExit; continuing because cleanup is best-effort at this phase."
        }
    }
    $report.checks.baseline_uninstall = $true

    # Install + verify
    Invoke-SilentInstall -Path $resolvedInstaller
    $installedMainExe = Get-InstalledMainExe
    if (-not $installedMainExe) {
        throw "Main executable not found after install. Checked: $($mainExeCandidates -join ', ')"
    }
    $report.checks.install_main_exe = $true

    if (-not (Test-Path $uninstaller)) {
        throw "Uninstaller not found after install: $uninstaller"
    }
    $report.checks.install_uninstaller = $true

    # Uninstall + verify removal
    $uninstallExit = Invoke-SilentUninstall -Path $uninstaller
    if ($uninstallExit -ne 0) {
        Write-Warning "Uninstall returned non-zero exit code $uninstallExit; validating filesystem state before failing."
    }
    if (Get-InstalledMainExe) {
        throw "Main executable still present after uninstall. Checked: $($mainExeCandidates -join ', ')"
    }
    $report.checks.uninstall_removed_main_exe = $true

    # Reinstall smoke path
    Invoke-SilentInstall -Path $resolvedInstaller
    if (-not (Get-InstalledMainExe)) {
        throw "Main executable not found after reinstall. Checked: $($mainExeCandidates -join ', ')"
    }
    $report.checks.reinstall_main_exe = $true

    $report.passed = $true
    $report.message = "Installer smoke tests passed"
    Write-Host "[Smoke] Installer smoke tests passed."
}
catch {
    $report.passed = $false
    $report.message = $_.Exception.Message
    Write-SmokeReport -Path $ReportPath -Body $report
    throw
}

Write-SmokeReport -Path $ReportPath -Body $report
Write-Host "[Smoke] Wrote report: $ReportPath"
