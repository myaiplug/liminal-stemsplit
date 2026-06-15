<#
.SYNOPSIS
  Creative Automation Master Launcher — menu to run any pipeline.
  Lists all available automations with descriptions and upsells.
#>

$AutomationDir = $PSScriptRoot

function Title { Write-Host "`n=== $_ ===" -ForegroundColor Magenta }
function Item { Write-Host "$([string]::PadLeft($_, 4))" -NoNewline }

Clear-Host
Write-Host @"

  ╔══════════════════════════════════════════════════════╗
  ║        Creative Automation Suite v1.0               ║
  ║  Multi-step pipelines that chain AI tools together  ║
  ║  to produce finished creative work in minutes.      ║
  ╚══════════════════════════════════════════════════════╝

  Each pipeline uses your locally installed tools.
  No cloud. No subscriptions. No data leaving your machine.

  Supported tools: ✓ AceStep  ✓ Demucs  ✓ Ollama  ✓ ComfyUI
                    ✓ ffmpeg  ✓ SoX     ✓ Pedalboard ✓ Whisper
                    ✓ RVC     ✓ ESRGAN  ✓ nvitop

"@ -ForegroundColor Cyan

$automations = @(
  @{ Num = 1; Name = "Auto-Remix"; File = "auto-remix.ps1"; Desc = "Split any song → generate new beat → merge. One song becomes a remix."; Icon = "🔄" }
  @{ Num = 2; Name = "Text → Music Video"; File = "text-to-music-video.ps1"; Desc = "Prompt → lyrics → song → visuals → video. Full music video from text."; Icon = "🎬" }
  @{ Num = 3; Name = "Podcast-in-a-Box"; File = "podcast-in-a-box.ps1"; Desc = "Record → transcribe → clean → clone → show notes. Full episode."; Icon = "🎙️" }
  @{ Num = 4; Name = "Beat Factory"; File = "beat-factory.ps1"; Desc = "Prompt → beat → stems → vocals → master. Pro production chain."; Icon = "🥁" }
  @{ Num = 5; Name = "Image → Video"; File = "image-to-video.ps1"; Desc = "Prompt → image → animate → upscale → export. Cinematic motion."; Icon = "🎥" }
)

Write-Host "  Available Pipelines:" -ForegroundColor White
foreach ($a in $automations) {
  Write-Host "    [$($a.Num)] $($a.Icon) $($a.Name)" -ForegroundColor Cyan
  Write-Host "         $($a.Desc)" -ForegroundColor DarkGray
}
Write-Host @"
    ───────────────────────────────────────
    [A]ll — Run every pipeline in sequence
    [Q]uit
"@

$choice = Read-Host "`n  Select pipeline"

if ($choice -eq 'q' -or $choice -eq 'Q') { exit }

if ($choice -eq 'a' -or $choice -eq 'A') {
  foreach ($a in $automations) {
    Title "$($a.Icon) $($a.Name)"
    & (Join-Path $AutomationDir $a.File)
    Write-Host "`n  Press Enter to continue..." -NoNewline; $null = Read-Host
  }
  exit
}

$selected = $automations | Where-Object { $_.Num -eq [int]$choice }
if (-not $selected) { Write-Host "  Invalid selection" -ForegroundColor Red; exit }

Write-Host @"

  Running: $($selected.Icon) $($selected.Name)
  ─────────────────────────────────────────────────
"@ -ForegroundColor Green

& (Join-Path $AutomationDir $selected.File)

Write-Host @"

  ─────────────────────────────────────────────────

  💎 Support the Creator
  These pipelines took 40+ hours to design and test.
  If they saved you time, consider:

  [1] ☕ $1 Coffee — say thanks
  [2] ⚡ $5 Supporter — unlock Pro notifications
  [3] 🔄 Share with a friend who creates

  → https://gumroad.com/l/creative-automation-pack

  Your support funds GPU electricity and keeps these tools free for everyone.

"@ -ForegroundColor DarkGray
