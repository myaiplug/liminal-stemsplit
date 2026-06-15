<#
.SYNOPSIS
  Install Ollama + pull the best local LLMs.
  Models: llama3.1:8b, qwen2.5-coder:7b, mistral:7b, deepseek-coder-v2:16b-lite
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── install Ollama ──
$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
if (-not (Test-Path $ollamaExe)) {
  Status "Downloading Ollama (latest)..."
  $installer = Join-Path $env:TEMP "OllamaSetup.exe"
  Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $installer -UseBasicParsing
  Status "Running Ollama installer..."
  Start-Process -Wait -FilePath $installer -ArgumentList "/S"
  Remove-Item $installer -Force
  Start-Sleep -Seconds 3
  Status "Ollama installed"
} else {
  Status "Ollama already installed"
}

# ensure ollama is in PATH and service running
$env:Path = "$env:Path;$env:LOCALAPPDATA\Programs\Ollama"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
  Write-Host "  ⚠ Ollama binary not found in PATH. Add it manually or restart terminal." -ForegroundColor Yellow
  return
}

# start service if not running
$ollamaRunning = $null -ne (Get-Process ollama -ErrorAction SilentlyContinue)
if (-not $ollamaRunning) {
  Status "Starting Ollama service..."
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

# ── pull models ──
$models = @(
  @{ Name = "llama3.1:8b"; Desc = "Best general-purpose chat" }
  @{ Name = "qwen2.5-coder:7b"; Desc = "Best coding assistant" }
  @{ Name = "mistral:7b"; Desc = "Fast, less censored alternative" }
  @{ Name = "deepseek-coder-v2:16b-lite"; Desc = "MOE coder, 128K context (borderline on 8GB VRAM)" }
)

foreach ($m in $models) {
  $check = ollama list 2>$null | Select-String $m.Name
  if ($check) {
    Status "Already pulled: $($m.Name) — $($m.Desc)"
  } else {
    Status "Pulling $($m.Name) — $($m.Desc)..."
    ollama pull $m.Name 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Status "  Downloaded: $($m.Name)"
    } else {
      Write-Host "  ⚠ Failed to pull $($m.Name)" -ForegroundColor Yellow
    }
  }
}

Write-Host "`n  ✓ Ollama ready" -ForegroundColor Green
Write-Host "  → Try:   ollama run llama3.1:8b" -ForegroundColor DarkGray
Write-Host "  → Chat UI: docker run -d -p 3000:8080 ghcr.io/open-webui/open-webui" -ForegroundColor DarkGray
