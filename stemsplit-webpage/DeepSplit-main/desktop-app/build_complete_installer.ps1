# Complete Automated Installer Builder for StemSplit
# Supports both offline (bundled) and online (download during install) modes

param(
    [switch]$Online,            # Build online installer (downloads during install)
    [switch]$Offline,           # Build offline installer (everything bundled) - default
    [switch]$PackageAssets,     # Create zip files for GitHub Releases upload
    [switch]$SkipBuild          # Skip npm/cargo build (use existing build)
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-PythonCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $commands = @(
        @{Exe = "python"; Prefix = @()},
        @{Exe = "py"; Prefix = @("-3")}
    )

    foreach ($candidate in $commands) {
        $cmd = Get-Command $candidate.Exe -ErrorAction SilentlyContinue
        if (-not $cmd) {
            continue
        }

        & $candidate.Exe @($candidate.Prefix + $Arguments) | Out-Host
        return $LASTEXITCODE
    }

    Write-Error "Python interpreter not found. Install Python or activate the project virtual environment."
    return 127
}

# Default to offline if neither specified
if (-not $Online -and -not $Offline -and -not $PackageAssets) {
    $Offline = $true
}

$mode = if ($PackageAssets) { "Package Assets" } elseif ($Online) { "Online" } else { "Offline" }

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  StemSplit Install Builder" -ForegroundColor Cyan
Write-Host "  Mode: $mode" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

# Check for Inno Setup
$ISCC = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $ISCC)) {
    Write-Error "Inno Setup Compiler not found at: $ISCC`nPlease install from https://jrsoftware.org/isdl.php"
    exit 1
}

# ========================================
# PACKAGE ASSETS MODE - Create zips for GitHub Releases
# ========================================
if ($PackageAssets) {
    Write-Host "[1/3] Creating release assets folder..." -ForegroundColor Yellow
    $releaseDir = "release_assets"
    if (-not (Test-Path $releaseDir)) {
        New-Item -ItemType Directory -Path $releaseDir | Out-Null
    }
    
    Write-Host "[2/3] Creating zip archives..." -ForegroundColor Yellow
    
    # Package embedded_python
    if (Test-Path "embedded_python") {
        $pythonZip = "$releaseDir\embedded_python.zip"
        Write-Host "  Compressing embedded_python (~600MB, this takes a while)..." -ForegroundColor Cyan
        if (Test-Path $pythonZip) { Remove-Item $pythonZip -Force }
        Compress-Archive -Path "embedded_python\*" -DestinationPath $pythonZip -CompressionLevel Optimal
        $size = [math]::Round((Get-Item $pythonZip).Length/1MB, 2)
        Write-Host "  ✓ Created $pythonZip ($size MB)" -ForegroundColor Green
    } else {
        Write-Warning "embedded_python folder not found. Run without -PackageAssets first."
    }
    
    # Package ffmpeg
    if (Test-Path "ffmpeg\bin\ffmpeg.exe") {
        $ffmpegZip = "$releaseDir\ffmpeg.zip"
        Write-Host "  Compressing ffmpeg..." -ForegroundColor Cyan
        if (Test-Path $ffmpegZip) { Remove-Item $ffmpegZip -Force }
        Compress-Archive -Path "ffmpeg\*" -DestinationPath $ffmpegZip -CompressionLevel Optimal
        $size = [math]::Round((Get-Item $ffmpegZip).Length/1MB, 2)
        Write-Host "  ✓ Created $ffmpegZip ($size MB)" -ForegroundColor Green
    } else {
        Write-Warning "ffmpeg folder not found. Run without -PackageAssets first."
    }
    
    Write-Host "[3/3] Generating checksums manifest..." -ForegroundColor Yellow
    $manifestPath = "$releaseDir\checksums.sha256"
    $manifestLines = @()
    if (Test-Path "$releaseDir\embedded_python.zip") {
        $pythonSha = Get-Sha256Hex -Path "$releaseDir\embedded_python.zip"
        $manifestLines += "$pythonSha  embedded_python.zip"
    }
    if (Test-Path "$releaseDir\ffmpeg.zip") {
        $ffmpegSha = Get-Sha256Hex -Path "$releaseDir\ffmpeg.zip"
        $manifestLines += "$ffmpegSha  ffmpeg.zip"
    }
    if ($manifestLines.Count -gt 0) {
        $manifestLines | Set-Content -Path $manifestPath -Encoding UTF8
        Write-Host "  ✓ Created $manifestPath" -ForegroundColor Green
    } else {
        Write-Warning "No packaged zip files found; checksums manifest was not created."
    }

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  ✓ ASSETS PACKAGED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Go to GitHub > Releases > Create new release" -ForegroundColor White
    Write-Host "2. Tag: v0.1.0-assets" -ForegroundColor White
    Write-Host "3. Upload files from: $releaseDir\ (including checksums.sha256)" -ForegroundColor White
    Write-Host "4. Then run: .\build_complete_installer.ps1 -Online" -ForegroundColor White
    explorer $releaseDir
    exit 0
}

# ========================================
# OFFLINE/ONLINE INSTALLER BUILD
# ========================================

# Step 1: Setup Embedded Python Environment
Write-Host "[1/6] Setting up environment..." -ForegroundColor Yellow
if ($Online) {
    Write-Host "✓ Skipping embedded Python setup for online installer" -ForegroundColor Green
} else {
    Write-Host "Ensuring embedded Python runtime is healthy (repair mode)..." -ForegroundColor Yellow
    .\setup_embedded_python.ps1 -RepairIfNeeded
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to setup/repair embedded environment"
        exit $LASTEXITCODE
    }

    $requiredImports = @("torch", "demucs", "librosa", "soundfile", "numpy")
    $missingImports = @()
    foreach ($module in $requiredImports) {
        & "embedded_python\python.exe" -c "import $module" *> $null
        if ($LASTEXITCODE -ne 0) {
            $missingImports += $module
        }
    }
    if ($missingImports.Count -gt 0) {
        Write-Error "Embedded runtime is still missing required modules: $($missingImports -join ', ')"
        exit 1
    }

    Write-Host "✓ Embedded environment verified" -ForegroundColor Green
}

# Step 2: Build Next.js app
if ($SkipBuild) {
    Write-Host "`n[2/6] Skipping Next.js build (using existing)..." -ForegroundColor Yellow
} else {
    Write-Host "`n[2/6] Building application..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed!"
        exit $LASTEXITCODE
    }
    Write-Host "✓ Build complete" -ForegroundColor Green
}

# Step 3: Build Tauri executable
if ($SkipBuild) {
    Write-Host "`n[3/6] Skipping Tauri build (using existing)..." -ForegroundColor Yellow
} else {
    Write-Host "`n[3/6] Compiling executable application..." -ForegroundColor Yellow
    cd src-tauri
    cargo build --release
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed!"
        exit $LASTEXITCODE
    }
    cd ..
    Write-Host "✓ Application Ready" -ForegroundColor Green
}

# Step 4: Download FFmpeg (required for MP3 encoding)
Write-Host "`n[4/6] Setting up FFmpeg..." -ForegroundColor Yellow
$FFMPEG_DIR = "ffmpeg"
$FFMPEG_BIN_DIR = "$FFMPEG_DIR\bin"
$FFMPEG_EXE = "$FFMPEG_BIN_DIR\ffmpeg.exe"
$FFPROBE_EXE = "$FFMPEG_BIN_DIR\ffprobe.exe"
if (-not (Test-Path $FFMPEG_EXE) -or -not (Test-Path $FFPROBE_EXE)) {
    Write-Host "Downloading FFmpeg..." -ForegroundColor Yellow
    $FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    $FFMPEG_ZIP = "ffmpeg_temp.zip"
    
    try {
        Invoke-WebRequest -Uri $FFMPEG_URL -OutFile $FFMPEG_ZIP -UseBasicParsing
        
        # Extract ffmpeg.exe and ffprobe.exe from the bin folder
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($FFMPEG_ZIP)
        $ffmpegEntry = $zip.Entries | Where-Object { $_.FullName -like "*\bin\ffmpeg.exe" } | Select-Object -First 1
        $ffprobeEntry = $zip.Entries | Where-Object { $_.FullName -like "*\bin\ffprobe.exe" } | Select-Object -First 1
        
        if ($ffmpegEntry -and $ffprobeEntry) {
            if (-not (Test-Path $FFMPEG_BIN_DIR)) { New-Item -ItemType Directory -Path $FFMPEG_BIN_DIR -Force | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($ffmpegEntry, $FFMPEG_EXE, $true)
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($ffprobeEntry, $FFPROBE_EXE, $true)
            Write-Host "✓ FFmpeg downloaded" -ForegroundColor Green
        } else {
            Write-Warning "Could not find ffmpeg.exe/ffprobe.exe in archive"
        }
        $zip.Dispose()
        Remove-Item $FFMPEG_ZIP -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "Failed to download FFmpeg: $_"
        Write-Warning "MP3 encoding may not work without FFmpeg"
    }
} else {
    Write-Host "✓ FFmpeg already exists" -ForegroundColor Green
}

# Step 5: Download/verify models (offline mode only)
if ($Offline) {
    Write-Host "`n[5/6] Verifying model files..." -ForegroundColor Yellow
    if (Test-Path "Stem Split Models") {
        $modelCount = (Get-ChildItem "Stem Split Models" -Recurse -File).Count
        Write-Host "✓ Found $modelCount model files" -ForegroundColor Green
    } else {
        Write-Warning "Stem Split Models folder not found. Models will need to be downloaded by user."
    }

    $payloadManifest = "scripts\ci\model_payload_manifest.json"
    $payloadReportJson = "installers\model-payload-report.json"
    $payloadReportMd = "installers\model-payload-report.md"
    if (Test-Path $payloadManifest) {
        Write-Host "Running model payload manifest validation..." -ForegroundColor Yellow
        $payloadArgs = @(
            "scripts/ci/validate_model_payloads.py",
            "--manifest", $payloadManifest,
            "--repo-root", ".",
            "--json-out", $payloadReportJson,
            "--md-out", $payloadReportMd
        )
        $payloadExit = Invoke-PythonCommand -Arguments $payloadArgs
        if ($payloadExit -ne 0) {
            Write-Error "Model payload validation failed. See $payloadReportMd for details."
            exit $payloadExit
        }
        Write-Host "✓ Model payload validation passed" -ForegroundColor Green
    } else {
        Write-Warning "Model payload manifest not found at $payloadManifest; skipping payload validation."
    }
} else {
    Write-Host "`n[5/6] Skipping model verification (online mode - models download on first use)..." -ForegroundColor Yellow
}

# Step 6: Create Installer
Write-Host "`n[6/6] Creating installer..." -ForegroundColor Yellow

if ($Online) {
    # Online installer - smaller, downloads dependencies during install
    $issFile = "setup_online.iss"
    $outputName = "StemSplit_Setup_*_Online.exe"
    Write-Host "Building ONLINE installer (downloads during install)..." -ForegroundColor Cyan
} else {
    # Offline installer - everything bundled
    $issFile = "setup.iss"
    $outputName = "StemSplit_Setup_x64.exe"
    Write-Host "Building OFFLINE installer (fully self-contained)..." -ForegroundColor Cyan
}

$isccArgs = @()
if ($Online -and $env:STEMSPLIT_RELEASE_TAG) {
    $isccArgs += "/DReleaseTag=$($env:STEMSPLIT_RELEASE_TAG)"
}
if ($Online -and $env:STEMSPLIT_INSTALLER_SKIP_ONLINE_DOWNLOADS -eq "1") {
    $isccArgs += "/DSkipOnlineDownloads=1"
}
$isccArgs += $issFile

& $ISCC @isccArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  ✓ INSTALLER CREATED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    
    $outputDirs = @("installers", "dist")
    $installer = $null
    foreach ($dir in $outputDirs) {
        if (Test-Path $dir) {
            $installer = Get-ChildItem $dir -Filter $outputName | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($installer) { break }
        }
    }
    if ($installer) {
        Write-Host "Installer Details:" -ForegroundColor Cyan
        Write-Host "  Location: $($installer.FullName)" -ForegroundColor White
        Write-Host "  Size: $([math]::Round($installer.Length/1MB,2)) MB" -ForegroundColor White
        Write-Host "  Created: $($installer.LastWriteTime)" -ForegroundColor White

        $installerHash = Get-Sha256Hex -Path $installer.FullName
        $checksumFile = Join-Path $installer.DirectoryName "checksums-windows.sha256"
        "$installerHash  $($installer.Name)" | Set-Content -Path $checksumFile -Encoding UTF8
        Write-Host "  Checksum: $checksumFile" -ForegroundColor White
        
        if ($Online) {
            Write-Host "`nNote: This installer requires internet connection during installation." -ForegroundColor Yellow
            Write-Host "Make sure assets are uploaded to GitHub Releases first!" -ForegroundColor Yellow
        }
    }
    Write-Host "`nOpening installer folder..." -ForegroundColor Cyan
    if ($installer) {
        explorer $installer.DirectoryName
    } elseif (Test-Path "installers") {
        explorer "installers"
    } elseif (Test-Path "dist") {
        explorer "dist"
    }
} else {
    Write-Error "Setup failed!"
    exit $LASTEXITCODE
}
