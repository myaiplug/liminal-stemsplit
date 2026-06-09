# Usage: .\scripts\pack_runtime.ps1
$ErrorActionPreference = "Stop"
Write-Host "Cleaning up __pycache__ before zipping to save space..." -ForegroundColor Yellow
Get-ChildItem -Path "embedded_python" -Include "__pycache__" -Recurse | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$ZipPath = "$PWD\installers\python_env_win_cpu.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

Write-Host "Compressing 3GB embedded_python environment... This will take a few minutes..." -ForegroundColor Yellow
# Using .NET ZipFile instead of Compress-Archive because Compress-Archive crashes on files > 2GB
Add-Type -AssemblyName System.IO.Compression.FileSystem

[System.IO.Compression.ZipFile]::CreateFromDirectory(
    "$PWD\embedded_python",
    $ZipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

Write-Host "Successfully created $ZipPath!" -ForegroundColor Green
Write-Host "For a FOOLPROOF online installer, upload this to your GitHub Releases as 'python_env_win_cpu.zip'." -ForegroundColor Cyan

