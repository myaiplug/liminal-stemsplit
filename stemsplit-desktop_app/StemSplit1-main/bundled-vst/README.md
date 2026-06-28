# Bundled VST payload

The Windows installer copies `ReVerb-DeGloss.vst3` to `{app}\VST\ReVerb-DeGloss.vst3`.

Before building the installer, stage the plugin:

```powershell
.\scripts\stage_bundled_vst.ps1
```

Or set `STEMSPLIT_VST_SOURCE` to the folder path of your local `.vst3` bundle.

The folder is gitignored; run the stage script on each machine that builds installers.