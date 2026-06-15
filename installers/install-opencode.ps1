<#
.SYNOPSIS
  Install OpenCode CLI — the AI coding agent that runs in your terminal.
#>

$ErrorActionPreference = "Stop"

function Status { Write-Host "  → $_" -ForegroundColor Cyan }

# detect package manager
$hasWinGet = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
$hasScoop = $null -ne (Get-Command scoop -ErrorAction SilentlyContinue)
$hasNpm = $null -ne (Get-Command npm -ErrorAction SilentlyContinue)

# check if already installed
$installed = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
if ($installed) {
  $ver = (opencode --version 2>$null) -join ' '
  Status "OpenCode already installed ($ver)"
  Write-Host "  ✓ OpenCode ready" -ForegroundColor Green
  return
}

Status "Installing OpenCode..."

# Strategy: try winget first, then npm, then manual
if ($hasWinGet) {
  winget install opencode -e --accept-source-agreements 2>&1 | Out-Null
  $installed = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
  if ($installed) { Status "Installed via winget" }
}

if (-not $installed -and $hasNpm) {
  npm install -g @opencode/cli 2>&1 | Out-Null
  $installed = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
  if ($installed) { Status "Installed via npm" }
}

if (-not $installed) {
  # manual: download latest release binary
  Status "Downloading OpenCode latest release..."
  $releases = "https://api.github.com/repos/anomalyco/opencode/releases/latest"
  try {
    $releaseInfo = Invoke-RestMethod -Uri $releases -UseBasicParsing
    # find windows asset
    $asset = $releaseInfo.assets | Where-Object { $_.name -like "*windows*" -or $_.name -like "*win*" } | Select-Object -First 1
    if (-not $asset) { $asset = $releaseInfo.assets | Select-Object -First 1 }
    if ($asset) {
      $dest = Join-Path $env:TEMP $asset.name
      Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing
      $exeDir = "$env:USERPROFILE\.opencode\bin"
      $null = New-Item -ItemType Directory -Path $exeDir -Force
      if ($asset.name -like "*.zip") {
        Expand-Archive -Path $dest -DestinationPath $exeDir -Force
      } else {
        Move-Item -Path $dest -Destination (Join-Path $exeDir "opencode.exe") -Force
      }
      $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
      if ($userPath -notlike "*$exeDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$exeDir", "User")
      }
      Status "OpenCode installed to $exeDir"
    }
  } catch {
    Write-Host "  ⚠ Manual download failed: $_" -ForegroundColor Yellow
    Write-Host "  → Install manually: https://opencode.ai/docs/installation" -ForegroundColor DarkGray
  }
}

$finalCheck = $null -ne (Get-Command opencode -ErrorAction SilentlyContinue)
if ($finalCheck) {
  Write-Host "  ✓ OpenCode ready — run 'opencode' in any project directory" -ForegroundColor Green
} else {
  Write-Host "  ⚠ OpenCode not found in PATH. Restart your terminal and try 'opencode'." -ForegroundColor Yellow
}
