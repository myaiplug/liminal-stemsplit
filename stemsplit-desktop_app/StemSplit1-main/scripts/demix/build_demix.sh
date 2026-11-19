#!/usr/bin/env bash
# Build the optional demix-rs binary (Rust / Candle BS-RoFormer) for Liminal's "Rust engine (demix-rs)" models.
#   bash build_demix.sh            CPU build
#   bash build_demix.sh --cuda     NVIDIA build (needs the CUDA toolkit / nvcc)
# Needs git and rustup (https://rustup.rs). Installs to $STEMSPLIT_MODELS_ROOT/demix/bin (default ~/.local/share/StemSplit/models).
# demix-rs is Apache-2.0; the binary statically links symphonia (MPL-2.0), so Liminal does not ship it in the installer.
set -euo pipefail
COMMIT=4b9c6fdf976c839006ee946e1ee922ba64548a9a
ROOT="${STEMSPLIT_MODELS_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/StemSplit/models}"
SRC="$ROOT/demix/src"
FEATURES=()
[ "${1:-}" = "--cuda" ] && FEATURES=(--features cuda)
if [ ! -d "$SRC/.git" ]; then git clone https://github.com/rzafiamy/demix-rs "$SRC"; fi
git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet "$COMMIT"
(cd "$SRC" && cargo build --release --locked -p demix-cli "${FEATURES[@]}")
mkdir -p "$ROOT/demix/bin"
cp "$SRC/target/release/demix" "$ROOT/demix/bin/demix"
"$ROOT/demix/bin/demix" --version
echo "Installed $ROOT/demix/bin/demix"
