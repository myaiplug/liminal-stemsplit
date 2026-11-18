"""demix-rs (Rust / Candle) backend: binary discovery, pinned downloads, SW conversion, CLI round trip (fake binary)."""

from __future__ import annotations

import hashlib
import io
import os
import stat
import sys
import textwrap
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import demix_rs_separate as dm
from model_registry import resolve_model_variant

FAKE = textwrap.dedent('''\
    #!{py}
    # fake demix: "separate" writes <name>_vocals.wav = 0.25 * input and <name>_instrumental.wav = 0.75 * input;
    # "convert" writes a small file.
    import sys, soundfile as sf
    from pathlib import Path
    a = sys.argv[1:]
    if a[0] == "--version":
        print("demix 0.1.0"); sys.exit(0)
    if a[0] == "convert":
        Path(a[a.index("-o") + 1]).write_bytes(b"GGUF"); sys.exit(0)
    out = Path(a[a.index("-o") + 1]); out.mkdir(parents=True, exist_ok=True)
    src = Path(a[-1]); x, sr = sf.read(src, always_2d=True, dtype="float32")
    for stem, g in (("vocals", 0.25), ("instrumental", 0.75)):
        sf.write(out / f"{{src.stem}}_{{stem}}.wav", x * g, sr, subtype="FLOAT")
    print(f"{{src}}: done", file=sys.stderr)
''')


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMSPLIT_MODELS_ROOT", str(tmp_path / "models"))
    monkeypatch.delenv("LIMINAL_DEMIX_BIN", raising=False)
    monkeypatch.setattr(dm.shutil, "which", lambda _n: None)
    return tmp_path


@pytest.fixture
def fake_bin(root):
    exe = "demix.exe" if os.name == "nt" else "demix"
    p = dm.demix_dir() / "bin" / exe
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(FAKE.format(py=sys.executable))
    p.chmod(p.stat().st_mode | stat.S_IEXEC)
    return p


def test_registry_entries():
    v = resolve_model_variant("demix_bs_roformer_viperx317")
    assert v["backend"] == "demix_rs" and v["demix_variant"] == "viperx317" and v["runtime_download"] is True
    assert "UNLICENSED" in v["license"]
    s = resolve_model_variant("demix_bs_roformer_sw")
    assert s["backend"] == "demix_rs" and s["demix_variant"] == "sw" and s["stems"] == 6


def test_pins_are_immutable():
    assert len(dm.DEMIX_COMMIT) == 40 and len(dm.VIPERX_HF_REVISION) == 40
    for name, sha, size in dm.VIPERX_FILES.values():
        assert len(sha) == 64 and size > 1e8
        assert dm.hf_url(name).startswith(f"https://huggingface.co/{dm.VIPERX_HF_REPO}/resolve/{dm.VIPERX_HF_REVISION}/")


def test_binary_discovery_order(root, fake_bin, monkeypatch, tmp_path):
    assert dm.find_demix_binary() == fake_bin
    other = tmp_path / "custom-demix"
    other.write_text(FAKE.format(py=sys.executable)); other.chmod(0o755)
    monkeypatch.setenv("LIMINAL_DEMIX_BIN", str(other))
    assert dm.find_demix_binary() == other


def test_missing_binary_is_a_clear_error(root):
    assert dm.find_demix_binary() is None
    with pytest.raises(dm.DemixUnavailable, match="build_demix"):
        dm.separate("viperx317", np.zeros((2, 100), np.float32), 44100)


def test_viperx_download_checks_sha(root, monkeypatch):
    payload = b"x" * 1000
    monkeypatch.setitem(dm.VIPERX_FILES, "q8_0", ("m.gguf", hashlib.sha256(payload).hexdigest(), len(payload)))
    seen = []
    path = dm.ensure_viperx_gguf("q8_0", opener=lambda url: (seen.append(url), io.BytesIO(payload))[1])
    assert path.read_bytes() == payload and seen[0].endswith("/m.gguf")
    # cached: no second download
    assert dm.ensure_viperx_gguf("q8_0", opener=lambda url: pytest.fail("downloaded twice")) == path
    monkeypatch.setitem(dm.VIPERX_FILES, "f16", ("bad.gguf", "0" * 64, 3))
    with pytest.raises(RuntimeError, match="SHA-256"):
        dm.ensure_viperx_gguf("f16", opener=lambda url: io.BytesIO(b"abc"))


def test_sw_checkpoint_conversion_is_cached(root, fake_bin, tmp_path):
    d = tmp_path / "as"; d.mkdir()
    (d / "BS-Roformer-SW.ckpt").write_bytes(b"ckpt"); (d / "BS-Roformer-SW.yaml").write_text("x: 1")
    assert dm.find_sw_checkpoint([tmp_path / "nope", d]) == (d / "BS-Roformer-SW.ckpt", d / "BS-Roformer-SW.yaml")
    g = dm.ensure_sw_gguf([d], fake_bin)
    assert g.read_bytes() == b"GGUF"
    calls = []
    assert dm.ensure_sw_gguf([d], fake_bin, run=lambda *a, **k: calls.append(a)) == g and not calls
    with pytest.raises(dm.DemixUnavailable, match="BS-Roformer-SW"):
        dm.ensure_sw_gguf([tmp_path / "empty"], fake_bin)


def test_run_demix_round_trip_and_resample(root, fake_bin):
    sr = 22050
    t = np.arange(sr) / sr
    audio = np.stack([np.sin(2 * np.pi * 220 * t), np.cos(2 * np.pi * 330 * t)]).astype(np.float32) * 0.5
    stems = dm.run_demix(fake_bin, Path("m.gguf"), audio, sr)
    assert set(stems) == {"vocals", "instrumental"}
    np.testing.assert_allclose(stems["vocals"], audio * 0.25, atol=1e-6)
    np.testing.assert_allclose(stems["vocals"] + stems["instrumental"], audio, atol=1e-6)
    mono = dm.run_demix(fake_bin, Path("m.gguf"), audio[0], sr)
    assert mono["vocals"].shape == (2, sr)


def test_separate_viperx_end_to_end_with_fake_binary(root, fake_bin, monkeypatch):
    monkeypatch.setattr(dm, "ensure_viperx_gguf", lambda dtype, progress=None: Path("m.gguf"))
    msgs = []
    audio = np.random.default_rng(0).standard_normal((2, 4410)).astype(np.float32) * 0.1
    stems = dm.separate("viperx317", audio, 44100, progress_hook=lambda *a: msgs.append(a[2]))
    assert set(stems) == {"vocals", "instrumental"} and msgs[-1] == "demix-rs done"


def test_splitter_routes_demix_backend():
    src = (SCRIPTS / "splitter.py").read_text(encoding="utf-8")
    assert "variant_meta.get('backend') == 'demix_rs'" in src
    assert "self._separate_demix_rs(" in src
