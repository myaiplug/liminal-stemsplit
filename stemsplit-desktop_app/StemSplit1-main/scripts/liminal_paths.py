"""Shared filesystem locations for Liminal StemSplit's Python side.

Mirrors the Rust side (`dirs::data_local_dir().join("StemSplit")`) so both
halves of the app agree about where user-level state lives.
"""

import os
import platform
from pathlib import Path


def user_data_dir() -> Path:
    """App data dir (user model registry, catalog cache, diagnostics)."""
    override = os.environ.get("LIMINAL_DATA_DIR")
    if override:
        base = Path(override)
    elif platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        base = Path(local) / "StemSplit"
    elif platform.system() == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "StemSplit"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "StemSplit"
    base.mkdir(parents=True, exist_ok=True)
    return base


def logs_dir() -> Path:
    path = user_data_dir() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def audio_separator_model_dir() -> Path:
    """Where audio-separator caches weights (kept in sync with splitter.py)."""
    if platform.system() == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        return Path(base) / "audio-separator" / "models"
    return Path(os.path.expanduser("~")) / ".cache" / "audio-separator" / "models"


def user_registry_path() -> Path:
    return user_data_dir() / "user_models.json"


def catalog_cache_path() -> Path:
    return user_data_dir() / "model_catalog_cache.json"


def read_app_version(scripts_dir: Path = None) -> str:
    """App version from the VERSION file shipped next to (or above) the scripts."""
    here = Path(scripts_dir or Path(__file__).resolve().parent)
    for candidate in (here / "VERSION", here.parent / "VERSION"):
        try:
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return text
        except OSError:
            continue
    return "0.0.0"
