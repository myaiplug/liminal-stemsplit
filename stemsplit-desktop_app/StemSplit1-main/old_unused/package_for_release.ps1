# Package files for GitHub Releases upload
# This creates zip files for the online installer to download

$projectRoot = $PSScriptRoot

Write-Host "=== Packaging files for GitHub Releases ===" -ForegroundColor Cyan

# 1. Package Python environment (largest component)
$pythonDir = Join-Path $projectRoot "embedded_python"
$pythonZip = Join-Path $projectRoot "release_assets\embedded_python.zip"

if (Test-Path $pythonDir) {
    Write-Host "Packaging Python environment..." -ForegroundColor Yellow
    
    # Create release_assets folder
    New-Item -ItemType Directory -Path (Join-Path $projectRoot "release_assets") -Force | Out-Null
    
    # Remove old zip if exists
    if (Test-Path $pythonZip) { Remove-Item $pythonZip -Force }
    
    # Compress - this takes a while due to size
    Write-Host "Compressing embedded_python (~1.8GB -> ~600MB)... This will take several minutes."
    Compress-Archive -Path "$pythonDir\*" -DestinationPath $pythonZip -CompressionLevel Optimal
    
    $zipSize = (Get-Item $pythonZip).Length / 1MB
    Write-Host "Created: embedded_python.zip ($([math]::Round($zipSize, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "ERROR: embedded_python folder not found!" -ForegroundColor Red
    exit 1
}

# 2. Package FFmpeg
$ffmpegDir = Join-Path $projectRoot "ffmpeg"
$ffmpegZip = Join-Path $projectRoot "release_assets\ffmpeg.zip"

if (Test-Path $ffmpegDir) {
    Write-Host "Packaging FFmpeg..." -ForegroundColor Yellow
    if (Test-Path $ffmpegZip) { Remove-Item $ffmpegZip -Force }
    Compress-Archive -Path "$ffmpegDir\*" -DestinationPath $ffmpegZip -CompressionLevel Optimal
    
    $zipSize = (Get-Item $ffmpegZip).Length / 1MB
    Write-Host "Created: ffmpeg.zip ($([math]::Round($zipSize, 1)) MB)" -ForegroundColor Green
}

# 3. Package Models (optional - will be downloaded on first use instead)
$modelsDir = Join-Path $projectRoot "Stem Split Models"
$modelsZip = Join-Path $projectRoot "release_assets\models.zip"

if (Test-Path $modelsDir) {
    Write-Host "Packaging Models (optional)..." -ForegroundColor Yellow
    if (Test-Path $modelsZip) { Remove-Item $modelsZip -Force }
    Compress-Archive -Path "$modelsDir\*" -DestinationPath $modelsZip -CompressionLevel Optimal
    
    $zipSize = (Get-Item $modelsZip).Length / 1MB
    Write-Host "Created: models.zip ($([math]::Round($zipSize, 1)) MB)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Release Assets Ready ===" -ForegroundColor Cyan
Get-ChildItem (Join-Path $projectRoot "release_assets") | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name) - $sizeMB MB"
}

Write-Host ""
Write-Host "Upload these to GitHub Releases:" -ForegroundColor Yellow
Write-Host "  https://github.com/myaiplug/StemSplit1/releases/new"
Write-Host ""
Write-Host "Tag suggestion: v0.1.0-assets"
