# Test all 7 MSST bundle models + legacy drumsep_49469 (10s trial clip)
$ErrorActionPreference = "Continue"
$py = "C:\Users\Gaming\AppData\Local\StemSplit\embedded_python\python.exe"
$scriptDir = "D:\Projects\Liminal-StemSplit\stemsplit-desktop_app\StemSplit1-main\scripts"
$env:PYTHONPATH = $scriptDir
$env:STEMSPLIT_MODELS_ROOT = "D:\AudioSeperationModels"
$file = "D:\Rookie Throwback Veteran\b33zy b - CRAZY THOUGHTS PRE.mp3"
$baseOut = "C:\Users\Gaming\AppData\Local\Temp\msst_matrix_test"
$maxDur = 10

$tests = @(
    @{ Name = "demucs_vocals_2023";  Engine = "demucs";   Variant = "demucs_vocals_2023";  Stems = 2 },
    @{ Name = "mdx23c_8k_v2";        Engine = "mdx";       Variant = "mdx23c_8k_v2";        Stems = 2 },
    @{ Name = "roformer_polarformer"; Engine = "roformer"; Variant = "roformer_polarformer"; Stems = 2 },
    @{ Name = "scnet_large";        Engine = "roformer";  Variant = "scnet_large";        Stems = 2 },
    @{ Name = "scnet_xl";            Engine = "roformer";  Variant = "scnet_xl";            Stems = 2 },
    @{ Name = "scnet_xl_ihf";        Engine = "roformer";  Variant = "scnet_xl_ihf";        Stems = 2 },
    @{ Name = "drumsep_mdx23c_5";    Engine = "drumsep";   Variant = "drumsep_mdx23c_5";    Stems = 5 },
    @{ Name = "drumsep_49469";        Engine = "drumsep";   Variant = "drumsep_49469";        Stems = 5 }
)

$results = @()
Push-Location $scriptDir
foreach ($t in $tests) {
    $out = Join-Path $baseOut $t.Name
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    New-Item -ItemType Directory -Path $out -Force | Out-Null

    Write-Host "`n=== $($t.Name) ===" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $py splitter.py $file `
        --output $out `
        --no-effects `
        --engine $t.Engine `
        --stems $t.Stems `
        --model-variant $t.Variant `
        --trial-mode `
        --max-duration $maxDur 2>$null | Out-Null
    $code = $LASTEXITCODE
    $sw.Stop()

    $status = "NO_MANIFEST"
    $errors = @()
    $stemCount = 0
    $manifest = Join-Path $out "manifest.json"
    if (Test-Path $manifest) {
        $m = Get-Content $manifest -Raw | ConvertFrom-Json
        $status = $m.status
        if ($m.errors) { $errors = @($m.errors) }
        if ($m.stems) { $stemCount = ($m.stems.PSObject.Properties | Measure-Object).Count }
    }
    $wavCount = (Get-ChildItem $out -Filter *.wav -ErrorAction SilentlyContinue | Measure-Object).Count
    $row = [PSCustomObject]@{
        Model    = $t.Name
        ExitCode = $code
        Status   = $status
        Stems    = $stemCount
        Wavs     = $wavCount
        Seconds  = [math]::Round($sw.Elapsed.TotalSeconds, 1)
        Error    = ($errors -join "; ")
    }
    $results += $row
    $color = if ($status -eq "success") { "Green" } else { "Red" }
    Write-Host "$($t.Name): exit=$code status=$status stems=$stemCount wavs=$wavCount ($($row.Seconds)s)" -ForegroundColor $color
    if ($errors.Count -gt 0) { Write-Host "  $($errors -join '; ')" -ForegroundColor Yellow }
}
Pop-Location

Write-Host "`n=== MSST TEST SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
$passed = ($results | Where-Object { $_.Status -eq "success" }).Count
Write-Host "Passed: $passed / $($results.Count)"