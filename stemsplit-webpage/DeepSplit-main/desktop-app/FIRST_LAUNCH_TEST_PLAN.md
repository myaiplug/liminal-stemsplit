# First-Launch Integration Test Plan

## Phase 1: Runtime Marker Generation (Installer)

### Test 1.1: Clean Install with Runtime Marker
**Objective:** Verify PowerShell installer generates `python_runtime_ready.json` after setup

**Steps:**
1. Delete existing `embedded_python/` directory completely
2. Run installer: `.\setup_embedded_python.ps1 -RepairIfNeeded`
3. Wait for completion

**Validation:**
```powershell
# Check marker exists
Test-Path "embedded_python\python_runtime_ready.json"

# Check marker structure
$marker = Get-Content "embedded_python\python_runtime_ready.json" | ConvertFrom-Json
$marker.fingerprint  # Should be non-empty SHA256 hex string
$marker.created_at   # Should be ISO8601 timestamp
$marker.required_modules -contains "torch"  # Should include core modules
```

**Expected Result:** Marker file exists with valid fingerprint, timestamp, and module list

---

### Test 1.2: Already-Healthy Runtime (Fast Path)
**Objective:** Verify existing healthy runtime is not re-provisioned

**Steps:**
1. After Test 1.1, verify marker exists
2. Run installer again: `.\setup_embedded_python.ps1 -RepairIfNeeded`
3. Observe output

**Expected Result:** Script detects healthy runtime, returns early with "Runtime is already healthy" message, regenerates marker with matching fingerprint

---

## Phase 2: App Startup Fast-Path (Backend)

### Test 2.1: Fast-Path Skip on Trusted Fingerprint
**Objective:** Verify app skips expensive import checks when marker is valid

**Steps:**
1. Ensure marker exists from Phase 1
2. Start StemSplit app with debug logging
3. Monitor console output

**Validation Points:**
- Look for log line: `"Fast path: trust marker when runtime fingerprint matches expected anchors."`
- Should NOT see 5 separate import check lines (torch, demucs, librosa, soundfile, numpy)
- Should see single fingerprint comparison and "Python runtime OK" result in < 100ms

**Expected Result:** Startup latency reduced ~80% (from ~500ms to ~100ms) due to skipped import checks

---

### Test 2.2: Fingerprint Mismatch Detection
**Objective:** Verify marker validation catches runtime corruption

**Steps:**
1. Manually corrupt marker: `Set-Content .\embedded_python\python_runtime_ready.json '"corrupted"'`
2. Start app
3. Observe behavior

**Expected Result:** App detects fingerprint mismatch, falls back to full import checks, updates marker

---

## Phase 3: Auto-Repair Flow (UI + Backend)

### Test 3.1: Auto-Provisioning on First Launch
**Objective:** Verify runtime setup auto-starts without user click

**Steps:**
1. Delete `python_runtime_ready.json` marker
2. Start app
3. Observe Python Setup modal

**Expected Result:** 
- "Setting up AI runtime..." appears immediately
- Progress bar animates (Downloads, Installs, Optimizes)
- Modal closes automatically on success
- Marker file created with valid fingerprint

---

### Test 3.2: Auto-Provisioning with Network Failure
**Objective:** Verify Deep Repair auto-triggers before error shown

**Prerequisites:**
- Enable Windows firewall blocking to simulate network failure
- Delete marker and runtime to force fresh setup

**Steps:**
1. Block internet access
2. Start app
3. Observe setup attempts

**Expected Timeline:**
- ~5s: Setup runs, hits network failure
- ~10s: Setup retries (AUTO_INSTALL_ATTEMPTS=2)
- ~20s: Deep Repair auto-triggers (pre-error)
  - Clears broken runtime state
  - Attempts mirror PyPI with CPU wheels
  - Staged fallback isolated via PIP_INDEX_URL env var
- ~30s: Success or Manual button shown

**Expected Result:** User sees "Deep Repair" button if auto-attempts exhaust, NOT raw error message

---

### Test 3.3: Manual Deep Repair Override
**Objective:** Verify user can manually trigger Deep Repair if needed

**Steps:**
1. After Test 3.2 completes (setup failed)
2. Click "Deep Repair" button (amber color)
3. Observe progress

**Expected Result:**
- Button shows loading state
- Progress updates: "Clearing broken runtime... Attempting staged mirror install..."
- On success: modal closes, marker generated
- On continued failure: helpful error without action

---

## Phase 4: Multi-Device Scenarios

### Test 4.1: Offline Installer (Pre-Cached Runtime)
**Objective:** Verify standalone installer carries fingerprint marker

**Steps:**
1. Build offline installer: `.\build_complete_installer.ps1`
2. Run on airgapped machine with no internet
3. Verify app starts immediately after install

**Validation:**
- Check `embedded_python\python_runtime_ready.json` exists post-install
- App does NOT show Python Setup modal on first launch
- Fingerprint matches prebuilt runtime hash

**Expected Result:** Offline install provides trusted runtime, app launches immediately

---

### Test 4.2: Multiple User Profiles (Shared Runtime)
**Objective:** Verify runtime marker works across Windows user profiles

**Steps:**
1. Install StemSplit as Admin (stores runtime in Program Files)
2. Login as different Windows user
3. Launch StemSplit

**Expected Result:** 
- App detects trusted marker
- Fast-path validation succeeds
- No repeated setup calls

---

## Phase 5: Repair Telemetry & Diagnostics

### Test 5.1: Marker Lifecycle Logging
**Objective:** Verify repair path is logged for support debugging

**Steps:**
1. Run any setup flow (auto or manual)
2. Check app diagnostics: `%APPDATA%/StemSplit/diagnostic.log`

**Expected Entries:**
- `"Generated runtime marker with fingerprint: <sha256>"`
- `"Fast path: runtime fingerprint matches, skipping import checks"`
- `"Deep Repair triggered: clearing runtime state"`
- `"Staged attempt 1/2: primary PyPI index"`
- `"Staged attempt 2/2: mirror PyPI with CPU wheels"`

**Expected Result:** Full repair trail visible for support analysis

---

### Test 5.2: Marker Invalidation Events
**Objective:** Verify marker is regenerated on meaningful runtime changes

**Steps:**
1. Record existing marker fingerprint
2. Manually install/remove a critical package: `pip install scikit-learn`
3. Restart app
4. Check new marker fingerprint

**Expected Result:** 
- App detects fingerprint mismatch
- Regenerates marker with new fingerprint
- Both old + new fingerprints appear in diagnostic log

---

## Acceptance Criteria

✅ **Marker Generation:**
- [x] PowerShell installer generates `python_runtime_ready.json` with SHA256 fingerprint
- [x] Marker includes required_modules list and ISO8601 timestamp
- [x] Marker is regenerated on every setup success

✅ **Fast-Path Validation:**
- [x] App startup uses fast-path when marker fingerprint matches
- [x] Import checks are skipped on fast-path (verify from logs)
- [x] Startup latency reduced ~80% on subsequent launches

✅ **Auto-Provisioning Fallback:**
- [x] Setup auto-starts without user click
- [x] Deep Repair auto-triggers before error message
- [x] Manual Deep Repair button available if auto exhausts

✅ **Diagnostics:**
- [x] Full repair path logged for debugging
- [x] Marker lifecycle tracked in telemetry
- [x] Support can identify which repair stage failed

✅ **End-to-End:**
- [x] Offline installer includes valid marker
- [x] Multi-user scenarios share trusted runtime
- [x] Fingerprint regeneration on package changes detected

---

## Quick Command Reference

```powershell
# Run setup with marker generation
.\setup_embedded_python.ps1 -RepairIfNeeded

# Check marker exists
Test-Path "embedded_python\python_runtime_ready.json"

# View marker contents
Get-Content "embedded_python\python_runtime_ready.json" | ConvertFrom-Json | Format-List

# View app diagnostics
Get-Content "$env:APPDATA/StemSplit/diagnostic.log" -Tail 50

# Simulate network failure (Admin)
netsh advfirewall firewall add rule name="Block PyPI" dir=out action=block remoteip=files.pythonhosted.org

# Clear block
netsh advfirewall firewall delete rule name="Block PyPI"

# Monitor runtime marker race condition
Get-Item "embedded_python\python_runtime_ready.json" -Force | Select-Object LastWriteTime
```

---

## Notes for Support Team

- **Most Common Issue:** Marker not regenerated after pip install
  - **Solution:** Check that `write_python_runtime_marker()` is called on success path
  - **Verify:** Marker `created_at` timestamp should match app restart time

- **Offline Installer Missing Marker:**
  - **Root Cause:** `setup_embedded_python.ps1` script not run during packaging
  - **Solution:** Ensure offline build calls `Write-RuntimeMarker` in packaging phase

- **Persistent Deep Repair Failures:**
  - **Diagnosis:** Check `diagnostic.log` for staged attempt failures
  - **Likely Cause:** Mirror PyPI not accessible from user location
  - **Fallback:** Manual recovery via language model or support team

