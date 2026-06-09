@echo off
echo ====================================
echo StemSplit Installer Build Script
echo ====================================
echo.

cd /d "%~dp0"

echo Checking required components...
if not exist "embedded_python\python.exe" (
    echo ERROR: embedded_python folder not found. Run setup_embedded_python.ps1 first.
    pause
    exit /b 1
)

if not exist "ffmpeg\bin\ffmpeg.exe" (
    echo ERROR: ffmpeg folder not found. Download FFmpeg first.
    pause
    exit /b 1
)

if not exist "src-tauri\target\release\StemSplit.exe" (
    echo Building Tauri application...
    call npm run tauri build
    if errorlevel 1 (
        echo ERROR: Tauri build failed.
        pause
        exit /b 1
    )
)

echo.
echo All components ready. Building installer...
echo This may take 10-15 minutes due to the large Python environment.
echo.

"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss

if errorlevel 1 (
    echo.
    echo ERROR: Installer build failed!
    pause
    exit /b 1
)

echo.
echo ====================================
echo SUCCESS! Installer created at:
echo installers\StemSplit_Setup_x64.exe
echo ====================================
echo.
pause
