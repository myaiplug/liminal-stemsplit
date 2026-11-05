import os
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Every test gets its own app-data dir so the user registry/caches never leak between tests."""
    data = tmp_path / "appdata"
    data.mkdir()
    monkeypatch.setenv("LIMINAL_DATA_DIR", str(data))
    monkeypatch.delenv("LIMINAL_USER_MODELS", raising=False)
    monkeypatch.delenv("LIMINAL_MAX_RECOVERY_RETRIES", raising=False)
    return data
