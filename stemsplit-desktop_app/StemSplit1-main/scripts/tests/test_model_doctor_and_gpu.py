import io
import json
import types
import zipfile
from pathlib import Path

import pytest

import gpu_runtime as gr
import model_doctor as md


# ------------------------------------------------------------------ file validation

def test_file_looks_valid(tmp_path):
    good_ckpt = tmp_path / "m.ckpt"
    with zipfile.ZipFile(good_ckpt, "w") as z:
        z.writestr("data.pkl", "x" * 100)
    assert md.file_looks_valid(good_ckpt)

    html = tmp_path / "bad.ckpt"
    html.write_text("<!DOCTYPE html><html>" + "x" * 200)
    assert not md.file_looks_valid(html)

    tiny = tmp_path / "tiny.onnx"
    tiny.write_bytes(b"\x08")
    assert not md.file_looks_valid(tiny)

    onnx = tmp_path / "ok.onnx"
    onnx.write_bytes(b"\x08\x07" + b"0" * 200)
    assert md.file_looks_valid(onnx)

    yml = tmp_path / "c.yaml"
    yml.write_text("audio:\n  chunk_size: 1\n" * 5)
    assert md.file_looks_valid(yml)
    html_yaml = tmp_path / "c2.yaml"
    html_yaml.write_text("<!doctype html>" + " " * 100)
    assert not md.file_looks_valid(html_yaml)
    assert not md.file_looks_valid(tmp_path / "missing.ckpt")


def test_torch_companion_spec():
    assert md.torch_companion_spec("2.13.0+cu126", "torchvision")["spec"] == "torchvision==0.28.0+cu126"
    assert md.torch_companion_spec("2.5.1+cpu", "torchvision")["spec"] == "torchvision==0.20.1+cpu"
    assert md.torch_companion_spec("2.5.1", "torchaudio")["spec"] == "torchaudio==2.5.1+cpu"
    assert md.torch_companion_spec("2.13.0+cu126", "torchaudio") is None   # no wheel exists
    assert md.torch_companion_spec("garbage", "torchvision") is None
    assert md.torch_companion_spec("2.5.1", "numpy") is None


# ------------------------------------------------------------------ downloads

class FakeResp:
    def __init__(self, data):
        self._b = io.BytesIO(data)
        self.headers = {"Content-Length": str(len(data))}

    def read(self, n=-1):
        return self._b.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_try_download_success_atomic(tmp_path):
    seen = []
    res = md.try_download("https://x.test/a.bin", tmp_path / "a.bin", opener=lambda req, timeout: FakeResp(b"hello" * 100),
                          progress=lambda d, t: seen.append((d, t)), sleep=lambda s: None)
    assert res["ok"] and (tmp_path / "a.bin").read_bytes() == b"hello" * 100
    assert not (tmp_path / "a.bin.part").exists() and seen[-1] == (500, 500)


def test_try_download_retries_then_succeeds(tmp_path):
    calls = {"n": 0}

    def opener(req, timeout):
        calls["n"] += 1
        if calls["n"] < 3:
            raise OSError("flaky")
        return FakeResp(b"data" * 10)

    res = md.try_download("https://x.test/a", tmp_path / "a", opener=opener, sleep=lambda s: None)
    assert res["ok"] and calls["n"] == 3


def test_try_download_checksum_mismatch_leaves_no_file(tmp_path):
    res = md.try_download("https://x.test/a", tmp_path / "a", expected_sha256="0" * 64,
                          opener=lambda r, timeout: FakeResp(b"abc"), sleep=lambda s: None, retries=2)
    assert not res["ok"] and "sha256" in res["detail"]
    assert not (tmp_path / "a").exists() and not (tmp_path / "a.part").exists()


def test_try_download_checksum_match(tmp_path):
    import hashlib
    data = b"abc" * 50
    res = md.try_download("https://x.test/a", tmp_path / "a", expected_sha256=hashlib.sha256(data).hexdigest(),
                          opener=lambda r, timeout: FakeResp(data))
    assert res["ok"]


def test_try_download_empty_response_fails(tmp_path):
    res = md.try_download("https://x.test/a", tmp_path / "a", opener=lambda r, timeout: FakeResp(b""),
                          sleep=lambda s: None, retries=1)
    assert not res["ok"]


# ------------------------------------------------------------------ script self-heal

def test_self_heal_restores_broken_script_from_tag_then_main(tmp_path):
    for name in md.REQUIRED_SCRIPT_FILES:
        (tmp_path / name).write_text("x = 1\n")
    (tmp_path / "splitter.py").write_text("def broken(:\n")        # syntax error
    (tmp_path / "model_catalog.py").unlink()                      # missing
    (tmp_path / "__pycache__").mkdir()
    urls = []

    def fetch(url, dest, **_):
        urls.append(url)
        if "/v0.7.0/" in url and url.endswith("splitter.py"):
            return {"ok": False, "detail": "404"}               # tag missing -> must fall back to main
        Path(dest).write_text("y = 2\n")
        return {"ok": True, "detail": "ok"}

    res = md.self_heal_script_files(tmp_path, version="0.7.0", fetch=fetch)
    assert res["ok"] and sorted(res["repaired"]) == ["model_catalog.py", "splitter.py"]
    assert any("/v0.7.0/" in u for u in urls) and any("/main/" in u for u in urls)
    assert (tmp_path / "splitter.py").read_text() == "y = 2\n"
    assert not (tmp_path / "__pycache__").exists()


def test_self_heal_reports_failures(tmp_path):
    for name in md.REQUIRED_SCRIPT_FILES:
        (tmp_path / name).write_text("x = 1\n")
    (tmp_path / "hardware.py").unlink()
    res = md.self_heal_script_files(tmp_path, version="0.7.0", fetch=lambda url, dest, **_: {"ok": False, "detail": "x"})
    assert not res["ok"] and res["failed"] == ["hardware.py"]


def test_required_scripts_exist_in_repo():
    scripts = Path(md.__file__).parent
    missing = [n for n in md.REQUIRED_SCRIPT_FILES if not (scripts / n).is_file()]
    assert not missing


# ------------------------------------------------------------------ repair_import

def test_repair_import_pip_installs_mapped_package(monkeypatch):
    cmds = []

    def runner(cmd, **kw):
        cmds.append(cmd)
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(md, "_can_import", lambda m: True)
    res = md.repair_import("yaml", runner)
    assert res["ok"]
    assert any(c[-1] == "pyyaml" or "pyyaml" in " ".join(c).lower() for c in cmds)


def test_repair_import_reports_pip_failure(monkeypatch):
    monkeypatch.setattr(md, "_can_import", lambda m: False)
    runner = lambda cmd, **kw: types.SimpleNamespace(returncode=1, stdout="", stderr="no matching distribution")
    res = md.repair_import("einops", runner)
    assert not res["ok"] and "pip failed" in res["detail"]


# ------------------------------------------------------------------ variant repair

def test_repair_variant_unknown(tmp_path):
    res = md.repair_variant("definitely_not_a_variant", model_dir=tmp_path)
    assert not res["ok"]


def test_variant_files_includes_yaml_and_extra():
    meta = {"filename": "a.ckpt", "files": [{"name": "a.yaml"}, {"name": "a.ckpt"}], "extra_files": ["b.bin"]}
    assert md.variant_files(meta) == ["a.ckpt", "a.yaml", "b.bin"]


# ------------------------------------------------------------------ GPU runtime

def _runner_factory(responses, record):
    def runner(cmd, **kw):
        record.append(cmd)
        joined = " ".join(map(str, cmd))
        for key, resp in responses.items():
            if key in joined:
                return resp(cmd) if callable(resp) else resp
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    return runner


def _probe_stdout(cuda, ort=("CUDAExecutionProvider", "CPUExecutionProvider"), demucs=True):
    return "__PROBE__" + json.dumps({"cuda": cuda, "ort_providers": list(ort), "demucs": demucs, "cuda_tensor_ok": True})


NVIDIA_OK = {"present": True, "name": "RTX 2080 SUPER", "vram_gb": 8.0, "driver": "610.47", "driver_major": 610, "driver_ok": True}


def test_cuda_plan_pins_versions_and_swaps_onnxruntime():
    plan = gr.cuda_plan("python")
    text = "\n".join(" ".join(s["cmd"]) for s in plan)
    assert "torch==2.13.0+cu126" in text and "https://download.pytorch.org/whl/cu126" in text
    assert "--no-deps" in text and "--force-reinstall" in text
    assert "torchvision==0.28.0+cu126" in text
    assert "uninstall -y onnxruntime onnxruntime-gpu" in text
    assert "onnxruntime-gpu==1.23.2" in text
    # onnxruntime must be removed before onnxruntime-gpu is installed
    assert text.index("uninstall -y onnxruntime") < text.index("onnxruntime-gpu==1.23.2")


def test_install_runtime_no_gpu_keeps_cpu():
    rec = []
    res = gr.install_runtime("python", runner=_runner_factory({}, rec), nvidia={"present": False}, log=lambda m: None)
    assert res["mode"] == "cpu" and res["ok"] and rec == []


def test_install_runtime_old_driver_keeps_cpu():
    nv = dict(NVIDIA_OK, driver="472.12", driver_major=472, driver_ok=False)
    res = gr.install_runtime("python", runner=_runner_factory({}, []), nvidia=nv, log=lambda m: None)
    assert res["mode"] == "cpu" and "driver" in res["reason"].lower()


def test_install_runtime_dry_run_does_nothing():
    rec = []
    res = gr.install_runtime("python", dry_run=True, runner=_runner_factory({}, rec), nvidia=NVIDIA_OK, log=lambda m: None)
    assert res["plan"] and rec == []


def test_install_runtime_success_path():
    rec = []
    state = {"installed": False}

    def pip(cmd):
        if "torch==2.13.0" in " ".join(cmd):
            state["installed"] = True
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    def probe(cmd):
        return types.SimpleNamespace(returncode=0, stdout=_probe_stdout(state["installed"]), stderr="")

    runner = _runner_factory({"pip": pip, "__PROBE__": probe}, rec)
    res = gr.install_runtime("python", runner=runner, nvidia=NVIDIA_OK, log=lambda m: None)
    assert res["mode"] == "cuda" and res["ok"] and not res["fell_back"]


def test_install_runtime_skips_when_already_healthy():
    rec = []
    runner = _runner_factory({"__PROBE__": types.SimpleNamespace(returncode=0, stdout=_probe_stdout(True), stderr="")}, rec)
    res = gr.install_runtime("python", runner=runner, nvidia=NVIDIA_OK, log=lambda m: None)
    assert res["mode"] == "cuda" and not any("pip" in " ".join(c) and "install" in c for c in rec)


def test_install_runtime_falls_back_to_cpu_when_cuda_unverified():
    rec = []
    runner = _runner_factory({"__PROBE__": types.SimpleNamespace(returncode=0, stdout=_probe_stdout(False), stderr="")}, rec)
    res = gr.install_runtime("python", runner=runner, nvidia=NVIDIA_OK, log=lambda m: None)
    assert res["fell_back"] and res["mode"] == "cpu"
    joined = "\n".join(" ".join(map(str, c)) for c in rec)
    assert "torch==2.5.1" in joined and "onnxruntime" in joined      # CPU stack restored


def test_install_runtime_falls_back_when_pip_fails():
    rec = []

    def pip(cmd):
        failing = "2.13.0" in " ".join(cmd)
        return types.SimpleNamespace(returncode=1 if failing else 0, stdout="", stderr="network down" if failing else "")

    probe = types.SimpleNamespace(returncode=0, stdout=_probe_stdout(False), stderr="")
    runner = _runner_factory({"pip": pip, "__PROBE__": lambda cmd: probe}, rec)
    res = gr.install_runtime("python", runner=runner, nvidia=NVIDIA_OK, log=lambda m: None)
    assert res["fell_back"] and res["mode"] == "cpu"


def test_detect_nvidia_parses_smi(monkeypatch):
    monkeypatch.setattr(gr.shutil, "which", lambda n: "/usr/bin/nvidia-smi")
    out = types.SimpleNamespace(returncode=0, stdout="NVIDIA GeForce RTX 2080 SUPER, 8192, 610.47\n", stderr="")
    info = gr.detect_nvidia(runner=lambda cmd, **kw: out)
    assert info["present"] and info["vram_gb"] == 8.0 and info["driver_major"] == 610 and info["driver_ok"]


def test_detect_nvidia_absent(monkeypatch):
    monkeypatch.setattr(gr.shutil, "which", lambda n: None)
    assert gr.detect_nvidia()["present"] is False


def test_ensure_torchaudio_installs_stub_when_import_fails(monkeypatch):
    import builtins
    import sys
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "torchaudio":
            raise OSError("Could not load this library")
        return real_import(name, *a, **k)

    monkeypatch.delitem(sys.modules, "torchaudio", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    try:
        assert gr.ensure_torchaudio() is False
        assert getattr(sys.modules["torchaudio"], "__liminal_stub__", False)
    finally:
        sys.modules.pop("torchaudio", None)
