"""Tests for Mini-BS-RoFormer routing, KARA2 host math, remix kit, and MIDI."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np
import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import crisp_separate
import kara2_separate
import remix_kit
from model_registry import resolve_model_variant


def test_registry_routes_new_models():
    crisp = resolve_model_variant("mini_bs_roformer")
    assert crisp.get("backend") == "crisp"
    assert crisp.get("filename") == "mini-bs-roformer-q8_0.gguf"
    kara = resolve_model_variant("kara2_student")
    assert kara.get("backend") == "kara2"
    assert "duality_kara2_student_core_t1100.onnx" in kara.get("filename", "")


def test_crisp_command_shape(tmp_path):
    cmd = crisp_separate.build_separate_command(
        tmp_path / "crispasr",
        tmp_path / "mini-bs-roformer-q8_0.gguf",
        tmp_path / "song.wav",
        tmp_path / "out",
    )
    assert cmd[1] == "--separate"
    assert "-m" in cmd and "-f" in cmd and "--sep-output-dir" in cmd
    assert str(tmp_path / "out") in cmd


def test_kara2_window_length_matches_card():
    assert kara2_separate.WINDOW_SAMPLES == (1100 - 1) * 441 + 2048
    assert kara2_separate.WINDOW_SAMPLES == 486707
    assert kara2_separate.N_BINS * 2 == 2050


def test_kara2_window_starts_cover_short_and_long():
    assert kara2_separate.window_starts(1000) == [0]
    starts = kara2_separate.window_starts(kara2_separate.WINDOW_SAMPLES * 3)
    assert starts[0] == 0
    assert starts[-1] == kara2_separate.WINDOW_SAMPLES * 3 - kara2_separate.WINDOW_SAMPLES
    # hops should not leave a gap larger than one window
    for a, b in zip(starts, starts[1:]):
        assert 0 < (b - a) <= kara2_separate.WINDOW_SAMPLES


def test_kara2_mask_math_lead_and_instrumental():
    t = kara2_separate.T_FRAMES
    bins = kara2_separate.N_BINS * 2
    mix = np.ones((bins, t), dtype=np.complex64) * (0.5 + 0.25j)
    vocals_mask = np.full((bins, t), 0.8 + 0.0j, dtype=np.complex64)
    backing_mask = np.full((bins, t), 0.25 + 0.0j, dtype=np.complex64)

    stft_repr = np.zeros((1, bins, t, 2), dtype=np.float32)
    stft_repr[0, :, :, 0] = mix.real
    stft_repr[0, :, :, 1] = mix.imag
    masks = np.zeros((2, bins, t, 2), dtype=np.float32)
    masks[0, :, :, 0] = vocals_mask.real
    masks[0, :, :, 1] = vocals_mask.imag
    masks[1, :, :, 0] = backing_mask.real
    masks[1, :, :, 1] = backing_mask.imag

    parts = kara2_separate.apply_masks(stft_repr, masks)
    vocals = mix * vocals_mask
    backing = vocals * backing_mask
    np.testing.assert_allclose(parts["vocals"], vocals)
    np.testing.assert_allclose(parts["backing"], backing)
    np.testing.assert_allclose(parts["lead"], vocals - backing)
    np.testing.assert_allclose(parts["instrumental"], mix - vocals)


def test_kara2_stereo_packing_roundtrip_shape():
    window = np.random.randn(2, kara2_separate.WINDOW_SAMPLES).astype(np.float32) * 0.1

    def fake_runner(packed):
        assert packed.shape == (1, 2050, 1100, 2)
        # Identity-ish: vocals mask 1, backing mask 0 → lead = vocals = mix, backing = 0
        masks = np.zeros((2, 2050, 1100, 2), dtype=np.float32)
        masks[0, :, :, 0] = 1.0
        return masks

    stems = kara2_separate.separate_kara2(window, 44100, session_runner=fake_runner)
    assert set(stems) == {"lead", "backing", "instrumental"}
    for name, audio in stems.items():
        assert audio.shape[0] == 2
        assert audio.shape[1] == window.shape[1]


def test_midi_writer_produces_standard_header(tmp_path):
    dest = tmp_path / "sketch.mid"
    remix_kit.write_midi(dest, [(0.0, 0.5, 60, 80), (0.5, 1.0, 64, 90)], bpm=120)
    data = dest.read_bytes()
    assert data[:4] == b"MThd"
    assert data[8:14] == struct.pack(">HHH", 0, 1, 480)
    assert b"MTrk" in data
    assert dest.stat().st_size > 20


def test_c_major_chroma_detects_c_or_relative():
    sr = 22050
    t = np.linspace(0, 2.0, int(sr * 2), endpoint=False)
    # C major triad: C3, E3, G3
    freqs = [130.81, 164.81, 196.00]
    y = sum(0.3 * np.sin(2 * np.pi * f * t) for f in freqs).astype(np.float32)
    chords = remix_kit.detect_chords(y, sr, hop_seconds=1.0)
    labels = {event["chord"] for event in chords}
    assert labels, "expected at least one chord"
    assert any(label.startswith("C") or label in {"Am", "Em"} for label in labels)


def test_song_sheet_mentions_stems_and_chords():
    sheet = remix_kit.format_song_sheet(
        "Demo",
        92.0,
        "A minor",
        [{"time": 0.0, "chord": "Am"}, {"time": 2.5, "chord": "F"}],
        ["vocals", "drums"],
    )
    assert "92.0" in sheet
    assert "A minor" in sheet
    assert "Am" in sheet
    assert "vocals" in sheet
    assert "remix kit" in sheet.lower()
