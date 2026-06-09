# Runtime Marker Debugging Guide

## Quick Status Check

```powershell
# See current marker state
$marker_path = "embedded_python\python_runtime_ready.json"
if (Test-Path $marker_path) {
    $marker = Get-Content $marker_path | ConvertFrom-Json
    Write-Host "✓ Marker exists"
    Write-Host "  Fingerprint: $($marker.fingerprint.Substring(0,16))..."
    Write-Host "  Created: $($marker.created_at)"
    Write-Host "  Modules: $($marker.required_modules -join ', ')"
} else {
    Write-Host "✗ NO MARKER - Setup will run on next app launch"
}

# Check runtime integrity
$python_exe = "embedded_python\Scripts\python.exe"
if (Test-Path $python_exe) {
    Write-Host "✓ Python executable found"
    & $python_exe --version
} else {
    Write-Host "✗ Python executable missing"
}
```

---

## Marker File Structure

**Location:** `embedded_python\python_runtime_ready.json`

```json
{
  "fingerprint": "a7f3e9c2d1b84f6a9e7c3d2f1a9b8c7e6d5f4a3b2c1d9e8f7a6b5c4d3e2f1a0",
  "created_at": "2025-01-15T14:32:05Z",
  "required_modules": [
    "torch",
    "demucs",
    "librosa",
    "soundfile",
    "numpy"
  ]
}
```

### Fingerprint Algorithm

The fingerprint is a **SHA256 hash** of:

1. **Python Executable** hash:
   - Windows: `embedded_python\Scripts\python.exe`
   - macOS: `embedded_python/bin/python`
   - Linux: `embedded_python/bin/python`

2. **Core Package** `__init__.py` hashes (in order):
   - `torch/__init__.py`
   - `demucs/__init__.py`
   - `librosa/__init__.py`
   - `soundfile/__init__.py`
   - `numpy/__init__.py`

3. **Hash Combination:** `SHA256(python_exe + torch_init + demucs_init + librosa_init + soundfile_init + numpy_init)`

---

## Common Issues & Solutions

### Issue: Marker Not Generated After Setup

**Symptom:** `embedded_python\python_runtime_ready.json` does not exist after running installer

**Debugging Steps:**

1. **Check installer success:**
   ```powershell
   # Did setup complete without errors?
   & ".\setup_embedded_python.ps1" -RepairIfNeeded
   
   # Look for output: "Python runtime setup complete."
   # Should be followed by "Generating runtime marker..."
   ```

2. **Check script logic:**
   ```powershell
   # Does Write-RuntimeMarker function exist?
   Get-Content "setup_embedded_python.ps1" | Select-String "function Write-RuntimeMarker"
   
   # Are both calls present?
   Get-Content "setup_embedded_python.ps1" | Select-String "Write-RuntimeMarker"
   # Should show 2+ results (early exit + final success)
   ```

3. **Check filesystem permissions:**
   ```powershell
   # Can script write to embedded_python directory?
   $test_file = "embedded_python\marker_test.txt"
   "test" | Out-File $test_file
   if (Test-Path $test_file) {
       Remove-Item $test_file
       Write-Host "✓ Write permissions OK"
   } else {
       Write-Host "✗ Write permissions BLOCKED"
   }
   ```

4. **Check hash function:**
   ```powershell
   # Manually run Get-RuntimeFingerprint
   . ".\setup_embedded_python.ps1"  # Source functions
   $fp = Get-RuntimeFingerprint
   if ($fp) {
       Write-Host "✓ Fingerprint generated: $($fp.Substring(0,16))..."
   } else {
       Write-Host "✗ Fingerprint generation FAILED (missing core packages?)"
   }
   ```

**Solution:**

1. Ensure setup completes successfully (check for "setup complete" message)
2. Verify `setup_embedded_python.ps1` contains `Write-RuntimeMarker` calls
3. Run installer with elevated permissions (Admin)
4. Check that all core packages installed: `embedded_python\Lib\site-packages\{torch,demucs,librosa,soundfile,numpy}`

---

### Issue: Marker Exists but App Still Shows Setup Modal

**Symptom:** App runs Python Setup on every launch despite marker present

**Debugging Steps:**

1. **Check marker validity:**
   ```powershell
   $marker = Get-Content "embedded_python\python_runtime_ready.json" | ConvertFrom-Json
   
   # Verify fingerprint is non-empty
   if ($marker.fingerprint -and $marker.fingerprint.Length -eq 64) {
       Write-Host "✓ Fingerprint is valid SHA256"
   } else {
       Write-Host "✗ Fingerprint is invalid"
   }
   
   # Check timestamp
   if ($marker.created_at) {
       [DateTime]::Parse($marker.created_at)
       Write-Host "✓ Timestamp is valid"
   }
   ```

2. **Check fingerprint mismatch:**
   ```
   The app compares:
   - Stored marker.fingerprint
   vs.
   - Current build_python_runtime_fingerprint()
   
   If they don't match, setup will run.
   
   Likely cause: marker was generated with different Python/package state
   ```

3. **Check app logs:**
   ```powershell
   # View diagnostic log
   cat "$env:APPDATA\StemSplit\diagnostic.log" -Tail 100
   
   # Look for lines:
   # "Fast path: trust marker..." = good (skipped checks)
   # "Fingerprint mismatch..." = bad (will re-setup)
   # "Python runtime OK" = good (setup not needed)
   ```

4. **Force marker regeneration:**
   ```powershell
   # Delete marker to trigger fresh generation
   Remove-Item "embedded_python\python_runtime_ready.json" -Force
   
   # Run setup again
   & ".\setup_embedded_python.ps1" -RepairIfNeeded
   
   # Verify new marker created
   cat "embedded_python\python_runtime_ready.json"
   ```

**Solution:**

1. Verify marker fingerprint is 64-char hex string (SHA256)
2. Check app diagnostics for "Fingerprint mismatch" messages
3. Regenerate marker: delete `python_runtime_ready.json` and re-run installer
4. Restart app 2x to confirm marker is now trusted

---

### Issue: Online Installer Creates Marker, Offline Installer Doesn't

**Symptom:** 
- Online installer adds marker ✓
- Offline/portable installer missing marker ✗

**Debugging Steps:**

1. **Check offline build script:**
   ```powershell
   # Does build script call setup_embedded_python.ps1?
   Get-Content "build_complete_installer.ps1" | Select-String "setup_embedded_python"
   
   # Should invoke with -RepairIfNeeded to trigger marker generation
   ```

2. **Check packaging logic:**
   ```powershell
   # If using InnoSetup (.iss file), verify it runs setup script:
   Get-Content "setup.iss" | Select-String "setup_embedded_python"
   
   # Should have line: Filename: "{code:GetPythonPath|setup_embedded_python.ps1}"
   ```

3. **Test offline build:**
   ```powershell
   # Build installer
   & ".\build_complete_installer.ps1"
   
   # Check if marker embedded
   # (InnoSetup packages files from embedded_python/ directory)
   # Unzip installer CAB to inspect
   ```

**Solution:**

1. Update `build_complete_installer.ps1` to call `setup_embedded_python.ps1 -RepairIfNeeded` before packaging
2. Ensure InnoSetup script includes marker file in `[Files]` section
3. Add post-build validation: verify marker exists in output installer

---

### Issue: Deep Repair Regenerates Marker, But Fingerprint Still Doesn't Match

**Symptom:** 
- Deep Repair completes successfully
- Marker is regenerated
- But next app launch still shows setup modal

**Debugging Steps:**

1. **Check Deep Repair logs:**
   ```powershell
   # Find Deep Repair execution in diagnostics
   cat "$env:APPDATA\StemSplit\diagnostic.log" | Select-String "Deep Repair"
   
   # Look for stages:
   # "Clearing broken runtime state"
   # "Staged attempt 1/2: primary PyPI"
   # "Staged attempt 2/2: mirror PyPI"
   # "Generated runtime marker after repair"
   ```

2. **Check marker timestamps:**
   ```powershell
   # Did marker get updated after Deep Repair?
   $marker = Get-Content "embedded_python\python_runtime_ready.json" | ConvertFrom-Json
   Write-Host "Marker created: $($marker.created_at)"
   
   # Should be AFTER Deep Repair started
   ```

3. **Verify package integrity post-repair:**
   ```powershell
   # Check all required packages installed
   $python = "embedded_python\Scripts\python.exe"
   & $python -c "import torch, demucs, librosa, soundfile, numpy; print('All modules OK')"
   
   # If any import fails, fingerprint comparison will fail
   ```

4. **Compare fingerprints manually:**
   ```powershell
   # Build current fingerprint
   . ".\setup_embedded_python.ps1"
   $current_fp = Get-RuntimeFingerprint
   
   # Read stored fingerprint
   $marker = Get-Content "embedded_python\python_runtime_ready.json" | ConvertFrom-Json
   $stored_fp = $marker.fingerprint
   
   # Compare
   if ($current_fp -eq $stored_fp) {
       Write-Host "✓ Fingerprints MATCH"
   } else {
       Write-Host "✗ Fingerprints MISMATCH"
       Write-Host "  Current:  $current_fp"
       Write-Host "  Stored:   $stored_fp"
   }
   ```

**Solution:**

1. Verify all core packages installed: `torch`, `demucs`, `librosa`, `soundfile`, `numpy`
2. Check that package `__init__.py` files exist in `site-packages`
3. Manually regenerate marker: `.\setup_embedded_python.ps1 -RepairIfNeeded`
4. If mismatch persists, wipe embedded_python and run full setup from scratch

---

## Marker Lifecycle Flowchart

```
┌─ APP LAUNCH ─┐
│              │
├─ Does marker exist?
│  │
│  ├─ NO → Run Python Setup
│  │         ↓
│  │     (install packages)
│  │         ↓
│  │     Write-RuntimeMarker
│  │         ↓
│  │     Done, restart app
│  │
│  └─ YES → Read marker.fingerprint
│           ↓
│        Compare with current_fingerprint
│           ↓
│        ├─ MATCH → ✓ Fast path (skip imports)
│        │           Ready to launch
│        │
│        └─ MISMATCH → Run full import checks
│                      ├─ All OK? → Update marker
│                      └─ Fail?   → Run Deep Repair
│                                   ├─ Success → Update marker, restart
│                                   └─ Fail    → Show error + manual button
```

---

## Performance Validation

Check if fast-path is working:

```powershell
# Monitor startup latency
$before = [DateTime]::Now
# Launch app and measure time until main window appears
$after = [DateTime]::Now
$duration = ($after - $before).TotalMilliseconds

Write-Host "Launch duration: $duration ms"

# Expected:
# - Fast path (marker matches): ~100-200 ms
# - Full import checks: ~500-800 ms
# - Deep Repair: ~2000+ ms
```

If launch time is consistently slow, check diagnostics for `"Fingerprint mismatch"` messages.

---

## Support Escalation Checklist

Before escalating marker issues:

- [ ] Marker file exists: `embedded_python\python_runtime_ready.json`
- [ ] Marker syntax valid: contains valid JSON
- [ ] Fingerprint is 64-char hex string
- [ ] Created_at timestamp is recent and ISO8601 format
- [ ] All core packages installed: `torch`, `demucs`, `librosa`, `soundfile`, `numpy`
- [ ] Diagnostics show either "Fast path" or "Fingerprint mismatch" (not silent skip)
- [ ] Deep Repair has been attempted with both stages visible in logs
- [ ] No file permission errors in installer output

**If all checks pass but issue persists:**
- Attach `diagnostic.log` to support ticket
- Include marker file contents (`python_runtime_ready.json`)
- Note Windows version and user permission level

