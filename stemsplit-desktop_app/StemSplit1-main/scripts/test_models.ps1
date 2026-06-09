# Model test runner
#   Default: smoke test (6 engines, full inference)
#   -ValidateAll: validate all 91+ catalog models (fast, no inference)
#   -InferencePerEngine: run one inference per engine category (12 runs)
param(
    [switch]$ValidateAll,
    [switch]$InferencePerEngine
)

if ($ValidateAll) {
    $env:PYTHONPATH = $PSScriptRoot
    $env:STEMSPLIT_MODELS_ROOT = "D:\AudioSeperationModels"
    & "C:\Users\Gaming\AppData\Local\StemSplit\embedded_python\python.exe" (Join-Path $PSScriptRoot "validate_all_models.py")
    exit $LASTEXITCODE
}

# Quick model matrix smoke test — trial mode, 15s trim
$ErrorActionPreference = "Continue"
$py = "C:\Users\Gaming\AppData\Local\StemSplit\embedded_python\python.exe"
$scriptDir = "D:\Projects\Liminal-StemSplit\stemsplit-desktop_app\StemSplit1-main\scripts"
$env:PYTHONPATH = $scriptDir
$env:STEMSPLIT_MODELS_ROOT = "D:\AudioSeperationModels"
$file = "D:\Rookie Throwback Veteran\b33zy b - CRAZY THOUGHTS PRE.mp3"
$baseOut = "C:\Users\Gaming\AppData\Local\Temp\model_matrix_test"
$maxDur = 15

$tests = @(
    @{ Name = "demucs_htdemucs";     Engine = "demucs";   Variant = "demucs_htdemucs";     Stems = 2 },
    @{ Name = "mdx23_ensemble";      Engine = "mdx";       Variant = "mdx23_ensemble";      Stems = 2 },
    @{ Name = "mdx_kim_vocal_2";     Engine = "mdx";       Variant = "mdx_kim_vocal_2";     Stems = 2 },
    @{ Name = "roformer_melband";    Engine = "roformer";  Variant = "roformer_melband";    Stems = 2 },
    @{ Name = "vr_hp_vocal_4";       Engine = "vr";        Variant = "vr_hp_vocal_4";       Stems = 2 },
    @{ Name = "drumsep_mdx23c_6";    Engine = "drumsep";   Variant = "drumsep_mdx23c_6";    Stems = 7 }
)

$results = @()
Push-Location $scriptDir
foreach ($t in $tests) {
    $out = Join-Path $baseOut $t.Name
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    New-Item -ItemType Directory -Path $out -Force | Out-Null

    Write-Host "`n=== TEST: $($t.Name) ===" -ForegroundColor Cyan
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
    if ($errors.Count -gt 0) { Write-Host "  ERROR: $($errors -join '; ')" -ForegroundColor Yellow }
}
Pop-Location

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
$passed = ($results | Where-Object { $_.Status -eq "success" }).Count
Write-Host "Passed: $passed / $($results.Count)"