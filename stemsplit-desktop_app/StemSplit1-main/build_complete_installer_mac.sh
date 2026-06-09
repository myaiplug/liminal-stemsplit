#!/bin/bash
# Complete Automated Installer Builder for StemSplit (macOS)
# This builds a fully self-contained installer that requires minimal user setup

set -e

echo ""
echo "========================================"
echo "  StemSplit Mac Installer Builder"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for required tools
echo -e "${YELLOW}[0/5] Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found. Please install from https://nodejs.org/${NC}"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Rust/Cargo not found. Please install from https://rustup.rs/${NC}"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 not found. Please install Python 3.10+${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites installed${NC}"

# Step 1: Setup Python Environment
echo ""
echo -e "${YELLOW}[1/5] Setting up Python environment...${NC}"
if [ ! -d "python_env" ]; then
    echo "Creating virtual environment..."
    ./setup_python_env_mac.sh
    echo -e "${GREEN}✓ Python environment ready${NC}"
else
    echo -e "${GREEN}✓ Python environment already exists${NC}"
fi

# Step 2: Install Node dependencies
echo ""
echo -e "${YELLOW}[2/5] Installing Node dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 3: Build Next.js app
echo ""
echo -e "${YELLOW}[3/5] Building frontend application...${NC}"
npm run build
echo -e "${GREEN}✓ Frontend build complete${NC}"

# Step 4: Build Tauri app bundle
echo ""
echo -e "${YELLOW}[4/5] Building macOS application bundle...${NC}"
cd src-tauri
cargo tauri build
cd ..
echo -e "${GREEN}✓ Application bundle created${NC}"

# Step 5: Create DMG installer
echo ""
echo -e "${YELLOW}[5/5] Creating DMG installer...${NC}"

PAYLOAD_MANIFEST="scripts/ci/model_payload_manifest.json"
if [ -f "$PAYLOAD_MANIFEST" ]; then
    mkdir -p installers
    echo "Running model payload manifest validation..."
    python3 ./scripts/ci/validate_model_payloads.py \
        --manifest "$PAYLOAD_MANIFEST" \
        --repo-root "." \
        --json-out "installers/model-payload-report.json" \
        --md-out "installers/model-payload-report.md"
    echo -e "${GREEN}✓ Model payload validation passed${NC}"
else
    echo -e "${YELLOW}Model payload manifest not found; skipping payload validation${NC}"
fi

./create_mac_dmg.sh

if [ -f "installers/StemSplit.dmg" ]; then
    shasum -a 256 "installers/StemSplit.dmg" | awk '{print $1 "  StemSplit.dmg"}' > "installers/checksums-mac.sha256"
fi

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}========================================"
    echo "  ✓ INSTALLER CREATED SUCCESSFULLY!"
    echo -e "========================================${NC}"
    echo ""
    
    DMG_PATH="installers/StemSplit.dmg"
    if [ -f "$DMG_PATH" ]; then
        DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)
        echo -e "${CYAN}Installer Details:${NC}"
        echo "  Location: $DMG_PATH"
        echo "  Size: $DMG_SIZE"
        if [ -f "installers/checksums-mac.sha256" ]; then
            echo "  Checksums: installers/checksums-mac.sha256"
        fi
        echo ""
        echo -e "${CYAN}Opening installer folder...${NC}"
        open installers/
    fi
else
    echo -e "${RED}Installer creation failed!${NC}"
    exit 1
fi
