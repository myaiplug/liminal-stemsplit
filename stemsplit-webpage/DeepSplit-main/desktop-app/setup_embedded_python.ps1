
# Usage: .\setup_embedded_python.ps1

param(
    [switch]$RepairIfNeeded,
    [switch]$ForceReinstall
)

$ErrorActionPreference = "Stop"

$PYTHON_VERSION = "3.10.11"
$PYTHON_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-amd64.zip"
$PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
$EMBED_DIR = "embedded_python"
$TORCH_VERSION = "2.5.1"
$DEMUCS_VERSION = "4.0.1"
$DIAGNOSTICS_PATH = "installers\python_runtime_setup_report.json"
$RUNTIME_MARKER_PATH = "$EMBED_DIR\python_runtime_ready.json"
$REQUIRED_IMPORTS = @("torch", "demucs", "librosa", "soundfile", "numpy")
$OPTIONAL_IMPORTS = @("pedalboard", "pydub", "psutil", "pynvml", "sounddevice", "pyloudnorm", "yt_dlp", "whisper")

function Write-Diagnostics {
    param([hashtable]$Data)

    $dir = Split-Path -Parent $DIAGNOSTICS_PATH
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $Data | ConvertTo-Json -Depth 8 | Set-Content -Path $DIAGNOSTICS_PATH -Encoding UTF8
}

function Invoke-WithRetry {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$Label,
        [int]$MaxAttempts = 3,
        [int]$DelaySeconds = 3
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            & $Action
            return
        } catch {
            if ($attempt -ge $MaxAttempts) {
                throw "$Label failed after $MaxAttempts attempts. Last error: $($_.Exception.Message)"
            }
            Write-Warning "$Label failed on attempt $attempt/$MaxAttempts. Retrying in $DelaySeconds seconds..."
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Get-MissingImports {
    param([string[]]$Modules)

    $missing = @()
    foreach ($module in $Modules) {
        & "$EMBED_DIR\python.exe" -c "import $module" *> $null
        if ($LASTEXITCODE -ne 0) {
            $missing += $module
        }
    }
    return $missing
}

function Test-EmbeddedRuntimeReady {
    if (-not (Test-Path "$EMBED_DIR\python.exe")) {
        return $false
    }

    $missing = Get-MissingImports -Modules $REQUIRED_IMPORTS
    return $missing.Count -eq 0
}

function Invoke-PythonInstallStep {
    param(
        [string]$Label,
        [string[]]$Arguments,
        [switch]$BestEffort
    )

    Invoke-WithRetry -Label $Label -Action {
        Write-Host $Label -ForegroundColor Yellow
        & "$EMBED_DIR\python.exe" @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Label failed with exit code $LASTEXITCODE"
        }
    }
    if ($BestEffort) {
        return
    }
}

function Get-RuntimeFingerprint {
    $anchorPaths = @(
        "$EMBED_DIR\python.exe",
        "$EMBED_DIR\python310._pth",
        "$EMBED_DIR\Lib\site-packages\torch\__init__.py",
        "$EMBED_DIR\Lib\site-packages\demucs\__init__.py",
        "$EMBED_DIR\Lib\site-packages\librosa\__init__.py",
        "$EMBED_DIR\Lib\site-packages\soundfile.py",
        "$EMBED_DIR\Lib\site-packages\numpy\__init__.py"
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($path in $anchorPaths) {
            if (-not (Test-Path $path)) {
                throw "Runtime fingerprint anchor missing: $path"
            }
            $fullPathBytes = [System.Text.Encoding]::UTF8.GetBytes((Resolve-Path $path).Path)
            $null = $sha.TransformBlock($fullPathBytes, 0, $fullPathBytes.Length, $null, 0)
            $separator = [byte[]](0)
            $null = $sha.TransformBlock($separator, 0, $separator.Length, $null, 0)

            $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $path).Path)
            $null = $sha.TransformBlock($bytes, 0, $bytes.Length, $null, 0)
            $null = $sha.TransformBlock($separator, 0, $separator.Length, $null, 0)
        }

        $sha.TransformFinalBlock(@(), 0, 0) | Out-Null
        return [BitConverter]::ToString($sha.Hash).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Write-RuntimeMarker {
    $fingerprint = Get-RuntimeFingerprint
    $marker = @{
        fingerprint = $fingerprint
        required_modules = $REQUIRED_IMPORTS
        created_at = (Get-Date).ToString("o")
    }
    $marker | ConvertTo-Json -Depth 6 | Set-Content -Path $RUNTIME_MARKER_PATH -Encoding UTF8
}

Write-Host "Setting up Embedded Python Environment..." -ForegroundColor Cyan

$diagnostics = @{
    startedAt = (Get-Date).ToString("o")
    embedDir = (Resolve-Path .).Path + "\$EMBED_DIR"
    mode = if ($ForceReinstall) { "force-reinstall" } elseif ($RepairIfNeeded) { "repair-if-needed" } else { "standard" }
    steps = @()
    requiredImportsMissing = @()
    optionalImportsMissing = @()
}

if ($ForceReinstall -and (Test-Path $EMBED_DIR)) {
    Write-Host "ForceReinstall enabled. Removing existing embedded runtime..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $EMBED_DIR
}

if ($RepairIfNeeded -and (Test-Path "$EMBED_DIR\python.exe") -and (Test-EmbeddedRuntimeReady)) {
    Write-Host "Embedded runtime is already healthy. No repair needed." -ForegroundColor Green
    $diagnostics.steps += "Runtime already healthy; setup skipped"
    $diagnostics.requiredImportsMissing = @()
    $diagnostics.optionalImportsMissing = Get-MissingImports -Modules $OPTIONAL_IMPORTS
    $diagnostics.finishedAt = (Get-Date).ToString("o")
    $diagnostics.status = "ok"
    Write-RuntimeMarker
    Write-Diagnostics -Data $diagnostics
    Write-Host "Diagnostics written to $DIAGNOSTICS_PATH" -ForegroundColor DarkCyan
    exit 0
}

# 1. Download and Extract Python Embed
if (-not (Test-Path $EMBED_DIR)) {
    Write-Host "Downloading Python $PYTHON_VERSION Embed..." -ForegroundColor Yellow
    Invoke-WithRetry -Label "Download Python embed" -Action {
        Invoke-WebRequest -Uri $PYTHON_URL -OutFile "python_embed.zip"
    }
    
    Write-Host "Extracting..." -ForegroundColor Yellow
    Expand-Archive -Path "python_embed.zip" -DestinationPath $EMBED_DIR -Force
    Remove-Item "python_embed.zip"
    $diagnostics.steps += "Downloaded and extracted Python embed"
} else {
    Write-Host "Python embed folder already exists. Skipping download." -ForegroundColor Green
    $diagnostics.steps += "Python embed already present"
}

# 2. Configure python._pth to allow importing site-packages
# This is CRITICAL for pip and installed packages to work
$pthFile = Get-ChildItem "$EMBED_DIR\*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    if ($content -notcontains "import site") {
        Write-Host "Enabling 'import site' in $($pthFile.Name)..." -ForegroundColor Yellow
        # Uncomment 'import site' line
        $content = $content -replace "#import site", "import site"
        $content | Set-Content $pthFile.FullName
    }
}

# 3. Install Pip
if (-not (Test-Path "$EMBED_DIR\Scripts\pip.exe")) {
    Write-Host "Installing pip..." -ForegroundColor Yellow
    Invoke-WithRetry -Label "Download get-pip.py" -Action {
        Invoke-WebRequest -Uri $PIP_URL -OutFile "$EMBED_DIR\get-pip.py"
    }
    
    # Run get-pip with the embedded python
    Invoke-WithRetry -Label "Install pip bootstrap" -Action {
        & "$EMBED_DIR\python.exe" "$EMBED_DIR\get-pip.py" --no-warn-script-location
        if ($LASTEXITCODE -ne 0) {
            throw "pip bootstrap failed with exit code $LASTEXITCODE"
        }
    }
    
    Remove-Item "$EMBED_DIR\get-pip.py"
    $diagnostics.steps += "Installed pip"
}

# 4. Install stable runtime packages in stages
Invoke-PythonInstallStep "Upgrading pip tooling..." @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "--no-warn-script-location", "--no-cache-dir")

$torchInstalled = $false
try {
    Invoke-PythonInstallStep "Installing stable CPU PyTorch runtime..." @("-m", "pip", "install", "torch==$TORCH_VERSION+cpu", "--index-url", "https://download.pytorch.org/whl/cpu", "--no-warn-script-location", "--no-cache-dir")
    $torchInstalled = $true
} catch {
    Write-Warning "CPU wheel channel install failed. Falling back to standard PyPI torch==$TORCH_VERSION"
    Invoke-PythonInstallStep "Installing fallback PyTorch runtime..." @("-m", "pip", "install", "torch==$TORCH_VERSION", "--no-warn-script-location", "--no-cache-dir")
    $torchInstalled = $true
}

Invoke-PythonInstallStep "Installing Demucs core..." @("-m", "pip", "install", "demucs==$DEMUCS_VERSION", "--no-warn-script-location", "--no-cache-dir")

Invoke-PythonInstallStep "Installing core audio libraries..." @("-m", "pip", "install", "librosa", "soundfile", "numpy", "resampy", "tqdm", "--no-warn-script-location", "--no-cache-dir")

try {
    Invoke-PythonInstallStep "Installing optional enhancement packages..." @("-m", "pip", "install", "pedalboard>=0.8.0", "pydub>=0.25.1", "pynvml", "psutil", "sounddevice", "pyloudnorm", "audio-separator[cpu]", "yt-dlp", "openai-whisper", "--no-warn-script-location", "--no-cache-dir") -BestEffort
} catch {
    Write-Warning "Optional enhancement packages install failed: $($_.Exception.Message)"
}

& "$EMBED_DIR\python.exe" -m pip cache purge

$missingRequired = Get-MissingImports -Modules $REQUIRED_IMPORTS
$missingOptional = Get-MissingImports -Modules $OPTIONAL_IMPORTS

$diagnostics.requiredImportsMissing = $missingRequired
$diagnostics.optionalImportsMissing = $missingOptional
$diagnostics.steps += "Installed runtime packages"
$diagnostics.steps += if ($torchInstalled) { "PyTorch installed" } else { "PyTorch install uncertain" }

# 5. Cleanup
# Remove unneeded files from embed (like tcl/tk if present, though embed usually doesn't have them)
# Remove __pycache__
Write-Host "Cleaning up..." -ForegroundColor Yellow
Get-ChildItem -Path $EMBED_DIR -Include "__pycache__" -Recurse | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

if ($missingRequired.Count -gt 0) {
    $diagnostics.status = "failed"
    $diagnostics.finishedAt = (Get-Date).ToString("o")
    Write-Diagnostics -Data $diagnostics
    throw "Embedded runtime is incomplete. Missing required modules: $($missingRequired -join ', '). Diagnostics: $DIAGNOSTICS_PATH"
}

$diagnostics.status = "ok"
$diagnostics.finishedAt = (Get-Date).ToString("o")
Write-RuntimeMarker
Write-Diagnostics -Data $diagnostics

if ($missingOptional.Count -gt 0) {
    Write-Warning "Embedded Python ready with optional modules missing: $($missingOptional -join ', ')"
}

Write-Host "Embedded Python Environment Ready!" -ForegroundColor Green
Write-Host "Diagnostics written to $DIAGNOSTICS_PATH" -ForegroundColor DarkCyan
