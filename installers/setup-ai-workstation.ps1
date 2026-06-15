#Requires -Version 7.0
<#
.SYNOPSIS
  AI Workstation Setup — installs the strongest local AI tools across every category.
  Run this from an admin PowerShell 7 terminal.
#>

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$LogFile = Join-Path $env:TEMP "ai-workstation-setup.log"
$StartTime = Get-Date

function Log   { $msg = "$(Get-Date -Format 'HH:mm:ss') $_"; Write-Host $msg -ForegroundColor DarkGray; Add-Content -Path $LogFile -Value $msg }
function Ok    { Write-Host "  ✓ $_" -ForegroundColor Green }
function Warn  { Write-Host "  ⚠ $_" -ForegroundColor Yellow }
function Info  { Write-Host "  → $_" -ForegroundColor Cyan }
function Title { Write-Host "`n=== $_ ===" -ForegroundColor Magenta }

Clear-Host
Write-Host @"

  ╔══════════════════════════════════════════════╗
  ║      AI Workstation Setup v1.0              ║
  ║  One-click installer for the best local AI  ║
  ╚══════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

# --- detect GPU ---
$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA|AMD|Intel" } | Select-Object -First 1
$vramGB = if ($gpu.AdapterRAM) { [math]::Round($gpu.AdapterRAM / 1GB, 1) } else { 0 }
$hasCUDA = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($hasCUDA) {
  $cudaVer = (nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null)
  Info "GPU: $($gpu.Name) ($vramGB GB VRAM) | CUDA: $(if($cudaVer){$cudaVer.Trim()}else{'detected'})"
} elseif ($gpu) {
  Warn "GPU: $($gpu.Name) ($vramGB GB VRAM) — CUDA not detected, CPU-only fallback"
} else {
  Warn "No compatible GPU detected — installing CPU-only variants"
}

# --- prerequisites ---
function Ensure-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Warn "Not running as Administrator. Some installers may fail."
    $choice = Read-Host "Continue anyway? (y/N)"
    if ($choice -ne 'y') { exit }
  }
}
Ensure-Admin

# --- modules ---
$modules = @(
  @{ Name = "Audio Tools (ffmpeg, sox, pedalboard, rubberband)"; Script = "install-audio-tools.ps1"; Category = "Media" }
  @{ Name = "Beat Generation (AceStep v1.5)"; Script = "install-acestep.ps1"; Category = "Audio" }
  @{ Name = "Image Generation (ComfyUI, SDXL, FLUX)"; Script = "install-comfyui.ps1"; Category = "Image" }
  @{ Name = "Video Generation (SVD + AnimateDiff)"; Script = "install-video-gen.ps1"; Category = "Image" }
  @{ Name = "Local LLMs (Ollama + llama3.1, qwen-coder, mistral)"; Script = "install-ollama.ps1"; Category = "LLM" }
  @{ Name = "AI Coding (OpenCode CLI)"; Script = "install-opencode.ps1"; Category = "Code" }
  @{ Name = "Stem Splitter + Transcription + TTS"; Script = "install-audio-models.ps1"; Category = "Audio" }
  @{ Name = "MusicGen (Meta AudioCraft)"; Script = "install-musicgen.ps1"; Category = "Audio" }
  @{ Name = "RVC Voice Conversion"; Script = "install-rvc.ps1"; Category = "Audio" }
  @{ Name = "Upscaling (Real-ESRGAN + GFPGAN)"; Script = "install-upscale.ps1"; Category = "Image" }
  @{ Name = "RAG Stack (ChromaDB + Embeddings)"; Script = "install-rag.ps1"; Category = "LLM" }
  @{ Name = "Agent Frameworks (CrewAI, AutoGen)"; Script = "install-agent-frameworks.ps1"; Category = "Agents" }
  @{ Name = "CUDA Toolkit + cuDNN"; Script = "install-cuda.ps1"; Category = "System" }
  @{ Name = "Docker Desktop + WSL2"; Script = "install-docker.ps1"; Category = "System" }
  @{ Name = "GPU Monitoring (nvitop, gpustat)"; Script = "install-gpu-monitor.ps1"; Category = "System" }
)

# --- interactive checklist ---
Write-Host "`nSelect modules to install (default: all):" -ForegroundColor White
$selected = @()
for ($i = 0; $i -lt $modules.Count; $i++) {
  $m = $modules[$i]
  $default = $true
  $prompt = "[$i] $($m.Name)"
  if ($default) { $prompt += " (Y/n)" } else { $prompt += " (y/N)" }
  $resp = Read-Host $prompt
  if ($resp -eq '' -or $resp -match '^[Yy]') { $selected += $m }
}
if ($selected.Count -eq 0) { $selected = $modules.Clone() }

$total = $selected.Count
$current = 0
$failed = @()

Write-Host "`nStarting installation of $total modules..." -ForegroundColor White
Log "=== AI Workstation Setup started ==="

foreach ($m in $selected) {
  $current++
  $scriptPath = Join-Path $ScriptDir $m.Script
  if (-not (Test-Path $scriptPath)) {
    Warn "Script not found: $($m.Script) — skipping"
    continue
  }
  Write-Host "`n----------------------------------------" -ForegroundColor DarkGray
  Title "[$current/$total] $($m.Name)"
  try {
    & $scriptPath
    Ok "$($m.Name) — installed successfully"
    Log "OK: $($m.Name)"
  } catch {
    Warn "$($m.Name) — FAILED: $_"
    Log "FAIL: $($m.Name): $_"
    $failed += $m.Name
  }
}

# --- summary ---
$elapsed = (Get-Date) - $StartTime
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Setup complete in $([math]::Round($elapsed.TotalMinutes, 1)) min" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
  Write-Host "  All $total modules installed successfully!" -ForegroundColor Green
} else {
  Write-Host "  $($failed.Count) module(s) failed:" -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host "    • $_" -ForegroundColor Red }
  Write-Host "  Check $LogFile for details" -ForegroundColor DarkGray
}

Write-Host @"

  ─────────────────────────────────────────────
  Quick start:
    Ollama:              ollama run llama3.1:8b
    Image Gen:           D:\ComfyUI\run_nvidia_gpu.bat  → http://localhost:8188
    Beat Gen:            D:\ACESTEP\ace-step-1.5\start_api_server.bat
    OpenCode:            opencode (in any project dir)
    Stem Splitter:       demucs song.mp3
    Transcription:       whisper audio.mp3 --model large-v3
    RVC Voice Clone:     D:\RVC-WebUI\go-webui.bat  → http://localhost:7865
    GPU Monitor:         nvitop --colorful
  ─────────────────────────────────────────────

"@ -ForegroundColor DarkGray
