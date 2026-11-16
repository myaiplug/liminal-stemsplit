"""HT-RoFormer drum split and Mel-Band karaoke engines: routing, host math, chunking (no weights needed)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import drumsep_htr_separate as htr
import karaoke_mbr_separate as mbr
from model_registry import resolve_model_variant


def test_registry_routes():
    assert resolve_model_variant("drumsep_ht_roformer")["backend"] == "drumsep_htr"
    assert resolve_model_variant("drumsep_ht_roformer")["runtime_download"] is True
    assert resolve_model_variant("mbr_karaoke_lead_backing")["backend"] == "karaoke_mbr"


def test_htr_pins_are_immutable_commit_urls():
    assert len(htr.HF_REVISION) == 40
    for name, (sha, _size) in htr.FILES.items():
        assert len(sha) == 64
        assert htr.hf_url(name).startswith(f"https://huggingface.co/{htr.HF_REPO}/resolve/{htr.HF_REVISION}/")
    assert len(mbr.HF_REVISION) == 40


def test_htr_chunk_is_multiple_of_1024_and_stems_named():
    assert htr.CHUNK % 1024 == 0
    assert set(htr.LIMINAL_STEM_NAMES) == set(htr.STEMS)
    assert set(htr.LIMINAL_STEM_NAMES.values()) == {"kick", "snare", "hh", "toms", "cymbals", "perc"}


@pytest.mark.parametrize("seconds", [1.0, 6.0, 15.3])
def test_htr_overlap_add_reconstructs_identity_runner(seconds):
    n = int(seconds * htr.TARGET_SR)
    rng = np.random.default_rng(0)
    audio = rng.standard_normal((2, n)).astype(np.float32) * 0.1
    # mock model: stem i = input * (i+1)/21, so the six stems sum to the input
    scales = np.arange(1, 7, dtype=np.float32) / 21.0
    stems = htr.separate_drums(audio, htr.TARGET_SR, chunk_runner=lambda w: scales[:, None, None] * w[None])
    assert list(stems) == list(htr.STEMS)
    total = sum(stems.values())
    assert total.shape == audio.shape
    assert np.max(np.abs(total - audio)) < 1e-5


def test_htr_ensure_files_rejects_bad_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMSPLIT_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(htr, "FILES", {"x.py": ("0" * 64, None)})

    def fake_retrieve(url, dest):
        Path(dest).write_text("tampered")
    monkeypatch.setattr(htr.urllib.request, "urlretrieve", fake_retrieve)
    with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
        htr.ensure_files()
    assert not any(tmp_path.rglob("x.py"))


def test_mbr_pack_layout_matches_card():
    rng = np.random.default_rng(1)
    spec = rng.standard_normal((2, mbr.N_BINS, 5)) + 1j * rng.standard_normal((2, mbr.N_BINS, 5))
    feats = mbr.pack_features(spec)
    assert feats.shape == (1, 5, 4100)
    t, f, ch = 3, 700, 1
    assert feats[0, t, (2 * f + ch) * 2 + 0] == pytest.approx(spec[ch, f, t].real)
    assert feats[0, t, (2 * f + ch) * 2 + 1] == pytest.approx(spec[ch, f, t].imag)


def test_mbr_unpack_mask_layout():
    mask = np.zeros((1, 1, 2050, 4, 2), dtype=np.float32)
    mask[0, 0, 2 * 10 + 1, 2, 0] = 0.5   # f=10, ch=1, t=2, real
    mask[0, 0, 2 * 10 + 1, 2, 1] = -0.25
    m = mbr.unpack_mask(mask)
    assert m.shape == (2, mbr.N_BINS, 4)
    assert m[1, 10, 2] == pytest.approx(0.5 - 0.25j)
    assert m[0, 10, 2] == 0


def test_mbr_lead_plus_backing_equals_input_with_half_mask():
    n = int(9.5 * mbr.TARGET_SR)
    rng = np.random.default_rng(2)
    audio = rng.standard_normal((2, n)).astype(np.float32) * 0.1

    def runner(feats):
        frames = feats.shape[1]
        out = np.zeros((1, 1, 2050, frames, 2), dtype=np.float32)
        out[..., 0] = 0.5
        return out

    stems = mbr.separate_lead_backing(audio, mbr.TARGET_SR, session_runner=runner)
    assert set(stems) == {"lead", "backing"}
    assert np.max(np.abs(stems["lead"] + stems["backing"] - audio)) < 1e-5
    # a constant 0.5 mask is a gain of 0.5 after STFT/iSTFT round trip
    assert np.max(np.abs(stems["lead"] - 0.5 * audio)) < 1e-3
