import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]


def test_versions_in_sync():
    """CI guard: every version string must agree with APP/VERSION."""
    res = subprocess.run([sys.executable, str(SCRIPTS / "sync_version.py"), "--check"], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr


def test_version_file_is_semver():
    import re
    v = (SCRIPTS.parent / "VERSION").read_text().strip()
    assert re.fullmatch(r"\d+\.\d+\.\d+", v)
    assert (SCRIPTS / "VERSION").read_text().strip() == v
