#!/bin/bash
# Create DMG installer for StemSplit on macOS
# This script packages the built .app bundle into a distributable DMG

set -e

APP_NAME="StemSplit"
APP_BUNDLE="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DMG_NAME="${APP_NAME}.dmg"
OUTPUT_DIR="installers"
VOLUME_NAME="${APP_NAME} Installer"

echo "Creating DMG installer for ${APP_NAME}..."

# Check if app bundle exists
if [ ! -d "$APP_BUNDLE" ]; then
    echo "Error: App bundle not found at $APP_BUNDLE"
    echo "Please run the build first: cargo tauri build"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Remove old DMG if exists
if [ -f "${OUTPUT_DIR}/${DMG_NAME}" ]; then
    echo "Removing old DMG..."
    rm "${OUTPUT_DIR}/${DMG_NAME}"
fi

# Create temporary directory for DMG contents
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Copying app bundle to temporary directory..."
cp -R "$APP_BUNDLE" "$TEMP_DIR/"

# Create Applications symlink
echo "Creating Applications symlink..."
ln -s /Applications "$TEMP_DIR/Applications"

# Copy README or installation instructions if they exist
if [ -f "INSTALLATION_MAC.md" ]; then
    cp "INSTALLATION_MAC.md" "$TEMP_DIR/Installation Instructions.txt"
fi

# Calculate size for DMG (app size + 50MB buffer)
echo "Calculating DMG size..."
APP_SIZE=$(du -sm "$APP_BUNDLE" | cut -f1)
DMG_SIZE=$((APP_SIZE + 50))

echo "Creating temporary DMG..."
hdiutil create -volname "$VOLUME_NAME" -srcfolder "$TEMP_DIR" -ov -format UDRW -size ${DMG_SIZE}m "temp.dmg"

# Mount the temporary DMG
echo "Mounting temporary DMG..."
MOUNT_DIR=$(hdiutil attach -readwrite -noverify -noautoopen "temp.dmg" | egrep '^/dev/' | sed 1q | awk '{print $3}')

# Set DMG window appearance using AppleScript
echo "Configuring DMG appearance..."
echo '
   tell application "Finder"
     tell disk "'${VOLUME_NAME}'"
           open
           set current view of container window to icon view
           set toolbar visible of container window to false
           set statusbar visible of container window to false
           set the bounds of container window to {100, 100, 700, 500}
           set theViewOptions to the icon view options of container window
           set arrangement of theViewOptions to not arranged
           set icon size of theViewOptions to 128
           set position of item "'${APP_NAME}'.app" of container window to {180, 170}
           set position of item "Applications" of container window to {420, 170}
           update without registering applications
           delay 2
           close
     end tell
   end tell
' | osascript

# Sync to ensure all changes are written
sync

# Unmount the temporary DMG
echo "Unmounting temporary DMG..."
hdiutil detach "${MOUNT_DIR}" -quiet

# Convert to compressed, read-only DMG
echo "Compressing final DMG..."
hdiutil convert "temp.dmg" -format UDZO -imagekey zlib-level=9 -o "${OUTPUT_DIR}/${DMG_NAME}"

# Clean up
rm -f temp.dmg

# Sign the DMG if a signing identity is available (optional)
if command -v codesign &> /dev/null; then
    # Check for signing identities
    IDENTITIES=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 || true)
    if [ -n "$IDENTITIES" ]; then
        echo "Signing DMG..."
        codesign --sign "Developer ID Application" "${OUTPUT_DIR}/${DMG_NAME}" 2>/dev/null || echo "Warning: Could not sign DMG (continuing anyway)"
    fi
fi

echo ""
echo "✓ DMG created successfully!"
echo "  Location: ${OUTPUT_DIR}/${DMG_NAME}"
echo "  Size: $(du -h "${OUTPUT_DIR}/${DMG_NAME}" | cut -f1)"
echo ""
