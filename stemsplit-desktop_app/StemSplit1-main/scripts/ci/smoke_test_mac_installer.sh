#!/bin/bash
set -eEuo pipefail

INSTALLER_PATH="${1:-}"
REPORT_PATH="${2:-installers/smoke-macos.json}"
STATUS="failed"
MESSAGE="Smoke test did not complete"
CHECK_APP_BUNDLE="false"
CHECK_APPS_LINK="false"
CHECK_CHECKSUM="false"
DMG_PATH=""
MOUNT_POINT=""

write_report() {
  local exit_code="${1:-0}"
  mkdir -p "$(dirname "$REPORT_PATH")"
  cat > "$REPORT_PATH" <<EOF
{
  "platform": "macos",
  "passed": ${STATUS},
  "installer_path": "${DMG_PATH}",
  "mount_point": "${MOUNT_POINT}",
  "checks": {
    "app_bundle_present": ${CHECK_APP_BUNDLE},
    "applications_symlink_present": ${CHECK_APPS_LINK},
    "checksum_match": ${CHECK_CHECKSUM}
  },
  "message": "${MESSAGE}",
  "exit_code": ${exit_code}
}
EOF
}

on_error() {
  local exit_code=$?
  MESSAGE="Smoke test failed"
  STATUS="false"
  write_report "$exit_code"
  exit "$exit_code"
}
trap 'on_error' ERR

resolve_installer() {
  if [[ -n "$INSTALLER_PATH" && -f "$INSTALLER_PATH" ]]; then
    echo "$INSTALLER_PATH"
    return
  fi

  local candidate
  candidate=$(ls -t installers/*Online*.dmg 2>/dev/null | head -n 1 || true)
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return
  fi

  candidate=$(ls -t installers/StemSplit.dmg 2>/dev/null | head -n 1 || true)
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return
  fi

  echo "No DMG installer found under installers/." >&2
  exit 1
}

DMG_PATH="$(resolve_installer)"
echo "[Smoke-Mac] Using installer: $DMG_PATH"

ATTACH_OUTPUT=$(hdiutil attach -nobrowse -readonly "$DMG_PATH")
MOUNT_POINT=$(echo "$ATTACH_OUTPUT" | awk '/\/Volumes\// { idx=index($0, "/Volumes/"); if (idx > 0) print substr($0, idx) }' | tail -n 1)

cleanup() {
  if mount | grep -q "$MOUNT_POINT"; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
}
trap cleanup EXIT

APP_BUNDLE="$MOUNT_POINT/StemSplit.app"
APPS_LINK="$MOUNT_POINT/Applications"

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "[Smoke-Mac] Missing app bundle in mounted DMG: $APP_BUNDLE" >&2
  exit 2
fi
CHECK_APP_BUNDLE="true"

if [[ ! -L "$APPS_LINK" ]]; then
  echo "[Smoke-Mac] Missing Applications symlink in mounted DMG: $APPS_LINK" >&2
  exit 3
fi
CHECK_APPS_LINK="true"

if [[ -f installers/checksums-mac.sha256 ]]; then
  expected_line=$(grep "$(basename "$DMG_PATH")$" installers/checksums-mac.sha256 || true)
  if [[ -n "$expected_line" ]]; then
    expected_hash=$(echo "$expected_line" | awk '{print $1}')
    actual_hash=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
    if [[ "$expected_hash" != "$actual_hash" ]]; then
      echo "[Smoke-Mac] Checksum mismatch for $DMG_PATH" >&2
      exit 4
    fi
    CHECK_CHECKSUM="true"
  else
    CHECK_CHECKSUM="false"
  fi
else
  CHECK_CHECKSUM="false"
fi

STATUS="true"
MESSAGE="DMG smoke tests passed"
write_report 0

echo "[Smoke-Mac] DMG smoke tests passed."
echo "[Smoke-Mac] Wrote report: $REPORT_PATH"
