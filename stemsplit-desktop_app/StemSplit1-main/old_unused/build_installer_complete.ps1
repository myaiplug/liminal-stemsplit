# ============================================================================
# StemSplit - Complete Installer Build Script for Windows
# ============================================================================
# This script sets up EVERYTHING needed for the installer:
# 1. Embedded Python 3.10 with all packages
# 2. FFmpeg for audio encoding
# 3. Builds the Tauri application
# 4. Creates the Inno Setup installer
#
# Prerequisites:
# - PowerShell 5.1+
# - Node.js and npm installed
# - Rust and cargo installed
# - Inno Setup installed (iscc.exe in PATH)
#
# Usage: .\build_installer_complete.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'  # Speed up Invoke-WebRequest

$PROJECT_ROOT = $PSScriptRoot
$PYTHON_VERSION = "3.10.11"
$PYTHON_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-amd64.zip"
$PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
$FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$EMBED_DIR = Join-Path $PROJECT_ROOT "embedded_python"
$FFMPEG_DIR = Join-Path $PROJECT_ROOT "ffmpeg"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)  
    Write-Host "  ⚠ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "  ✗ $Message" -ForegroundColor Red
}

# ============================================================================
# Step 1: Set Up Embedded Python
# ============================================================================
Write-Step "Step 1/6: Setting up Embedded Python $PYTHON_VERSION"

if (-not (Test-Path $EMBED_DIR)) {
    New-Item -ItemType Directory -Path $EMBED_DIR -Force | Out-Null
}

$pythonExe = Join-Path $EMBED_DIR "python.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Host "  Downloading Python $PYTHON_VERSION..." -ForegroundColor Yellow
    $zipPath = Join-Path $PROJECT_ROOT "python_embed.zip"
    Invoke-WebRequest -Uri $PYTHON_URL -OutFile $zipPath
    
    Write-Host "  Extracting Python..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $EMBED_DIR -Force
    Remove-Item $zipPath -Force
    
    Write-Success "Python $PYTHON_VERSION extracted"
} else {
    Write-Success "Python already exists"
}

# Configure python._pth to enable site-packages (CRITICAL!)
$pthFile = Get-ChildItem "$EMBED_DIR\python*._pth" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName -Raw
    if ($content -notmatch "^import site" -and $content -match "#import site") {
        Write-Host "  Enabling site-packages in $($pthFile.Name)..." -ForegroundColor Yellow
        $content = $content -replace "#import site", "import site"
        Set-Content -Path $pthFile.FullName -Value $content -NoNewline
        Write-Success "site-packages enabled"
    } else {
        Write-Success "site-packages already enabled"
    }
}

# ============================================================================
# Step 2: Install Pip
# ============================================================================
Write-Step "Step 2/6: Installing Pip"

$pipExe = Join-Path $EMBED_DIR "Scripts\pip.exe"

if (-not (Test-Path $pipExe)) {
    Write-Host "  Downloading get-pip.py..." -ForegroundColor Yellow
    $getPipPath = Join-Path $EMBED_DIR "get-pip.py"
    Invoke-WebRequest -Uri $PIP_URL -OutFile $getPipPath
    
    Write-Host "  Installing pip..." -ForegroundColor Yellow
    & $pythonExe $getPipPath --no-warn-script-location 2>&1 | Out-Null
    Remove-Item $getPipPath -Force -ErrorAction SilentlyContinue
    
    if (Test-Path $pipExe) {
        Write-Success "Pip installed successfully"
    } else {
        Write-Error "Pip installation failed!"
        exit 1
    }
} else {
    Write-Success "Pip already installed"
}

# Upgrade pip
Write-Host "  Upgrading pip..." -ForegroundColor Yellow
& $pythonExe -m pip install --upgrade pip --no-warn-script-location 2>&1 | Out-Null
Write-Success "Pip upgraded"

# ============================================================================
# Step 3: Install Python Packages
# ============================================================================
Write-Step "Step 3/6: Installing Python Packages (this may take 10-20 minutes)"

$requirementsPath = Join-Path $PROJECT_ROOT "requirements.txt"

if (Test-Path $requirementsPath) {
    Write-Host "  Installing from requirements.txt..." -ForegroundColor Yellow
    Write-Host "  (torch and AI models are large, please be patient)" -ForegroundColor Yellow
    
    # Install packages with progress output
    & $pythonExe -m pip install -r $requirementsPath --no-warn-script-location --no-cache-dir 2>&1 | ForEach-Object {
        if ($_ -match "Successfully installed|Requirement already satisfied") {
            Write-Host "    $_" -ForegroundColor DarkGray
        } elseif ($_ -match "ERROR|error") {
            Write-Host "    $_" -ForegroundColor Red
        }
    }
    
    # Verify critical packages are installed
    Write-Host ""
    Write-Host "  Verifying installations..." -ForegroundColor Yellow
    
    $criticalPackages = @("torch", "demucs", "spleeter", "librosa", "soundfile", "pedalboard", "pydub")
    $allInstalled = $true
    
    foreach ($pkg in $criticalPackages) {
        $result = & $pythonExe -c "import $pkg; print('$pkg OK')" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "$pkg installed"
        } else {
            Write-Error "$pkg MISSING!"
            $allInstalled = $false
        }
    }
    
    if (-not $allInstalled) {
        Write-Error "Some packages failed to install. Check the errors above."
        exit 1
    }
    
    # Clean pip cache to reduce size
    Write-Host "  Cleaning pip cache..." -ForegroundColor Yellow
    & $pythonExe -m pip cache purge 2>&1 | Out-Null
    Write-Success "Pip cache cleaned"
    
} else {
    Write-Error "requirements.txt not found!"
    exit 1
}

# ============================================================================
# Step 4: Download FFmpeg
# ============================================================================
Write-Step "Step 4/6: Setting up FFmpeg"

$ffmpegExe = Join-Path $FFMPEG_DIR "ffmpeg.exe"

if (-not (Test-Path $ffmpegExe)) {
    if (-not (Test-Path $FFMPEG_DIR)) {
        New-Item -ItemType Directory -Path $FFMPEG_DIR -Force | Out-Null
    }
    
    Write-Host "  Downloading FFmpeg..." -ForegroundColor Yellow
    $ffmpegZip = Join-Path $PROJECT_ROOT "ffmpeg.zip"
    
    try {
        Invoke-WebRequest -Uri $FFMPEG_URL -OutFile $ffmpegZip
        
        Write-Host "  Extracting FFmpeg..." -ForegroundColor Yellow
        $tempDir = Join-Path $PROJECT_ROOT "ffmpeg_temp"
        Expand-Archive -Path $ffmpegZip -DestinationPath $tempDir -Force
        
        # Find ffmpeg.exe in the extracted folder
        $ffmpegExtracted = Get-ChildItem -Path $tempDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
        if ($ffmpegExtracted) {
            Copy-Item $ffmpegExtracted.FullName -Destination $ffmpegExe -Force
            Write-Success "FFmpeg installed"
        } else {
            Write-Error "Could not find ffmpeg.exe in downloaded archive"
        }
        
        Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "FFmpeg download failed. MP3 encoding may not work."
        Write-Warning "You can manually download FFmpeg and place ffmpeg.exe in $FFMPEG_DIR"
    }
} else {
    Write-Success "FFmpeg already exists"
}

# ============================================================================
# Step 5: Build Tauri Application
# ============================================================================
Write-Step "Step 5/6: Building Tauri Application"

Set-Location $PROJECT_ROOT

# Install npm dependencies
Write-Host "  Installing npm dependencies..." -ForegroundColor Yellow
npm install 2>&1 | Out-Null
Write-Success "npm dependencies installed"

# Build Next.js
Write-Host "  Building Next.js frontend..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
Write-Success "Frontend built"

# Build Tauri
Write-Host "  Building Tauri binary (this may take a few minutes)..." -ForegroundColor Yellow
Set-Location (Join-Path $PROJECT_ROOT "src-tauri")
cargo build --release 2>&1 | Out-Null

$tauriExe = Join-Path $PROJECT_ROOT "src-tauri\target\release\stem-split.exe"
if (Test-Path $tauriExe) {
    Write-Success "Tauri binary built: stem-split.exe"
} else {
    Write-Error "Tauri build failed!"
    exit 1
}

Set-Location $PROJECT_ROOT

# ============================================================================
# Step 6: Create Installer
# ============================================================================
Write-Step "Step 6/6: Creating Installer"

# Check for Inno Setup
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
    $iscc = Get-Command "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" -ErrorAction SilentlyContinue
}

if (-not $iscc) {
    Write-Warning "Inno Setup not found. Please install it from: https://jrsoftware.org/isdownload.php"
    Write-Warning "Then run: iscc setup.iss"
} else {
    Write-Host "  Running Inno Setup Compiler..." -ForegroundColor Yellow
    & $iscc.Source "setup.iss" 2>&1 | Out-Null
    
    $installerPath = Join-Path $PROJECT_ROOT "installers\StemSplit_Setup_x64.exe"
    if (Test-Path $installerPath) {
        $size = [math]::Round((Get-Item $installerPath).Length / 1MB, 2)
        Write-Success "Installer created: $installerPath ($size MB)"
    } else {
        Write-Error "Installer creation failed!"
        exit 1
    }
}

# ============================================================================
# Summary
# ============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "BUILD COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Calculate sizes
$pythonSize = [math]::Round((Get-ChildItem $EMBED_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
Write-Host "  Embedded Python size: $pythonSize MB" -ForegroundColor Cyan

if (Test-Path $FFMPEG_DIR) {
    $ffmpegSize = [math]::Round((Get-ChildItem $FFMPEG_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
    Write-Host "  FFmpeg size: $ffmpegSize MB" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Test the installer on a clean Windows machine"
Write-Host "  2. The installer is in: installers\StemSplit_Setup_x64.exe"
Write-Host ""
