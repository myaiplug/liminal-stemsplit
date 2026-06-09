# Scan C:/ and D:/ for .vst3 plugins and emit a JSON manifest.
# Bundle folders are preferred over inner binaries.

param(
    [string[]]$Drives = @('C:\', 'D:\'),
    [string]$OutPath = "scripts\discovered_vsts.json"
)

$ErrorActionPreference = "Stop"
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$bundles = New-Object System.Collections.Generic.List[object]

foreach ($drive in $Drives) {
    if (-not (Test-Path $drive)) { continue }
    Write-Host "Scanning $drive ..."
    Get-ChildItem -Path $drive -Recurse -Filter *.vst3 -ErrorAction SilentlyContinue -Force | ForEach-Object {
        $isBundle = $_.PSIsContainer
        if (-not $isBundle) {
            # Skip inner binaries when parent bundle will be collected separately
            if ($_.FullName -match '\\Contents\\(x86_64-win|x86-win|Win64|MacOS)\\') { return }
        }
        if (-not $seen.Add($_.FullName)) { return }
        $bundles.Add([ordered]@{
            name     = if ($isBundle) { $_.BaseName } else { $_.BaseName }
            path     = $_.FullName
            type     = if ($isBundle) { "bundle" } else { "binary" }
            modified = $_.LastWriteTime.ToString("o")
        })
    }
}

$manifest = [ordered]@{
    scanned_at = (Get-Date).ToUniversalTime().ToString("o")
    drives     = $Drives
    count      = $bundles.Count
    plugins    = ($bundles | Sort-Object { $_.path })
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $OutPath -Encoding UTF8
Write-Host "Wrote $($bundles.Count) plugins to $OutPath" -ForegroundColor Green
$manifest.plugins | Format-Table name, type, path -AutoSize