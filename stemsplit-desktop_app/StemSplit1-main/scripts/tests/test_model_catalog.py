import json
import os
from pathlib import Path

import pytest

import model_catalog as mc
import model_registry


MODELS_JSON = {
    "vr_download_list": {"VR Arch Single Model v5: UVR-DeNoise": "UVR-DeNoise.pth"},
    "mdx_download_list": {"MDX-Net Model: UVR-MDX-NET Inst HQ 3": "UVR-MDX-NET-Inst_HQ_3.onnx",
                          "MDX-Net Model VIP: Patreon Only": "VIP_model.onnx"},
    "mdx23c_download_list": {"MDX23C Model: MDX23C-InstVoc HQ": {"MDX23C-8KFFT-InstVoc_HQ.ckpt": "model_2_stem_full_band_8k.yaml"}},
    "roformer_download_list": {
        "Roformer Model: BS-Roformer-Viperx-1297": {"model_bs_roformer_ep_317_sdr_12.9755.ckpt": "model_bs_roformer_ep_317_sdr_12.9755.yaml"},
        "Roformer Model VIP: Secret": {"secret.ckpt": "secret.yaml"},
    },
}
SCORES = {"UVR-MDX-NET-Inst_HQ_3.onnx": {"median_scores": {"vocals": {"SDR": 11.5}, "instrumental": {"SDR": 17.1}},
                                          "stems": ["vocals", "instrumental"]}}


def entries():
    return mc.build_audio_separator_entries(MODELS_JSON, SCORES, {})


def test_builds_entries_and_excludes_vip():
    es = entries()
    names = {e["filename"] for e in es}
    assert "UVR-DeNoise.pth" in names and "UVR-MDX-NET-Inst_HQ_3.onnx" in names
    assert "VIP_model.onnx" not in names and "secret.ckpt" not in names
    inst = next(e for e in es if e["filename"] == "UVR-MDX-NET-Inst_HQ_3.onnx")
    assert inst["engine"] == "mdx_net" and inst["sdr"] == 17.1 and inst["stems"] == ["vocals", "instrumental"]
    ro = next(e for e in es if e["filename"].startswith("model_bs_roformer"))
    assert ro["engine"] == "roformer" and ro["family"] == "Roformer"
    assert [f["name"] for f in ro["files"]] == ["model_bs_roformer_ep_317_sdr_12.9755.ckpt", "model_bs_roformer_ep_317_sdr_12.9755.yaml"]
    assert all(f["url"].startswith("https://") for e in es for f in e["files"])


def test_vram_status_thresholds():
    assert mc.vram_status(None) == "unknown"
    assert mc.vram_status(2.0) == "ok"
    assert mc.vram_status(6.5) == "ok"
    assert mc.vram_status(7.0) == "tight"
    assert mc.vram_status(8.0) == "tight"
    assert mc.vram_status(8.5) == "too_big"
    assert mc.vram_status(8.5, budget_gb=12) == "ok"


def test_normalize_manifest_entry_rules():
    assert mc.normalize_manifest_entry({"filename": "notes.txt"}) is None
    assert mc.normalize_manifest_entry({"filename": "x.ckpt", "gated": True}) is None
    assert mc.normalize_manifest_entry({"filename": "x.ckpt", "license": "proprietary"}) is None
    e = mc.normalize_manifest_entry({"filename": "my_roformer.ckpt", "name": "Mine", "size_mb": 640})
    assert e["id"] == "catalog_my_roformer" and e["engine"] == "roformer"
    assert e["size_mb"] == 640 and not e["size_estimated"] and e["vram_estimated"]


def test_merge_override_wins_but_keeps_files_and_real_size():
    base = [{"filename": "a.ckpt", "name": "A", "files": [{"name": "a.ckpt", "url": "u"}], "stems": ["vocals"],
             "sdr": 10, "size_mb": 700, "size_estimated": False, "vram_gb": 5, "vram_estimated": True}]
    over = [{"filename": "a.ckpt", "name": "A better", "files": [], "stems": [], "sdr": None,
             "size_mb": 300, "size_estimated": True, "vram_gb": 6.5, "vram_estimated": False},
            {"filename": "b.ckpt", "name": "B", "files": [], "stems": []},
            {"filename": "h.ckpt", "name": "H", "hidden": True}]
    merged = mc.merge_entries(base, over)
    a = next(m for m in merged if m["filename"] == "a.ckpt")
    assert a["name"] == "A better" and a["files"] and a["stems"] == ["vocals"] and a["sdr"] == 10
    assert a["size_mb"] == 700           # real size kept over an estimate
    assert a["vram_gb"] == 6.5           # measured VRAM replaces the estimate
    assert any(m["filename"] == "b.ckpt" for m in merged)
    assert not any(m["filename"] == "h.ckpt" for m in merged)  # hidden filtered out


def test_hf_candidates_only_open_ungated_unambiguous():
    def item(repo, tags, sibs, **kw):
        d = {"id": repo, "tags": tags, "siblings": [{"rfilename": s} for s in sibs], "likes": 5, "downloads": 10}
        d.update(kw)
        return d

    good = item("someone/cool-roformer", ["license:mit"], ["cool.ckpt", "cool.yaml"])
    gated = item("x/gated", ["license:mit"], ["g.ckpt", "g.yaml"], gated="manual")
    nolic = item("x/nolicense", [], ["n.ckpt", "n.yaml"])
    closed = item("x/closed", ["license:cc-by-nc-4.0"], ["c.ckpt", "c.yaml"])
    ambiguous = item("x/amb", ["license:mit"], ["a1.ckpt", "a2.ckpt", "a.yaml"])
    noyaml = item("x/noyaml", ["license:mit"], ["m.ckpt"])
    onnx = item("x/onnxy", ["license:apache-2.0"], ["m.onnx"])
    out = mc.hf_candidates([good, gated, nolic, closed, ambiguous, noyaml, onnx])
    ids = {o["filename"] for o in out}
    assert ids == {"cool.ckpt", "m.onnx"}
    cool = next(o for o in out if o["filename"] == "cool.ckpt")
    assert cool["unverified"] and cool["source"] == "huggingface"
    assert [f["name"] for f in cool["files"]] == ["cool.ckpt", "cool.yaml"]


def _fake_fetch(table):
    def fetch(url, *a, **k):
        for key, val in table.items():
            if url.endswith(key):
                if isinstance(val, Exception):
                    raise val
                return val
        raise OSError("404 " + url)
    return fetch


def test_refresh_merges_sources_and_writes_cache(isolated_data_dir):
    manifest = {"version": "1", "models": [{"filename": "UVR-DeNoise.pth", "name": "Denoise (curated)", "size_mb": 90, "vram_gb": 1.5},
                                           {"filename": "brand_new.ckpt", "name": "Brand New", "size_mb": 500, "vram_gb": 6}]}
    fetch = _fake_fetch({"models.json": MODELS_JSON, "models-scores.json": SCORES,
                         "download_checks.json": {}, "catalog.json": manifest})
    cat = mc.refresh(fetch=fetch)
    names = {m["filename"]: m for m in cat["models"]}
    assert names["UVR-DeNoise.pth"]["name"] == "Denoise (curated)" and names["UVR-DeNoise.pth"]["size_mb"] == 90
    assert "brand_new.ckpt" in names
    assert not cat["offline"]
    assert Path(mc.catalog_cache_path()).is_file()
    assert mc.load_catalog()["models"]


def test_refresh_survives_one_source_failing():
    fetch = _fake_fetch({"models.json": MODELS_JSON, "models-scores.json": SCORES, "download_checks.json": {},
                         "catalog.json": OSError("404")})
    cat = mc.refresh(fetch=fetch)
    assert cat["sources"]["manifest"].startswith("unavailable")
    assert cat["models"] and not cat["offline"]


def test_refresh_offline_uses_seed_then_cache():
    cat = mc.refresh(offline=True)
    assert cat["offline"] and cat["models"]
    assert cat["sources"].get("fallback") == "bundled seed"


def test_refresh_all_sources_down_falls_back_to_cache(isolated_data_dir):
    fetch_ok = _fake_fetch({"models.json": MODELS_JSON, "models-scores.json": SCORES, "download_checks.json": {},
                            "catalog.json": {"models": []}})
    mc.refresh(fetch=fetch_ok)
    def down(url, *a, **k):
        raise OSError("no network")
    cat = mc.refresh(fetch=down)
    assert cat["offline"] and cat["sources"]["fallback"] == "cache"
    assert any(m["filename"] == "UVR-DeNoise.pth" for m in cat["models"])


def test_bundled_seed_is_valid_and_has_no_vip():
    seed = mc.load_seed()
    assert seed and len(seed["models"]) > 50
    assert not any(m.get("vip") for m in seed["models"])
    assert all(m["files"] and m["filename"] for m in seed["models"])
    ids = [m["id"] for m in seed["models"]]
    assert len(ids) == len(set(ids))


def test_annotate_flags(tmp_path):
    cat = [{"id": "catalog_a", "filename": "a.onnx", "vram_gb": 3.0},
           {"id": "catalog_big", "filename": "big.ckpt", "vram_gb": 10.0},
           {"id": "catalog_inst", "filename": "installed.ckpt", "vram_gb": 5.0}]
    (tmp_path / "installed.ckpt").write_bytes(b"x" * 100)
    out = {e["id"]: e for e in mc.annotate(cat, budget_gb=8, model_dir=tmp_path)}
    assert out["catalog_a"]["new"] and out["catalog_a"]["fits_vram"]
    assert out["catalog_big"]["vram_status"] == "too_big" and not out["catalog_big"]["fits_vram"]
    assert out["catalog_inst"]["installed"] and not out["catalog_inst"]["new"]


def test_builtin_filename_is_not_new(tmp_path):
    fn = model_registry.MODEL_VARIANTS["roformer_bs_317"]["filename"] if "roformer_bs_317" in model_registry.MODEL_VARIANTS else None
    if not fn:
        pytest.skip("variant id differs")
    out = mc.annotate([{"id": "catalog_x", "filename": fn, "vram_gb": 5}], model_dir=tmp_path)[0]
    assert out["builtin_variant"] and not out["new"]


# ------------------------------------------------------------ download + registry

ENTRY = {"id": "catalog_my_model", "name": "My Model", "filename": "my_model.ckpt", "family": "Roformer",
         "engine": "roformer", "stems": ["vocals", "other"], "size_mb": 5, "vram_gb": 5,
         "files": [{"name": "my_model.ckpt", "url": "https://example.test/my_model.ckpt"},
                   {"name": "my_model.yaml", "url": "https://example.test/my_model.yaml"}],
         "source": "manifest", "license": "mit"}


def fake_downloader_factory(fail_for=()):
    calls = []

    def dl(url, dest, expected_sha256=None, progress=None, **_):
        calls.append(url)
        if any(f in url for f in fail_for):
            return {"ok": False, "detail": "boom"}
        dest = Path(dest)
        dest.write_bytes(b"PK\x03\x04" + b"0" * 200 if dest.suffix == ".ckpt" else b"audio:\n  chunk_size: 1\n")
        if progress:
            progress(100, 200)
            progress(200, 200)
        return {"ok": True, "detail": "ok"}
    dl.calls = calls
    return dl


def test_download_registers_model_and_merges_into_model_registry(tmp_path):
    events = []
    res = mc.download_model("catalog_my_model", emit=events.append, catalog={"models": [ENTRY]},
                            model_dir=tmp_path / "models", downloader=fake_downloader_factory())
    assert res["ok"] and res["variant_id"] == "catalog_my_model"
    assert (tmp_path / "models" / "my_model.ckpt").is_file() and (tmp_path / "models" / "my_model.yaml").is_file()
    assert events and events[0]["event"] == "catalog_progress" and events[-1]["progress"] == 100
    variant = model_registry.resolve_model_variant("catalog_my_model")
    assert variant and variant["backend"] == "audio_separator" and variant["filename"] == "my_model.ckpt"
    assert "catalog_my_model" in model_registry.all_model_variants()


def test_download_failure_does_not_register(tmp_path):
    res = mc.download_model("catalog_my_model", catalog={"models": [ENTRY]}, model_dir=tmp_path / "m",
                            downloader=fake_downloader_factory(fail_for=("yaml",)))
    assert not res["ok"]
    assert "catalog_my_model" not in mc.load_registry().get("models", {})


def test_download_uses_fallback_url(tmp_path):
    entry = json.loads(json.dumps(ENTRY))
    entry["files"][0]["fallback_url"] = "https://mirror.test/my_model.ckpt"
    entry["files"][0]["url"] = "https://dead.test/my_model.ckpt"
    dl = fake_downloader_factory(fail_for=("dead.test",))
    res = mc.download_model("catalog_my_model", catalog={"models": [entry]}, model_dir=tmp_path / "m", downloader=dl)
    assert res["ok"] and "https://mirror.test/my_model.ckpt" in dl.calls


def test_download_unknown_model(tmp_path):
    res = mc.download_model("nope", catalog={"models": []}, model_dir=tmp_path)
    assert not res["ok"] and "not in the catalog" in res["detail"]


def test_remove_model_deletes_files_and_registry(tmp_path):
    mc.download_model("catalog_my_model", catalog={"models": [ENTRY]}, model_dir=tmp_path / "m",
                      downloader=fake_downloader_factory())
    res = mc.remove_model("catalog_my_model", model_dir=tmp_path / "m")
    assert res["ok"]
    assert not (tmp_path / "m" / "my_model.ckpt").exists()
    assert model_registry.resolve_model_variant("catalog_my_model") is None or \
        "catalog_my_model" not in model_registry.load_user_variants(force=True)


def test_registry_round_trip_and_builtin_precedence():
    mc.register_model(ENTRY)
    assert "catalog_my_model" in model_registry.load_user_variants(force=True)
    # builtins can't be shadowed by a user entry
    builtin_id = next(iter(model_registry.MODEL_VARIANTS))
    reg = mc.load_registry()
    reg["models"][builtin_id] = {"variant": {"backend": "audio_separator", "filename": "evil.ckpt"}}
    Path(mc.user_registry_path()).write_text(json.dumps(reg))
    model_registry.load_user_variants(force=True)
    assert model_registry.resolve_model_variant(builtin_id) == model_registry.MODEL_VARIANTS[builtin_id]


def test_corrupt_registry_file_is_ignored():
    Path(mc.user_registry_path()).write_text("{not json")
    assert model_registry.load_user_variants(force=True) == {}
