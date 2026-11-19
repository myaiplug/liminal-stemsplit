"""BS-Roformer-SW mirror fallback + checksum verification (offline; network test is opt-in)."""
import hashlib
import os
from pathlib import Path

import pytest

import model_mirrors as mm
import model_registry
import model_doctor

MSST_YAML = b"inference:\n  batch_size: 1\n  dim_t: 1101\n  num_overlap: 2\n  normalize: false"


def fake_downloader(payloads, calls):
    """payloads: url -> bytes (or None = HTTP error). Mimics model_doctor.try_download's sha check."""
    def dl(url, dest, expected_sha256=None, progress=None, **_):
        calls.append(url)
        data = payloads.get(url)
        if data is None:
            return {"ok": False, "detail": "HTTP Error 404"}
        if expected_sha256 and hashlib.sha256(data).hexdigest() != expected_sha256:
            return {"ok": False, "detail": "sha256 mismatch"}
        Path(dest).write_bytes(data)
        return {"ok": True, "detail": "ok"}
    return dl


def spec_for(data, sources):
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "sources": sources}


def test_registry_points_sw_at_mirrors_not_dead_repo():
    b = model_registry.INSTRUMENT_HF_BUNDLES["BS-Roformer-SW"]
    assert b.get("mirrored") and "repo_id" not in b
    files = mm.MIRRORED_BUNDLES["BS-Roformer-SW"]
    assert set(files) == set(b["files"])
    for spec in files.values():
        assert len(spec["sources"]) >= 3
        assert not any("jarredou/BS-Roformer-SW" in s["url"] for s in spec["sources"])
        # Every HF mirror is pinned to a commit, never a moving branch.
        assert not any("/resolve/main/" in s["url"] for s in spec["sources"])
    for vid, meta in model_registry.MODEL_VARIANTS.items():
        if meta.get("filename") == "BS-Roformer-SW.ckpt" and meta.get("backend") == "audio_separator":
            assert meta.get("hf_bundle") == "BS-Roformer-SW", vid


def test_falls_back_to_next_mirror_and_verifies(tmp_path):
    good = b"\x80weights" * 100
    spec = spec_for(good, [{"url": "a", "host": "A"}, {"url": "b", "host": "B"}, {"url": "c", "host": "C"}])
    calls = []
    res = mm.fetch_file(tmp_path / "m.ckpt", spec, fake_downloader({"a": None, "b": b"<html>tampered", "c": good}, calls))
    assert res["ok"] and res["host"] == "C"
    assert calls == ["a", "b", "c"]
    assert (tmp_path / "m.ckpt").read_bytes() == good


def test_all_mirrors_fail_reports_each(tmp_path):
    spec = spec_for(b"x" * 99, [{"url": "a", "host": "A"}, {"url": "b", "host": "B"}])
    res = mm.fetch_file(tmp_path / "m.ckpt", spec, fake_downloader({}, []))
    assert not res["ok"] and "A:" in res["detail"] and "B:" in res["detail"]
    assert not (tmp_path / "m.ckpt").exists()


def test_hf_yaml_is_rewritten_to_audio_separator_config(tmp_path):
    want = mm.sw_yaml_from_msst(MSST_YAML)
    assert b"dim_t: 801  # Changed from 1101" in want and want.endswith(b"false\n\n")
    spec = spec_for(want, [{"url": "dead", "host": "AS"},
                           {"url": "hf", "host": "HF", "sha256": hashlib.sha256(MSST_YAML).hexdigest(),
                            "transform": "sw_yaml_dim_t_801"}])
    res = mm.fetch_file(tmp_path / "BS-Roformer-SW.yaml", spec, fake_downloader({"hf": MSST_YAML}, []))
    assert res["ok"], res
    assert (tmp_path / "BS-Roformer-SW.yaml").read_bytes() == want
    assert not (tmp_path / "BS-Roformer-SW.yaml.mirror").exists()


def test_real_sw_yaml_transform_matches_pinned_hash():
    """The pinned hashes encode that HF yaml -> transform == audio-separator yaml, byte for byte."""
    files = mm.MIRRORED_BUNDLES["BS-Roformer-SW"]["BS-Roformer-SW.yaml"]
    hf = [s for s in files["sources"] if s.get("transform")]
    assert hf and all(s["sha256"] == mm.SW_YAML_HF_SHA256 for s in hf)


def test_ensure_bundle_replaces_wrong_size_file(tmp_path, monkeypatch):
    good = b"\x80" + b"w" * 200
    monkeypatch.setitem(mm.MIRRORED_BUNDLES, "T", {"t.ckpt": spec_for(good, [{"url": "a", "host": "A"}])})
    (tmp_path / "t.ckpt").write_bytes(b"<!doctype html>401")
    calls = []
    res = mm.ensure_bundle(tmp_path, "T", downloader=fake_downloader({"a": good}, calls))
    assert res["ok"] and calls == ["a"] and (tmp_path / "t.ckpt").read_bytes() == good
    calls.clear()
    assert mm.ensure_bundle(tmp_path, "T", downloader=fake_downloader({}, calls))["ok"]
    assert calls == []  # already present with the right size: no network


def test_model_doctor_uses_mirrors(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(mm, "ensure_bundle", lambda d, b, downloader=None, progress=None: seen.append(b) or {"ok": True, "detail": "x"})
    assert model_doctor.try_hf_bundle("BS-Roformer-SW", tmp_path)["ok"]
    assert seen == ["BS-Roformer-SW"]


@pytest.mark.skipif(not os.environ.get("LIMINAL_NETWORK_TESTS"), reason="set LIMINAL_NETWORK_TESTS=1 to hit the real mirrors")
def test_every_real_mirror_serves_the_pinned_bytes(tmp_path):
    for name, spec in mm.MIRRORED_BUNDLES["BS-Roformer-SW"].items():
        for src in spec["sources"]:
            one = dict(spec, sources=[src])
            target = tmp_path / src["host"].replace("/", "_") / name
            res = mm.fetch_file(target, one, downloader=model_doctor.try_download)
            assert res["ok"], res
            assert mm.file_ok(target, spec, full_hash=True)
