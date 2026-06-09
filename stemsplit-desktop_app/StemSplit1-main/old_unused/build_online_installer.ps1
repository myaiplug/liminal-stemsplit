# Build Online Installer (Small installer that downloads during install)
# This creates a ~100MB installer instead of ~3GB

$ErrorActionPreference = "Stop"

Write-Host "Building StemSplit Online Installer..." -ForegroundColor Cyan

# 1. Build the Tauri app
Write-Host "Building Tauri application..." -ForegroundColor Yellow
npm run tauri build

# 2. Check required files exist
$requiredFiles = @(
    "src-tauri\target\release\stem-split.exe",
    "requirements.txt",
    "ss2.ico"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        Write-Error "Missing required file: $file"
        exit 1
    }
}

# 3. Build the installer
Write-Host "Building online installer..." -ForegroundColor Yellow
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup_online.iss

if ($LASTEXITCODE -eq 0) {
    $installer = Get-ChildItem "installers\StemSplit_Online_Setup_x64.exe" -ErrorAction SilentlyContinue
    if ($installer) {
        $sizeMB = [math]::Round($installer.Length / 1MB, 1)
        Write-Host ""
        Write-Host "SUCCESS! Online installer created:" -ForegroundColor Green
        Write-Host "  $($installer.FullName)" -ForegroundColor White
        Write-Host "  Size: $sizeMB MB" -ForegroundColor White
        Write-Host ""
        Write-Host "This installer will download Python packages during installation." -ForegroundColor Cyan
        Write-Host "Users need internet connection during install." -ForegroundColor Yellow
    }
} else {
    Write-Error "Inno Setup compilation failed"
    exit 1
}
