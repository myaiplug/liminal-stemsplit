<#
.SYNOPSIS
  Install Docker Desktop + WSL2 — container runtime for Open WebUI, LocalAI, etc.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. Check WSL2 ──
$wslInstalled = $null -ne (Get-Command wsl -ErrorAction SilentlyContinue)
if (-not $wslInstalled) {
  Status "Installing WSL2..."
  wsl --install --no-distribution 2>&1 | Out-Null
  wsl --set-default-version 2 2>&1 | Out-Null
  Status "  WSL2 enabled"
} else {
  Status "WSL2 already installed"
}

# ── 2. Install Docker Desktop ──
$dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
  Status "Downloading Docker Desktop (latest)..."
  $installer = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
  $url = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 120
    Status "Running Docker Desktop installer..."
    Start-Process -Wait -FilePath $installer -ArgumentList "install", "--quiet", "--accept-license"
    Remove-Item $installer -Force
    Status "  Docker Desktop installed"
  } catch {
    Write-Host "  ⚠ Docker download failed: $_" -ForegroundColor Yellow
    Write-Host "  → Download manually from https://www.docker.com/products/docker-desktop/" -ForegroundColor DarkGray
  }
} else {
  Status "Docker Desktop already installed"
}

# ── 3. Pull useful AI containers ──
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCmd) {
  # try to start Docker
  Status "Starting Docker Desktop (this may take a moment)..."
  Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" -WindowStyle Hidden
  Start-Sleep -Seconds 10

  $images = @(
    @{ Name = "ghcr.io/open-webui/open-webui:main"; Desc = "Chat UI for Ollama" }
    @{ Name = "ghcr.io/mudler/localai:latest"; Desc = "LocalAI (LLM + TTS + Image API)" }
  )
  
  foreach ($img in $images) {
    $pulled = docker images -q $img.Name 2>$null
    if (-not $pulled) {
      Status "Pulling $($img.Desc)..."
      docker pull $img.Name 2>&1 | Out-Null
      Status "  $($img.Desc) pulled"
    } else { Status "Container already cached: $($img.Desc)" }
  }
  
  Status "  Docker containers ready"
}

Write-Host "`n  ✓ Docker + WSL2 ready" -ForegroundColor Green
Write-Host "  → Open WebUI: docker run -d -p 3000:8080 ghcr.io/open-webui/open-webui:main" -ForegroundColor DarkGray
Write-Host "  → LocalAI:    docker run -d -p 8080:8080 ghcr.io/mudler/localai:latest" -ForegroundColor DarkGray
