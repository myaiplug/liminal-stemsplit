# Professional Installer Builder — Liminal StemSplit v0.4.7
# Supports Windows (MSI/NSIS), macOS (DMG), Linux (AppImage/DEB/RPM)
param(
    [ValidateSet('all','windows','macos','linux')]
    [string]$Target = 'all',
    [switch]$SkipBuild,
    [switch]$Online
)

$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot
$TIMESTAMP = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host @"

╔══════════════════════════════════════════════════════════════╗
║        Liminal™ StemSplit v0.4.7 — Professional Build       ║
║        AI Audio Extraction Studio                            ║
╚══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

# ── Step 1: Verify prerequisites ──────────────────────────────
Write-Host "[1/6] Verifying prerequisites..." -ForegroundColor Yellow

$prereqs = @(
    @{Name="Node.js"; Test={Get-Command node -ErrorAction SilentlyContinue}},
    @{Name="Rust/Cargo"; Test={Get-Command cargo -ErrorAction SilentlyContinue}},
    @{Name="Python 3.10+"; Test={& python --version 2>&1 | Select-String "Python 3"}},
    @{Name="Tauri CLI"; Test={Get-Command cargo-tauri -ErrorAction SilentlyContinue}}
)

foreach ($p in $prereqs) {
    if (& $p.Test) {
        Write-Host "  ✓ $($p.Name)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $($p.Name) — required" -ForegroundColor Red
        if ($p.Name -eq "Tauri CLI") {
            Write-Host "     Install: cargo install tauri-cli --version '^2'" -ForegroundColor Yellow
        }
    }
}

# ── Step 2: Build frontend ─────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "`n[2/6] Building frontend (Next.js)..." -ForegroundColor Yellow
    Push-Location $ROOT
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
    Pop-Location
    Write-Host "  ✓ Frontend built" -ForegroundColor Green
}

# ── Step 3: Build backend ──────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "`n[3/6] Building Rust backend..." -ForegroundColor Yellow
    Push-Location "$ROOT/src-tauri"
    cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "Rust build failed" }
    Pop-Location
    Write-Host "  ✓ Rust binary built" -ForegroundColor Green
}

# ── Step 4: Package Tauri bundle ───────────────────────────────
Write-Host "`n[4/6] Creating Tauri bundle..." -ForegroundColor Yellow
Push-Location "$ROOT/src-tauri"
$tauriArgs = @("tauri", "build")
if ($Target -eq 'windows') { $tauriArgs += "--target", "x86_64-pc-windows-msvc" }
elseif ($Target -eq 'macos') { $tauriArgs += "--target", "x86_64-apple-darwin" }

cargo tauri build --bundles all
if ($LASTEXITCODE -ne 0) { throw "Tauri bundle failed" }
Pop-Location

# Find the bundle output
$bundleDir = Get-ChildItem "$ROOT/src-tauri/target/release/bundle" -Directory | Select-Object -First 1
if (-not $bundleDir) {
    $bundleDir = "$ROOT/src-tauri/target/release/bundle"
}
Write-Host "  ✓ Bundle created" -ForegroundColor Green

# ── Step 5: Generate checksums ─────────────────────────────────
Write-Host "`n[5/6] Generating checksums..." -ForegroundColor Yellow
$checksumDir = "$ROOT/installers/checksums"
New-Item -ItemType Directory -Path $checksumDir -Force | Out-Null

Get-ChildItem -Path $bundleDir -Recurse -File | Where-Object {
    $_.Extension -match '\.(exe|msi|dmg|AppImage|deb|rpm|zip|tar\.gz)$'
} | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)" | Out-File -FilePath "$checksumDir/checksums-$TIMESTAMP.sha256" -Encoding UTF8 -Append
    Write-Host "  ✓ $($_.Name)" -ForegroundColor Green
}

# ── Step 6: Summary ────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════════════════════╗
║                     BUILD COMPLETE                          ║
╚══════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Green

Write-Host "Bundle output:" -ForegroundColor Cyan
Get-ChildItem $bundleDir -Recurse -File | Where-Object {
    $_.Extension -match '\.(exe|msi|dmg|AppImage|deb|rpm)$'
} | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  • $($_.Name) ($size MB)" -ForegroundColor White
}

Write-Host "`nChecksums: $checksumDir" -ForegroundColor Cyan

Write-Host @"

Next steps:
  1. Sign the executables (Windows: signtool, macOS: codesign)
  2. Upload to GitHub Releases
  3. Distribute!

"@ -ForegroundColor Yellow
