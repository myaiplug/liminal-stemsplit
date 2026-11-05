import json
import os

import pytest

import split_recovery as sr


# ---------------------------------------------------------------- classification

@pytest.mark.parametrize("text,category", [
    ("torch.cuda.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB", sr.CAT_OOM),
    ("RuntimeError: [ONNXRuntimeError] : 6 : RUNTIME_EXCEPTION : Non-zero status code: Failed to allocate memory", sr.CAT_OOM),
    ("CUBLAS_STATUS_ALLOC_FAILED when calling cublasCreate", sr.CAT_OOM),
    ("ModuleNotFoundError: No module named 'audio_separator'", sr.CAT_DEPENDENCY),
    ("ImportError: DLL load failed while importing onnxruntime_pybind11_state", sr.CAT_DEPENDENCY),
    ("FileNotFoundError: [Errno 2] No such file or directory: 'models/htdemucs_ft.th'", sr.CAT_MODEL),
    ("_pickle.UnpicklingError: invalid load key, '<'.", sr.CAT_MODEL),
    ("RuntimeError: PytorchStreamReader failed reading zip archive: failed finding central directory", sr.CAT_MODEL),
    ("urllib.error.HTTPError: HTTP Error 404: Not Found", sr.CAT_MODEL),
    ("RuntimeError: CUDA error: no kernel image is available for execution on the device", sr.CAT_CUDA),
    ("AssertionError: Torch not compiled with CUDA enabled", sr.CAT_CUDA),
    ("[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] moov atom not found", sr.CAT_DECODE),
    ("soundfile.LibsndfileError: Error opening 'x.mp3': Format not recognised.", sr.CAT_DECODE),
    ("Validation failed: File not found: C:/music/a.wav", sr.CAT_INPUT_MISSING),
    ("something nobody has seen before", sr.CAT_UNKNOWN),
    ("", sr.CAT_UNKNOWN),
])
def test_classify(text, category):
    assert sr.classify_error(text).category == category


def test_classify_extracts_module_name():
    info = sr.classify_error("Traceback...\nModuleNotFoundError: No module named 'rotary_embedding_torch.foo'")
    assert info.category == sr.CAT_DEPENDENCY
    assert info.module == "rotary_embedding_torch"


def test_oom_beats_cuda_error():
    # "CUDA error: out of memory" must be an OOM (shrink chunks), not a generic CUDA error (CPU)
    assert sr.classify_error("RuntimeError: CUDA error: out of memory").category == sr.CAT_OOM


def test_manifest_error_text_joins_fields():
    text = sr.manifest_error_text({"error_type": "RuntimeError", "error_message": "boom", "errors": ["a", "b"]})
    assert "RuntimeError" in text and "boom" in text and "a\nb" in text


# ---------------------------------------------------------------- planning

def _state(**cfg):
    base = {"device": "cuda", "engine": "roformer", "model_variant": "roformer_bs_317", "stems": 2}
    base.update(cfg)
    return sr.RecoveryState(config=base, input_file="in.wav")


def test_oom_ladder_shrinks_then_cpu_then_fallback():
    st = _state()
    info = sr.ErrorInfo(sr.CAT_OOM)
    a1 = sr.plan_recovery(info, st)
    assert a1.name == "shrink_chunks" and a1.overrides["chunk_duration"] == 60 and a1.overrides["shifts"] == 1
    st.tried.append(a1.name)
    st.config.update(a1.overrides)
    a2 = sr.plan_recovery(info, st)
    assert a2.name == "cpu_fallback" and a2.overrides["device"] == "cpu"
    st.tried.append(a2.name)
    st.config.update(a2.overrides)
    a3 = sr.plan_recovery(info, st)
    assert a3.name == "fallback_model" and a3.overrides["model_variant"] == sr.FALLBACK_MODEL_4S
    st.tried.append(a3.name)
    st.config.update(a3.overrides)
    assert sr.plan_recovery(info, st) is None


def test_chunk_and_segment_halve():
    assert sr._next_chunk({"chunk_duration": 60}) == 30
    assert sr._next_chunk({"chunk_duration": 12}) == 10
    assert sr._next_segment({}) == 4.0
    assert sr._next_segment({"demucs_segment": 4.0}) == 2.0
    assert sr._next_segment({"demucs_segment": 2.0}) == 1.5


def test_missing_model_repairs_then_falls_back():
    st = _state()
    info = sr.ErrorInfo(sr.CAT_MODEL)
    a1 = sr.plan_recovery(info, st)
    assert a1.side_effect == "repair_model"
    st.tried.append(a1.name)
    assert sr.plan_recovery(info, st).name == "fallback_model"


def test_fallback_uses_6s_model_for_many_stems():
    st = _state(stems=6)
    a = sr.plan_recovery(sr.ErrorInfo(sr.CAT_CUDA), _state(stems=6, device="cpu"))
    assert a.overrides["model_variant"] == sr.FALLBACK_MODEL_6S


def test_decode_reencodes_normal_then_lenient_then_gives_up():
    st = _state()
    info = sr.ErrorInfo(sr.CAT_DECODE)
    assert sr.plan_recovery(info, st).name == "transcode_input"
    st.transcoded = True
    assert sr.plan_recovery(info, st).name == "transcode_input_lenient"
    st.transcoded_hard = True
    assert sr.plan_recovery(info, st) is None


def test_missing_input_is_not_recoverable():
    assert sr.plan_recovery(sr.ErrorInfo(sr.CAT_INPUT_MISSING), _state()) is None


def test_unknown_falls_back_to_known_good_model_first():
    a = sr.plan_recovery(sr.ErrorInfo(sr.CAT_UNKNOWN), _state())
    assert a.name == "fallback_model"


# ---------------------------------------------------------------- driver

class FakeDoctor:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def repair_model(self, variant, config):
        self.calls.append(("model", variant))
        return {"ok": self.ok, "detail": "fake"}

    def repair_dependency(self, module):
        self.calls.append(("dep", module))
        return {"ok": self.ok, "detail": "fake"}


def _fail(msg):
    return {"status": "failed", "errors": [msg], "stems": {}, "process_duration_seconds": 0}


def _ok():
    return {"status": "success", "stems": {"vocals": {}}, "errors": [], "process_duration_seconds": 1}


def _run(script, config=None, doctor=None, transcoder=None, max_retries=None, tmp=None, events=None, progress=None):
    """script: list of manifests (or callables(config, input)) returned per attempt."""
    calls = []

    def run_attempt(cfg, inp):
        calls.append((dict(cfg), inp))
        item = script[min(len(calls) - 1, len(script) - 1)]
        return item(cfg, inp) if callable(item) else dict(item)

    kwargs = dict(
        run_attempt=run_attempt,
        config=config or {"device": "cuda", "engine": "roformer", "model_variant": "roformer_bs_317", "stems": 2},
        input_file="song.mp3",
        emit_progress=(lambda *a: progress.append(a)) if progress is not None else None,
        emit_event=(lambda e: events.append(e)) if events is not None else None,
        output_dir=str(tmp) if tmp else None,
        doctor=doctor or FakeDoctor(),
        max_retries=max_retries,
    )
    if transcoder:
        kwargs["transcoder"] = transcoder
    manifest, final_cfg = sr.run_with_recovery(**kwargs)
    return manifest, final_cfg, calls


def test_success_first_try_no_recovery(tmp_path):
    m, cfg, calls = _run([_ok()], tmp=tmp_path)
    assert m["status"] == "success" and len(calls) == 1
    assert m["recovery"]["attempted"] is False and m["recovery"]["recovered"] is False
    assert os.path.exists(m["diagnostic_log"])


def test_oom_recovers_with_smaller_chunks(tmp_path):
    events, progress = [], []
    m, cfg, calls = _run([_fail("CUDA out of memory"), _ok()], tmp=tmp_path, events=events, progress=progress)
    assert m["status"] == "success" and len(calls) == 2
    assert calls[1][0]["chunk_duration"] == 60 and calls[1][0]["shifts"] == 1
    assert m["recovery"]["recovered"] is True
    assert any("Recovering" in p[2] for p in progress)
    kinds = [e["event"] for e in events]
    assert kinds == ["recovery", "recovery_result"]
    assert events[-1]["ok"] is True
    log = (tmp_path / "split_diagnostics.log").read_text()
    assert "shrink_chunks" in log and "Outcome" in log


def test_retry_budget_is_bounded(tmp_path):
    m, cfg, calls = _run([_fail("totally unexpected explosion")], tmp=tmp_path)
    assert len(calls) <= 1 + sr.MAX_RETRIES
    assert m["status"] == "failed"
    assert m["recovery"]["recovered"] is False
    assert any("Auto-recovery" in e for e in m["errors"])


def test_max_retries_override_zero_means_single_attempt():
    m, cfg, calls = _run([_fail("CUDA out of memory"), _ok()], max_retries=0)
    assert len(calls) == 1 and m["status"] == "failed"


def test_env_var_controls_retry_budget(monkeypatch):
    monkeypatch.setenv("LIMINAL_MAX_RECOVERY_RETRIES", "1")
    m, cfg, calls = _run([_fail("unexpected"), _fail("unexpected"), _ok()])
    assert len(calls) == 2


def test_missing_model_repair_then_retry():
    doctor = FakeDoctor()
    m, cfg, calls = _run([_fail("FileNotFoundError: No such file or directory: 'x.ckpt'"), _ok()], doctor=doctor)
    assert m["status"] == "success"
    assert doctor.calls == [("model", "roformer_bs_317")]


def test_missing_dependency_repair_then_retry():
    doctor = FakeDoctor()
    m, cfg, calls = _run([_fail("ModuleNotFoundError: No module named 'einops'"), _ok()], doctor=doctor)
    assert m["status"] == "success" and doctor.calls == [("dep", "einops")]


def test_decode_error_reencodes_input_and_retries():
    seen = []

    def fake_transcoder(path, lenient=False, **_):
        seen.append((path, lenient))
        return "/tmp/clean/song.wav"

    m, cfg, calls = _run([_fail("moov atom not found"), _ok()], transcoder=fake_transcoder)
    assert m["status"] == "success"
    assert calls[0][1] == "song.mp3" and calls[1][1] == "/tmp/clean/song.wav"
    assert seen == [("song.mp3", False)]


def test_decode_error_second_pass_is_lenient():
    seen = []

    def fake_transcoder(path, lenient=False, **_):
        seen.append(lenient)
        return "/tmp/clean/song.wav"

    m, cfg, calls = _run([_fail("Invalid data found when processing input"),
                          _fail("Invalid data found when processing input"), _ok()], transcoder=fake_transcoder)
    assert m["status"] == "success" and seen == [False, True]


def test_unknown_error_falls_back_to_htdemucs():
    m, cfg, calls = _run([_fail("weird"), _ok()])
    assert m["status"] == "success"
    assert cfg["model_variant"] == sr.FALLBACK_MODEL_4S and cfg["engine"] == "demucs"


def test_run_attempt_exception_is_captured_not_raised():
    def boom(cfg, inp):
        raise RuntimeError("CUDA out of memory")

    m, cfg, calls = _run([boom, _ok()])
    assert m["status"] == "success" and len(calls) == 2


def test_input_missing_stops_immediately():
    m, cfg, calls = _run([_fail("Validation failed: File not found: x")])
    assert len(calls) == 1 and m["status"] == "failed"


def test_transcode_to_wav_builds_ffmpeg_command(tmp_path):
    captured = {}

    class Proc:
        returncode = 0
        stderr = ""

    def runner(cmd, **kw):
        captured["cmd"] = cmd
        with open(cmd[-1], "wb") as fh:
            fh.write(b"0" * 4096)
        return Proc()

    out = sr.transcode_to_wav(str(tmp_path / "Song.m4a"), lenient=True, ffmpeg="ffmpeg", runner=runner)
    assert out.endswith("Song.wav")
    assert "-err_detect" in captured["cmd"] and "pcm_s16le" in captured["cmd"]


def test_transcode_failure_raises(tmp_path):
    class Proc:
        returncode = 1
        stderr = "bad"

    with pytest.raises(RuntimeError):
        sr.transcode_to_wav("x.mp3", ffmpeg="ffmpeg", runner=lambda *a, **k: Proc())


def test_broken_native_library_is_a_dependency_problem_not_decode():
    text = "OSError: Could not load this library: C:/x/site-packages/torchaudio/lib/_torchaudio.pyd"
    info = sr.classify_error(text)
    assert info.category == sr.CAT_DEPENDENCY and info.module == "torchaudio"
