#!/bin/bash
# Generate macOS icons from the source icon
# Requires ImageMagick or sips (built-in macOS tool)

set -e

ICON_SOURCE="../ss2.ico"
ICON_DIR="icons"

echo "Generating macOS icons..."

# Create icons directory if it doesn't exist
mkdir -p "$ICON_DIR"

# Check if source icon exists
if [ ! -f "$ICON_SOURCE" ]; then
    echo "Error: Source icon not found at $ICON_SOURCE"
    echo "Please ensure ss2.ico exists in the project root"
    exit 1
fi

# Method 1: Use sips (built-in macOS tool)
if command -v sips &> /dev/null; then
    echo "Using sips to convert icons..."
    
    # Convert .ico to PNG files
    sips -s format png "$ICON_SOURCE" --out "${ICON_DIR}/icon.png" 2>/dev/null || {
        echo "Warning: Could not convert with sips, trying alternative method..."
    }
    
    # Generate different sizes
    if [ -f "${ICON_DIR}/icon.png" ]; then
        sips -z 32 32 "${ICON_DIR}/icon.png" --out "${ICON_DIR}/32x32.png"
        sips -z 128 128 "${ICON_DIR}/icon.png" --out "${ICON_DIR}/128x128.png"
        sips -z 256 256 "${ICON_DIR}/icon.png" --out "${ICON_DIR}/128x128@2x.png"
        sips -z 256 256 "${ICON_DIR}/icon.png" --out "${ICON_DIR}/icon@2x.png"
        echo "✓ PNG icons generated"
    fi
fi

# Method 2: Use ImageMagick if available
if command -v convert &> /dev/null; then
    echo "Using ImageMagick to convert icons..."
    convert "$ICON_SOURCE" -resize 32x32 "${ICON_DIR}/32x32.png"
    convert "$ICON_SOURCE" -resize 128x128 "${ICON_DIR}/128x128.png"
    convert "$ICON_SOURCE" -resize 256x256 "${ICON_DIR}/128x128@2x.png"
    echo "✓ PNG icons generated with ImageMagick"
fi

# Generate .icns file for macOS
if command -v iconutil &> /dev/null; then
    echo "Generating .icns file..."
    
    # Create iconset directory
    ICONSET="${ICON_DIR}/icon.iconset"
    mkdir -p "$ICONSET"
    
    # Copy/generate all required sizes
    cp "${ICON_DIR}/32x32.png" "$ICONSET/icon_16x16@2x.png" 2>/dev/null || true
    cp "${ICON_DIR}/128x128.png" "$ICONSET/icon_64x64@2x.png" 2>/dev/null || true
    cp "${ICON_DIR}/128x128@2x.png" "$ICONSET/icon_128x128@2x.png" 2>/dev/null || true
    
    # Generate missing sizes if ImageMagick is available
    if command -v convert &> /dev/null; then
        convert "$ICON_SOURCE" -resize 16x16 "$ICONSET/icon_16x16.png"
        convert "$ICON_SOURCE" -resize 32x32 "$ICONSET/icon_16x16@2x.png"
        convert "$ICON_SOURCE" -resize 32x32 "$ICONSET/icon_32x32.png"
        convert "$ICON_SOURCE" -resize 64x64 "$ICONSET/icon_32x32@2x.png"
        convert "$ICON_SOURCE" -resize 128x128 "$ICONSET/icon_128x128.png"
        convert "$ICON_SOURCE" -resize 256x256 "$ICONSET/icon_128x128@2x.png"
        convert "$ICON_SOURCE" -resize 256x256 "$ICONSET/icon_256x256.png"
        convert "$ICON_SOURCE" -resize 512x512 "$ICONSET/icon_256x256@2x.png"
        convert "$ICON_SOURCE" -resize 512x512 "$ICONSET/icon_512x512.png"
        convert "$ICON_SOURCE" -resize 1024x1024 "$ICONSET/icon_512x512@2x.png"
    fi
    
    # Convert to .icns
    iconutil -c icns "$ICONSET" -o "${ICON_DIR}/icon.icns"
    
    # Clean up
    rm -rf "$ICONSET"
    
    echo "✓ .icns file generated"
fi

# Copy existing .ico file
cp "$ICON_SOURCE" "${ICON_DIR}/icon.ico"

echo ""
echo "✓ Icon generation complete!"
echo "  Generated icons in: $ICON_DIR/"
ls -lh "$ICON_DIR/"

echo ""
echo "Note: If icons are missing, you may need to install ImageMagick:"
echo "  brew install imagemagick"
