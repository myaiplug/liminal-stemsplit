#!/bin/bash
# Setup Python Environment for StemSplit on macOS
# Creates a relocatable Python environment that can be bundled with the app

set -e

PYTHON_VERSION="3.10"
ENV_DIR="python_env"

echo "Setting up Python Environment for macOS..."
echo ""

# Check FFmpeg
echo "Checking dependencies..."
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️  FFmpeg not found. Install with: brew install ffmpeg"
    echo "   MP3 export may not work without FFmpeg."
else
    echo "✓ FFmpeg found: $(ffmpeg -version 2>&1 | head -1)"
fi
echo ""

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found. Please install Python $PYTHON_VERSION or higher."
    echo "Download from: https://www.python.org/downloads/"
    echo "Or use Homebrew: brew install python@3.10"
    exit 1
fi

CURRENT_PYTHON=$(python3 --version | cut -d' ' -f2)
echo "Found Python $CURRENT_PYTHON"

# Create virtual environment
if [ ! -d "$ENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$ENV_DIR"
else
    echo "Virtual environment already exists."
fi

# Activate environment
source "$ENV_DIR/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip setuptools wheel

# Install requirements
if [ -f "requirements.txt" ]; then
    echo "Installing dependencies from requirements.txt..."
    pip install -r requirements.txt
else
    echo "Warning: requirements.txt not found."
fi

# Install additional Mac-specific dependencies if needed
echo "Installing audio processing dependencies..."
pip install soundfile librosa pedalboard numpy scipy

# Create a portable Python launcher script
cat > "python_launcher_mac.sh" << 'EOF'
#!/bin/bash
# Portable Python launcher for StemSplit

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PYTHON_ENV="$SCRIPT_DIR/python_env"

if [ -d "$PYTHON_ENV" ]; then
    source "$PYTHON_ENV/bin/activate"
    python3 "$@"
else
    echo "Error: Python environment not found at $PYTHON_ENV"
    exit 1
fi
EOF

chmod +x "python_launcher_mac.sh"

echo ""
echo "✓ Python environment setup complete!"
echo "  Location: $ENV_DIR"
echo "  Python: $(python --version)"
echo "  Pip: $(pip --version)"
echo ""
echo "To activate manually: source $ENV_DIR/bin/activate"

deactivate 2>/dev/null || true
