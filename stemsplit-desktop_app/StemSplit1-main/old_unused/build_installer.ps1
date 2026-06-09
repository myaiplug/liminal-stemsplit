# Usage: .\build_installer.ps1

Write-Host "Building StemSplit Installer..." -ForegroundColor Cyan

# 1. Check for Inno Setup
$ISCC = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $ISCC)) {
    Write-Error "Inno Setup Compiler (ISCC.exe) not found at: $ISCC"
    Write-Host "Please install Inno Setup 6 from https://jrsoftware.org/isdl.php"
    exit 1
}

# 2. Build Tauri App
Write-Host "Compiling Tauri Application..." -ForegroundColor Yellow
npm run tauri build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri build failed!"
    exit $LASTEXITCODE
}

# 3. Create Installer
Write-Host "Creating Inno Setup Installer..." -ForegroundColor Yellow

# Ensure .venv is readable (sometimes locked files prevent reading)
if (-not (Test-Path ".venv")) {
    Write-Warning ".venv folder not found! The installer will be incomplete without Python environment."
}

& $ISCC "setup.iss"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Installer created successfully in 'installers' folder!" -ForegroundColor Green
    Invoke-Item "installers"
} else {
    Write-Error "Inno Setup failed!"
    exit $LASTEXITCODE
}
