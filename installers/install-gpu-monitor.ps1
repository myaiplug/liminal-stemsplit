<#
.SYNOPSIS
  Install GPU monitoring tools: nvitop, gpustat, Windows Terminal profile.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# ── 1. nvitop ──
$nvitopCheck = pip show nvitop 2>$null
if ($nvitopCheck) {
  Status "nvitop already installed"
} else {
  Status "Installing nvitop (best GPU monitor)..."
  pip install nvitop --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  nvitop installed" }
}

# ── 2. gpustat ──
$gpustatCheck = pip show gpustat 2>$null
if ($gpustatCheck) {
  Status "gpustat already installed"
} else {
  Status "Installing gpustat..."
  pip install gpustat --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Status "  gpustat installed" }
}

# ── 3. Windows Terminal profile for nvitop ──
$wtSettings = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
if (Test-Path $wtSettings) {
  $settings = Get-Content $wtSettings -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($settings -and -not ($settings | Select-String -Pattern "nvitop" -SimpleMatch -Quiet)) {
    Status "Adding nvitop GPU monitor profile to Windows Terminal..."
    $profile = @{
      name = "GPU Monitor"
      commandline = "cmd.exe /k nvitop"
      icon = "`u{1F4CA}"
      startingDirectory = "."
    }
    # basic profile add — may need manual JSON editing for complex configs
    Write-Host "  ⚠ Windows Terminal auto-config skipped — add manually:" -ForegroundColor Yellow
    Write-Host "  Settings → Add profile → Command line: nvitop" -ForegroundColor DarkGray
  }
}

# ── 4. nvidia-smi wrapper (one-liner alias) ──
$aliasDir = "$env:USERPROFILE\Documents\PowerShell"
$null = New-Item -ItemType Directory -Path $aliasDir -Force
$aliasFile = Join-Path $aliasDir "Microsoft.PowerShell_profile.ps1"
$aliasLine = "function gpu { nvitop --colorful }"
if (Test-Path $aliasFile) {
  $content = Get-Content $aliasFile -Raw
  if ($content -notlike "*gpu*") {
    Add-Content -Path $aliasFile -Value "`n$aliasLine"
    Status "  PowerShell alias 'gpu' → nvitop added to profile"
  }
} else {
  Set-Content -Path $aliasFile -Value $aliasLine -Encoding UTF8
  Status "  PowerShell profile created with 'gpu' alias for nvitop"
}

Write-Host "`n  ✓ GPU monitoring ready" -ForegroundColor Green
Write-Host "  → Run:  nvitop --colorful" -ForegroundColor DarkGray
Write-Host "  → Run:  gpustat" -ForegroundColor DarkGray
Write-Host "  → Run:  gpu (alias)" -ForegroundColor DarkGray
