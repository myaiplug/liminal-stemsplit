param(
    [Parameter(Mandatory = $true)][string]$CertPath,
    [Parameter(Mandatory = $true)][string]$CertPassword,
    [Parameter(Mandatory = $true)][string[]]$Files,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Resolve-SignToolPath {
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($signtool) {
        return $signtool.Source
    }

    $candidates = @(
        "${Env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\signtool.exe",
        "${Env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
        "${Env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    throw "signtool.exe was not found. Install Windows SDK signing tools."
}

function Expand-FilePatterns {
    param([string[]]$Patterns)

    $expanded = @()
    foreach ($pattern in $Patterns) {
        $items = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue
        if ($items) {
            $expanded += $items.FullName
        } elseif (Test-Path $pattern) {
            $expanded += (Resolve-Path $pattern).Path
        }
    }

    $unique = $expanded | Sort-Object -Unique
    if (-not $unique -or $unique.Count -eq 0) {
        throw "No files matched for signing."
    }

    return $unique
}

if (-not (Test-Path $CertPath)) {
    throw "Certificate file not found: $CertPath"
}

$signtoolPath = Resolve-SignToolPath
$targets = Expand-FilePatterns -Patterns $Files

Write-Host "Using signtool: $signtoolPath"
Write-Host "Signing $($targets.Count) file(s)..."

foreach ($file in $targets) {
    Write-Host "[Sign] $file"
    $args = @(
        "sign",
        "/f", $CertPath,
        "/p", $CertPassword,
        "/fd", "SHA256",
        "/td", "SHA256",
        "/tr", $TimestampUrl,
        $file
    )

    & $signtoolPath @args
    if ($LASTEXITCODE -ne 0) {
        throw "Signing failed for: $file"
    }

    & $signtoolPath verify /pa /v $file | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Signature verification failed for: $file"
    }
}

Write-Host "Signing completed successfully."
