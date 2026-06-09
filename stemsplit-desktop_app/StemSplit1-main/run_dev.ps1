# Run NoDAW: Splice in Development Mode
# Ensures environment is set up and services are started

param(
    [switch]$InstallDeps
)

# 1. Python Environment Check
$venvPath = ".venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "Python virtual environment not found. Creating..." -ForegroundColor Yellow
    .\scripts\setup_python_env.ps1
} elseif ($InstallDeps) {
    Write-Host "Forcing dependency install..." -ForegroundColor Yellow
    .\scripts\setup_python_env.ps1
} else {
    Write-Host "Python environment detected." -ForegroundColor Green
}

# Add venv to PATH so spawned processes use it
$venvScripts = Join-Path $venvPath "Scripts"
if (Test-Path $venvScripts) {
    Write-Host "Activating Python environment..." -ForegroundColor Cyan
    $env:PATH = "$venvScripts;$env:PATH"
}

# 2. Frontend Dependencies Check
if (-not (Test-Path "node_modules")) {
    Write-Host "Node modules not found. Installing..." -ForegroundColor Yellow
    npm install
}

# 3. Launch Application
Write-Host "Launching NoDAW: Splice..." -ForegroundColor Cyan
npm run tauri dev
