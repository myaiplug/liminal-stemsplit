"""Automatic troubleshooting for failed splits.

``classify_error`` turns raw error text into a category, ``plan_recovery`` picks
the next bounded fix, and ``run_with_recovery`` drives retries around a
``run_attempt`` callable. No heavy imports here so it is unit-testable anywhere.

Retry budget: one initial attempt + at most ``MAX_RETRIES`` (3) recovery
attempts, so a broken environment fails fast with a clear diagnostic instead of
looping.
"""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

MAX_RETRIES = 3

# Known-good fallbacks (ship with demucs, no extra downloads beyond the weights).
FALLBACK_MODEL_4S = "demucs_htdemucs"
FALLBACK_MODEL_6S = "demucs_htdemucs_6s"

CAT_OOM = "oom"
CAT_CUDA = "cuda_error"
CAT_MODEL = "model_missing"
CAT_DEPENDENCY = "missing_dependency"
CAT_DECODE = "decode_error"
CAT_INPUT_MISSING = "input_missing"
CAT_UNKNOWN = "unknown"

FRIENDLY = {
    CAT_OOM: "GPU ran out of memory",
    CAT_CUDA: "GPU/CUDA runtime problem",
    CAT_MODEL: "model file missing or corrupt",
    CAT_DEPENDENCY: "a Python dependency is missing",
    CAT_DECODE: "the audio file could not be decoded",
    CAT_INPUT_MISSING: "the input file was not found",
    CAT_UNKNOWN: "unexpected error",
}

_MODEL_EXT = r"\.(?:ckpt|onnx|pth|pt|th|yaml|yml|safetensors|bin)"

_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    (CAT_OOM, re.compile(
        r"out of memory|OutOfMemoryError|CUBLAS_STATUS_ALLOC_FAILED|cudaErrorMemoryAllocation|"
        r"CUDNN_STATUS_(?:ALLOC_FAILED|NOT_SUPPORTED)|can't allocate memory|Failed to allocate memory|"
        r"std::bad_alloc|\bMemoryError\b|not enough memory|insufficient memory|"
        r"CUDA error: (?:out of memory|an illegal memory access)", re.I)),
    (CAT_DEPENDENCY, re.compile(
        r"ModuleNotFoundError|No module named|ImportError: cannot import name|"
        r"DLL load failed|requires torchvision|requires 'audio-separator'|not installed\.|"
        r"Could not load this library|undefined symbol|cannot open shared object file", re.I)),
    (CAT_MODEL, re.compile(
        r"(?:No such file or directory|FileNotFoundError|cannot find|not found)[^\n]{0,200}" + _MODEL_EXT + r"|" +
        _MODEL_EXT + r"[^\n]{0,120}(?:not found|does not exist|missing)|"
        r"invalid load key|PytorchStreamReader failed|failed finding central directory|"
        r"Unexpected key\(s\) in state_dict|Missing key\(s\) in state_dict|size mismatch for|"
        r"Protobuf parsing failed|INVALID_PROTOBUF|Load model from [^\n]+ failed|"
        r"unpickling|UnpicklingError|EOFError: Ran out of input|checksum mismatch|"
        r"Model file[^\n]*not found|model [^\n]{0,80}not (?:found|available)|"
        r"urlopen error|HTTP Error 40[34]|Failed to download|ConnectionError|"
        r"Max retries exceeded|response code: (?:403|404|5\d\d)|Unknown model|bad magic number|"
        r"File is not a zip file|corrupt", re.I)),
    (CAT_CUDA, re.compile(
        r"CUDA error|cuDNN error|CUDNN_STATUS|no kernel image is available|CUDA driver version is insufficient|"
        r"Torch not compiled with CUDA|CUDAExecutionProvider|cudaGetDeviceCount|CUDA initialization|"
        r"Found no NVIDIA driver|device-side assert|CUDA_ERROR|NCCL|cublas|"
        r"LoadLibrary failed with error 126|Expected all tensors to be on the same device", re.I)),
    (CAT_INPUT_MISSING, re.compile(
        r"Validation failed: (?:File not found|Input file not found|File does not exist)|"
        r"Input file does not exist", re.I)),
    (CAT_DECODE, re.compile(
        r"ffmpeg|ffprobe|Invalid data found when processing input|moov atom not found|"
        r"NoBackendError|audioread|Format not recognised|LibsndfileError|Error opening|"
        r"Validation failed|could not (?:be )?(?:decode|read|load)|Unsupported (?:audio )?format|"
        r"Failed to load audio|Audio loading failed|Error reading|Unable to decode|"
        r"Output file does not contain any stream|Decoder|codec", re.I)),
]

_SITE_PKG_RE = re.compile(r"site-packages[\\/]+([A-Za-z0-9_]+)")
_MODULE_RE = re.compile(r"No module named ['\"]([A-Za-z0-9_.\-]+)['\"]")
_CANNOT_IMPORT_RE = re.compile(r"cannot import name ['\"][^'\"]+['\"] from ['\"]([A-Za-z0-9_.\-]+)['\"]")
_REQUIRES_TV_RE = re.compile(r"requires (torchvision|onnx2torch)", re.I)


@dataclass
class ErrorInfo:
    category: str
    detail: str = ""
    module: Optional[str] = None

    @property
    def friendly(self) -> str:
        return FRIENDLY.get(self.category, FRIENDLY[CAT_UNKNOWN])


def classify_error(text: str) -> ErrorInfo:
    """Classify raw error/log text. The first matching category wins (ordered by specificity)."""
    text = text or ""
    detail = ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        detail = lines[-1][:300]
    for category, pattern in _PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        module = None
        if category == CAT_DEPENDENCY:
            m = (_MODULE_RE.search(text) or _CANNOT_IMPORT_RE.search(text) or _REQUIRES_TV_RE.search(text)
                 or _SITE_PKG_RE.search(text))
            if m:
                module = m.group(1).split(".")[0]
        # Prefer the line that actually matched as the detail.
        for ln in lines:
            if pattern.search(ln):
                detail = ln[:300]
                break
        return ErrorInfo(category, detail, module)
    return ErrorInfo(CAT_UNKNOWN, detail)


def manifest_error_text(manifest: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key in ("error_type", "error_message"):
        if manifest.get(key):
            parts.append(str(manifest[key]))
    parts.extend(str(e) for e in (manifest.get("errors") or []))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Recovery planning
# ---------------------------------------------------------------------------

@dataclass
class RecoveryAction:
    name: str                       # machine id (shrink_chunks, cpu_fallback, ...)
    message: str                    # user-facing "Recovering: ..." text
    overrides: Dict[str, Any] = field(default_factory=dict)
    side_effect: Optional[str] = None   # repair_model | repair_dependency | transcode_input


@dataclass
class RecoveryState:
    config: Dict[str, Any]
    input_file: str
    tried: List[str] = field(default_factory=list)
    transcoded: bool = False
    transcoded_hard: bool = False


def _next_chunk(config: Dict[str, Any]) -> int:
    current = config.get("chunk_duration")
    try:
        current = int(current) if current else 0
    except (TypeError, ValueError):
        current = 0
    if current <= 0:
        return 60
    return max(10, current // 2)


def _next_segment(config: Dict[str, Any]) -> float:
    current = config.get("demucs_segment")
    try:
        current = float(current) if current else 0.0
    except (TypeError, ValueError):
        current = 0.0
    if current <= 0:
        return 4.0
    return max(1.5, round(current / 2, 2))


def _is_cuda(config: Dict[str, Any]) -> bool:
    return str(config.get("device", "cpu")).lower() == "cuda"


def fallback_variant(config: Dict[str, Any]) -> str:
    stems = int(config.get("stems", 4) or 4)
    return FALLBACK_MODEL_6S if stems >= 5 else FALLBACK_MODEL_4S


def _using_fallback(config: Dict[str, Any]) -> bool:
    return config.get("model_variant") in (FALLBACK_MODEL_4S, FALLBACK_MODEL_6S) or (
        not config.get("model_variant") and config.get("engine", "demucs") == "demucs"
    )


def plan_recovery(info: ErrorInfo, state: RecoveryState) -> Optional[RecoveryAction]:
    """Pick the next recovery step for ``info`` given what was already tried; None = give up."""
    cfg = state.config
    tried = state.tried

    def fresh(name: str) -> bool:
        return name not in tried

    if info.category == CAT_INPUT_MISSING:
        return None

    if info.category == CAT_OOM:
        if _is_cuda(cfg):
            if fresh("shrink_chunks"):
                return RecoveryAction(
                    "shrink_chunks",
                    "GPU memory ran out - retrying with smaller processing chunks",
                    {"chunk_duration": _next_chunk(cfg), "demucs_segment": _next_segment(cfg),
                     "shifts": 1, "mdx_chunk_size": 262144},
                )
            if fresh("cpu_fallback"):
                return RecoveryAction(
                    "cpu_fallback",
                    "GPU still out of memory - switching this split to CPU (slower but reliable)",
                    {"device": "cpu", "shifts": 1, "chunk_duration": _next_chunk(cfg)},
                )
        else:
            if fresh("shrink_chunks"):
                return RecoveryAction(
                    "shrink_chunks",
                    "System memory ran low - retrying with smaller processing chunks",
                    {"chunk_duration": _next_chunk(cfg), "demucs_segment": _next_segment(cfg), "shifts": 1},
                )
        if not _using_fallback(cfg) and fresh("fallback_model"):
            return _fallback_action(cfg, "model needs more memory than available")
        return None

    if info.category == CAT_CUDA:
        if _is_cuda(cfg) and fresh("cpu_fallback"):
            return RecoveryAction(
                "cpu_fallback",
                "GPU runtime problem - switching this split to CPU",
                {"device": "cpu", "shifts": 1},
            )
        if not _using_fallback(cfg) and fresh("fallback_model"):
            return _fallback_action(cfg, "GPU problem persists")
        return None

    if info.category == CAT_MODEL:
        if fresh("repair_model"):
            return RecoveryAction(
                "repair_model",
                "Model files look missing or corrupt - re-downloading and retrying",
                {}, side_effect="repair_model",
            )
        if not _using_fallback(cfg) and fresh("fallback_model"):
            return _fallback_action(cfg, "model could not be repaired")
        return None

    if info.category == CAT_DEPENDENCY:
        if fresh("repair_dependency"):
            what = info.module or "a missing package"
            return RecoveryAction(
                "repair_dependency",
                f"Missing dependency ({what}) - repairing Python environment and retrying",
                {}, side_effect="repair_dependency",
            )
        if not _using_fallback(cfg) and fresh("fallback_model"):
            return _fallback_action(cfg, "dependency could not be repaired")
        return None

    if info.category == CAT_DECODE:
        if not state.transcoded:
            return RecoveryAction(
                "transcode_input",
                "Audio could not be decoded - re-encoding to clean WAV and retrying",
                {}, side_effect="transcode_input",
            )
        if not state.transcoded_hard:
            return RecoveryAction(
                "transcode_input_lenient",
                "Retrying with a lenient re-encode that skips corrupt frames",
                {}, side_effect="transcode_input",
            )
        return None

    # Unknown: first try a known-good model, then CPU, then smaller chunks.
    if not _using_fallback(cfg) and fresh("fallback_model"):
        return _fallback_action(cfg, "unexpected error")
    if _is_cuda(cfg) and fresh("cpu_fallback"):
        return RecoveryAction("cpu_fallback", "Unexpected error - trying CPU instead of GPU",
                              {"device": "cpu", "shifts": 1})
    if fresh("shrink_chunks"):
        return RecoveryAction(
            "shrink_chunks", "Unexpected error - retrying with smaller chunks",
            {"chunk_duration": _next_chunk(cfg), "demucs_segment": _next_segment(cfg), "shifts": 1},
        )
    return None


def _fallback_action(cfg: Dict[str, Any], reason: str) -> RecoveryAction:
    variant = fallback_variant(cfg)
    label = "Demucs htdemucs (6-stem)" if variant == FALLBACK_MODEL_6S else "Demucs htdemucs"
    return RecoveryAction(
        "fallback_model",
        f"Selected model failed ({reason}) - falling back to {label}",
        {"engine": "demucs", "model_variant": variant, "extra_models": [], "post_fx": ""},
    )


# ---------------------------------------------------------------------------
# Side effects
# ---------------------------------------------------------------------------

def find_ffmpeg() -> Optional[str]:
    env = os.environ.get("LIMINAL_FFMPEG")
    if env and os.path.exists(env):
        return env
    here = Path(__file__).resolve().parent
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    for candidate in (
        here / exe, here / "ffmpeg" / exe, here.parent / "ffmpeg" / exe,
        here.parent / "resources" / "ffmpeg" / exe, here.parent / "resources" / exe,
        here.parent.parent / "ffmpeg" / exe,
    ):
        if candidate.exists():
            return str(candidate)
    return shutil.which("ffmpeg")


def transcode_to_wav(input_file: str, lenient: bool = False, ffmpeg: Optional[str] = None,
                     runner: Callable[..., Any] = subprocess.run) -> str:
    """Re-encode to 44.1 kHz stereo PCM WAV using the bundled ffmpeg. Returns the new path."""
    ffmpeg = ffmpeg or find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found - cannot re-encode input")
    out_dir = tempfile.mkdtemp(prefix="liminal_recode_")
    out_path = os.path.join(out_dir, Path(input_file).stem + ".wav")  # same stem => same stem-file names
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    if lenient:
        cmd += ["-err_detect", "ignore_err", "-fflags", "+discardcorrupt+genpts"]
    cmd += ["-i", input_file, "-vn", "-map", "0:a:0?", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", out_path]
    kwargs: Dict[str, Any] = {"capture_output": True, "text": True, "timeout": 900}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    proc = runner(cmd, **kwargs)
    if getattr(proc, "returncode", 1) != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
        tail = (getattr(proc, "stderr", "") or "")[-300:]
        raise RuntimeError(f"ffmpeg re-encode failed: {tail}")
    return out_path


def free_gpu_memory() -> None:
    try:
        import gc
        gc.collect()
        import torch  # type: ignore
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


class DefaultDoctor:
    """Bridges recovery to model_doctor (lazy import so tests can stub it)."""

    def repair_model(self, variant_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
        import model_doctor
        return model_doctor.repair_variant(variant_id or fallback_variant(config), config=config)

    def repair_dependency(self, module: Optional[str]) -> Dict[str, Any]:
        import model_doctor
        return model_doctor.repair_import(module)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def run_with_recovery(
    *,
    run_attempt: Callable[[Dict[str, Any], str], Dict[str, Any]],
    config: Dict[str, Any],
    input_file: str,
    emit_progress: Optional[Callable[[int, int, str, int], None]] = None,
    emit_event: Optional[Callable[[Dict[str, Any]], None]] = None,
    output_dir: Optional[str] = None,
    doctor: Any = None,
    max_retries: Optional[int] = None,
    transcoder: Callable[..., str] = transcode_to_wav,
    log_paths: Optional[List[str]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Run ``run_attempt`` and recover from classified failures.

    Returns ``(manifest, final_config)``. The manifest gains a ``recovery`` block
    summarising every attempt, and ``diagnostic_log`` pointing at the log written.
    """
    if max_retries is None:
        try:
            max_retries = int(os.environ.get("LIMINAL_MAX_RECOVERY_RETRIES", MAX_RETRIES))
        except ValueError:
            max_retries = MAX_RETRIES
    max_retries = max(0, min(max_retries, 5))
    doctor = doctor or DefaultDoctor()

    state = RecoveryState(config=copy.deepcopy(config), input_file=input_file)
    attempts: List[Dict[str, Any]] = []
    current_input = input_file
    manifest: Dict[str, Any] = {}
    started = time.time()

    def log(line: str) -> None:
        attempts_log.append(f"[{_now()}] {line}")

    attempts_log: List[str] = []
    log(f"Split started: input={input_file} engine={config.get('engine')} "
        f"variant={config.get('model_variant') or '(default)'} device={config.get('device')}")

    for attempt in range(max_retries + 1):
        try:
            manifest = run_attempt(state.config, current_input)
        except Exception as exc:  # run_attempt should not raise, but never lose the error
            manifest = {
                "status": "failed", "errors": [f"{type(exc).__name__}: {exc}"],
                "stems": {}, "process_duration_seconds": 0,
                "input_file": input_file,
            }
        ok = manifest.get("status") == "success"
        info = None
        if not ok:
            text = manifest_error_text(manifest)
            info = classify_error(text)
        record: Dict[str, Any] = {
            "attempt": attempt + 1,
            "device": state.config.get("device"),
            "model_variant": state.config.get("model_variant") or "",
            "chunk_duration": state.config.get("chunk_duration"),
            "demucs_segment": state.config.get("demucs_segment"),
            "ok": ok,
        }
        if info:
            record.update({"category": info.category, "error": info.detail})
        attempts.append(record)
        log(f"Attempt {attempt + 1}: {'success' if ok else 'FAILED'}"
            + (f" [{info.category}] {info.detail}" if info else ""))
        if ok:
            break
        if attempt >= max_retries:
            log("Retry budget exhausted")
            break

        action = plan_recovery(info, state)
        if action is None:
            log(f"No further recovery available for category '{info.category}'")
            break

        record["recovery_action"] = action.name
        msg = f"Recovering (attempt {attempt + 2}/{max_retries + 1}): {action.message}"
        log(msg)
        if emit_progress:
            emit_progress(3, 5, msg, 40)
        if emit_event:
            emit_event({
                "event": "recovery", "attempt": attempt + 2, "max_attempts": max_retries + 1,
                "category": info.category, "action": action.name, "message": msg,
                "timestamp": datetime.now().isoformat(),
            })

        state.tried.append(action.name)
        if action.side_effect == "repair_model":
            try:
                result = doctor.repair_model(state.config.get("model_variant", ""), state.config)
                record["repair"] = {"ok": bool(result.get("ok")), "detail": str(result.get("detail", ""))[:300]}
                log(f"model repair -> {record['repair']}")
            except Exception as exc:
                record["repair"] = {"ok": False, "detail": f"{type(exc).__name__}: {exc}"[:300]}
                log(f"model repair crashed: {exc}")
        elif action.side_effect == "repair_dependency":
            try:
                result = doctor.repair_dependency(info.module)
                record["repair"] = {"ok": bool(result.get("ok")), "detail": str(result.get("detail", ""))[:300]}
                log(f"dependency repair -> {record['repair']}")
            except Exception as exc:
                record["repair"] = {"ok": False, "detail": f"{type(exc).__name__}: {exc}"[:300]}
                log(f"dependency repair crashed: {exc}")
        elif action.side_effect == "transcode_input":
            lenient = state.transcoded  # second pass is the lenient one
            try:
                current_input = transcoder(input_file, lenient=lenient)
                state.transcoded = True
                if lenient:
                    state.transcoded_hard = True
                log(f"re-encoded input -> {current_input}")
            except Exception as exc:
                state.transcoded = True
                state.transcoded_hard = True
                record["repair"] = {"ok": False, "detail": f"{type(exc).__name__}: {exc}"[:300]}
                log(f"re-encode failed: {exc}")
        if action.overrides:
            state.config.update(action.overrides)
        free_gpu_memory()

    recovered = bool(attempts) and attempts[-1]["ok"] and len(attempts) > 1
    final_ok = bool(attempts) and attempts[-1]["ok"]
    summary_msg = _outcome_message(final_ok, recovered, attempts)
    log(f"Outcome: {summary_msg} (total {time.time() - started:.1f}s)")

    log_target = _write_diagnostics(attempts_log, output_dir, log_paths)
    manifest["recovery"] = {
        "attempted": len(attempts) > 1,
        "recovered": recovered,
        "attempts": attempts,
        "final_message": summary_msg,
        "log_path": log_target,
    }
    if log_target:
        manifest["diagnostic_log"] = log_target
    if not final_ok and attempts and attempts[-1].get("category"):
        manifest.setdefault("errors", []).append(
            f"Auto-recovery tried {len(attempts) - 1} fix(es) but the split still failed: {summary_msg}"
        )
    if emit_event:
        emit_event({"event": "recovery_result", "recovered": recovered, "ok": final_ok,
                    "message": summary_msg, "log_path": log_target,
                    "timestamp": datetime.now().isoformat()})
    return manifest, state.config


def _outcome_message(ok: bool, recovered: bool, attempts: List[Dict[str, Any]]) -> str:
    if ok and recovered:
        steps = [a.get("recovery_action") for a in attempts if a.get("recovery_action")]
        return "Split succeeded after auto-recovery (" + ", ".join(steps) + ")"
    if ok:
        return "Split succeeded"
    last = attempts[-1] if attempts else {}
    cat = last.get("category", CAT_UNKNOWN)
    return f"{FRIENDLY.get(cat, FRIENDLY[CAT_UNKNOWN])}: {last.get('error', '')}".strip()


def _write_diagnostics(lines: List[str], output_dir: Optional[str], extra: Optional[List[str]]) -> Optional[str]:
    """Write the diagnostic log next to the output (overwrite) and in the app log dir (append).

    Returns the primary path (the one in the output folder when available).
    """
    targets: List[Tuple[str, str]] = []
    if output_dir:
        targets.append((os.path.join(output_dir, "split_diagnostics.log"), "w"))
    try:
        from liminal_paths import logs_dir
        targets.append((str(logs_dir() / "split_diagnostics.log"), "a"))
    except Exception:
        pass
    targets.extend((p, "w") for p in (extra or []))
    body = "\n".join(lines) + "\n"
    primary = None
    for target, mode in targets:
        try:
            Path(target).parent.mkdir(parents=True, exist_ok=True)
            with open(target, mode, encoding="utf-8") as fh:
                if mode == "a":
                    fh.write("-" * 60 + "\n")
                fh.write(body)
            primary = primary or target
        except OSError:
            continue
    return primary
