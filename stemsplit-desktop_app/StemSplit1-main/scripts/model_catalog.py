"""Remote-refreshable model catalog ("engine discovery").

Sources, merged in this order (later wins on the same filename):
  1. audio-separator's published lists (models.json + models-scores.json from the
     python-audio-separator repo and UVR's download_checks.json);
  2. the repo manifest ``models/catalog.json`` on ``main`` (curated sizes/VRAM/stems,
     plus extra models hosted elsewhere with direct URLs);
  3. optionally Hugging Face search (open licence, not gated; flagged ``unverified``).

Downloaded models are registered in ``user_models.json`` in the app data dir;
``model_registry`` merges them with the built-in MODEL_VARIANTS at runtime.

CLI (stdout carries JSON; human logs go to stderr):
    python model_catalog.py --refresh [--offline] [--hf]
    python model_catalog.py --list [--vram 8] [--installed] [--hf]
    python model_catalog.py --download ID      # streams {"event": "catalog_progress"} lines, ends with a result line
    python model_catalog.py --remove ID
    python model_catalog.py --build-manifest ../models/catalog.json   # maintainer tool (probes real sizes)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from liminal_paths import audio_separator_model_dir, catalog_cache_path, user_registry_path  # noqa: E402

AS_RAW = "https://raw.githubusercontent.com/nomadkaraoke/python-audio-separator/main/audio_separator"
UVR_CHECKS_URL = "https://raw.githubusercontent.com/TRvlvr/application_data/main/filelists/download_checks.json"
MANIFEST_URL = "https://raw.githubusercontent.com/myaiplug/liminal-stemsplit/main/models/catalog.json"
BUNDLED_SEED = SCRIPTS_DIR / "catalog_seed.json"

PUBLIC_PREFIX = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models"
AS_PREFIX = "https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs"
UVR_MDXC_CFG_PREFIX = f"{PUBLIC_PREFIX}/mdx_model_data/mdx_c_configs"

DEFAULT_VRAM_BUDGET_GB = 8.0
OPEN_LICENSES = {"mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "cc0-1.0", "cc-by-4.0", "cc-by-sa-4.0",
                 "cc-by-3.0", "cc-by-2.0", "openrail", "openrail++", "bigscience-openrail-m", "unlicense",
                 "gpl-3.0", "lgpl-3.0", "agpl-3.0", "mpl-2.0", "isc", "wtfpl", "artistic-2.0"}
HF_SEARCHES = ("roformer", "mdx23c", "music source separation", "stem separation")
MODEL_EXTS = (".ckpt", ".onnx", ".pth")


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def fetch_json(url: str, timeout: int = 25, opener: Callable[..., Any] = urllib.request.urlopen) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "LiminalStemSplit/0.7", "Accept": "application/json"})
    with opener(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------

def classify_family(group: str, filename: str) -> str:
    low = filename.lower()
    if group == "VR":
        return "VR"
    if group == "MDX":
        return "MDX"
    if "roformer" in low or "polarformer" in low or "segm_models" in low:
        return "Roformer"
    return "MDX23C"


def engine_for(family: str) -> str:
    return {"Roformer": "roformer", "VR": "vr"}.get(family, "mdx_net")


def estimate_size_mb(family: str, filename: str) -> int:
    if family == "VR":
        return 120
    if family == "MDX":
        return 60 if filename.endswith(".onnx") else 200
    if family == "MDX23C":
        return 400
    return 900 if "mel_band" in filename.lower() else 700


def estimate_vram_gb(family: str, filename: str) -> float:
    low = filename.lower()
    big = any(k in low for k in ("large", "_xl", "xlarge", "big"))
    if family == "VR":
        return 2.0
    if family == "MDX":
        return 3.0
    if family == "MDX23C":
        return 5.0
    if big:
        return 10.0
    return 6.0 if "bs_roformer" in low else 5.0


def vram_status(vram_gb: Optional[float], budget_gb: float = DEFAULT_VRAM_BUDGET_GB) -> str:
    """ok | tight | too_big | unknown, relative to the GPU budget."""
    if vram_gb is None:
        return "unknown"
    if vram_gb > budget_gb:
        return "too_big"
    if vram_gb > budget_gb - 1.5:
        return "tight"
    return "ok"


def best_sdr(scores: Dict[str, Any]) -> Optional[float]:
    vals: List[float] = []
    for stem in (scores or {}).values():
        if isinstance(stem, dict) and isinstance(stem.get("SDR"), (int, float)):
            vals.append(float(stem["SDR"]))
    return round(max(vals), 2) if vals else None


# ---------------------------------------------------------------------------
# Building entries
# ---------------------------------------------------------------------------

def _entry(name: str, filename: str, family: str, stems: List[str], scores: Dict[str, Any],
           files: List[Dict[str, str]], source: str = "audio-separator") -> Dict[str, Any]:
    return {
        "id": "catalog_" + slugify(os.path.splitext(filename)[0]),
        "name": re.sub(r"^(VR Arch Single Model v[45]|MDX-Net Model VIP|MDX-Net Model|MDX23C Model|Roformer Model):\s*", "", name).strip(),
        "filename": filename,
        "family": family,
        "engine": engine_for(family),
        "stems": stems,
        "sdr": best_sdr(scores),
        "size_mb": estimate_size_mb(family, filename),
        "size_estimated": True,
        "vram_gb": estimate_vram_gb(family, filename),
        "vram_estimated": True,
        "files": files,
        "source": source,
        "license": "open (UVR / community)",
        "vip": "VIP" in name,
    }


def build_audio_separator_entries(models_json: Dict[str, Any], scores_json: Dict[str, Any],
                                  download_checks: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Same grouping logic as audio-separator's ``list_supported_model_files`` (Demucs excluded - the app
    runs Demucs natively)."""
    dc = download_checks or {}

    def merged(key: str, *others: str) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for src, k in ((dc, key), *[(dc, o) for o in others]):
            out.update(src.get(k, {}) or {})
        return out

    def stems_for(filename: str) -> List[str]:
        info = scores_json.get(filename, {})
        stems = list(info.get("stems") or [])
        if not stems:
            stems = list((info.get("median_scores") or {}).keys())
        return stems

    entries: List[Dict[str, Any]] = []
    # VIP models are Patreon-only upstream; the catalog only offers freely downloadable ones.
    simple: List[tuple] = [
        ("VR", {**merged("vr_download_list"), **(models_json.get("vr_download_list") or {})}),
        ("MDX", {**merged("mdx_download_list", "mdx_download_vip_list"), **(models_json.get("mdx_download_list") or {})}),
    ]
    for group, table in simple:
        for name, filename in table.items():
            if "VIP" in name:
                continue
            fam = classify_family(group, filename)
            scores = (scores_json.get(filename) or {}).get("median_scores", {})
            entries.append(_entry(name, filename, fam, stems_for(filename), scores,
                                  [{"name": filename, "url": f"{PUBLIC_PREFIX}/{filename}"}]))
    mdxc = {**merged("mdx23c_download_list", "mdx23c_download_vip_list", "roformer_download_list"),
            **(models_json.get("mdx23c_download_list") or {}), **(models_json.get("roformer_download_list") or {})}
    for name, files in mdxc.items():
        if not isinstance(files, dict) or not files or "VIP" in name:
            continue
        filename, cfg = next(iter(files.items()))
        fam = classify_family("MDXC", filename)
        scores = (scores_json.get(filename) or {}).get("median_scores", {})
        prefix = f"{PUBLIC_PREFIX}"
        file_list = [{"name": filename, "url": f"{prefix}/{filename}", "fallback_url": f"{AS_PREFIX}/{filename}"}]
        if cfg:
            file_list.append({"name": cfg, "url": f"{UVR_MDXC_CFG_PREFIX}/{cfg}",
                              "fallback_url": f"{AS_PREFIX}/{cfg}"})
        entries.append(_entry(name, filename, fam, stems_for(filename), scores, file_list))
    return entries


def normalize_manifest_entry(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate a hand-written manifest entry; returns None for unusable ones (open models only)."""
    filename = raw.get("filename")
    if not filename or not str(filename).lower().endswith(MODEL_EXTS):
        return None
    if raw.get("gated") or raw.get("license", "open") in ("proprietary", "non-free"):
        return None
    family = raw.get("family") or classify_family("MDXC", filename)
    files = raw.get("files") or []
    out: Dict[str, Any] = {
        "id": raw.get("id") or "catalog_" + slugify(os.path.splitext(filename)[0]),
        "name": raw.get("name") or filename,
        "filename": filename,
        "family": family,
        "engine": raw.get("engine") or engine_for(family),
        "stems": raw.get("stems") or [],
        "sdr": raw.get("sdr"),
        "size_mb": raw.get("size_mb"),
        "size_estimated": raw.get("size_mb") is None,
        "vram_gb": raw.get("vram_gb"),
        "vram_estimated": raw.get("vram_gb") is None,
        "files": files,
        "source": raw.get("source", "audio-separator" if files and "TRvlvr" in json.dumps(files) else "manifest"),
        "license": raw.get("license", "open"),
        "description": raw.get("description", ""),
        "vip": bool(raw.get("vip")),
        "hidden": bool(raw.get("hidden")),
    }
    if out["size_mb"] is None:
        out["size_mb"] = estimate_size_mb(family, filename)
    if out["vram_gb"] is None:
        out["vram_gb"] = estimate_vram_gb(family, filename)
    return out


def merge_entries(base: List[Dict[str, Any]], overrides: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge by filename: override fields win, but keep base files/scores when the override omits them."""
    by_file: Dict[str, Dict[str, Any]] = {e["filename"]: dict(e) for e in base}
    order = [e["filename"] for e in base]
    for ov in overrides:
        fn = ov["filename"]
        if fn in by_file:
            cur = by_file[fn]
            for k, v in ov.items():
                if k in ("files", "stems", "sdr") and not v:
                    continue
                if k in ("size_mb", "size_estimated") and ov.get("size_estimated") and not cur.get("size_estimated", True):
                    continue
                if k in ("vram_gb", "vram_estimated") and ov.get("vram_estimated") and not cur.get("vram_estimated", True):
                    continue
                cur[k] = v
        else:
            by_file[fn] = dict(ov)
            order.append(fn)
    return [by_file[f] for f in order if not by_file[f].get("hidden")]


# ---------------------------------------------------------------------------
# Hugging Face discovery
# ---------------------------------------------------------------------------

def hf_candidates(results: List[Dict[str, Any]], limit: int = 40) -> List[Dict[str, Any]]:
    """Convert HF API results into catalog entries: open licence, not gated, ckpt+yaml (or onnx) present."""
    out: List[Dict[str, Any]] = []
    for item in results:
        if item.get("gated") or item.get("private"):
            continue
        licences = {t.split(":", 1)[1].lower() for t in item.get("tags", []) if t.startswith("license:")}
        if not licences or not (licences & OPEN_LICENSES):
            continue
        repo = item.get("id") or item.get("modelId")
        sibs = [s.get("rfilename", "") for s in item.get("siblings", [])]
        weights = [s for s in sibs if s.lower().endswith(MODEL_EXTS)]
        yamls = [s for s in sibs if s.lower().endswith((".yaml", ".yml"))]
        if not repo or not weights:
            continue
        weight = weights[0]
        family = classify_family("MDXC" if weight.lower().endswith(".ckpt") else "MDX", os.path.basename(weight) + " " + repo)
        if len(weights) > 1 or (weight.endswith(".ckpt") and len(yamls) != 1):
            # Ambiguous repo layout - can't wire up safely without a curated manifest entry.
            continue
        files = [{"name": os.path.basename(weight), "url": f"https://huggingface.co/{repo}/resolve/main/{weight}"}]
        if weight.endswith(".ckpt"):
            files.append({"name": os.path.basename(yamls[0]),
                          "url": f"https://huggingface.co/{repo}/resolve/main/{yamls[0]}"})
        base = os.path.basename(weight)
        out.append({
            "id": "hf_" + slugify(repo.replace("/", "_") + "_" + os.path.splitext(base)[0]),
            "name": repo.split("/")[-1].replace("-", " ").replace("_", " "),
            "filename": base, "family": family, "engine": engine_for(family),
            "stems": [], "sdr": None,
            "size_mb": estimate_size_mb(family, base), "size_estimated": True,
            "vram_gb": estimate_vram_gb(family, base), "vram_estimated": True,
            "files": files, "source": "huggingface", "unverified": True,
            "license": sorted(licences & OPEN_LICENSES)[0], "likes": item.get("likes", 0),
            "downloads": item.get("downloads", 0), "description": f"Community model from huggingface.co/{repo}",
        })
    out.sort(key=lambda e: (e.get("likes", 0), e.get("downloads", 0)), reverse=True)
    return out[:limit]


def search_huggingface(queries=HF_SEARCHES, per_query: int = 25,
                       opener: Callable[..., Any] = urllib.request.urlopen) -> List[Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    for q in queries:
        url = ("https://huggingface.co/api/models?full=true&limit=%d&sort=downloads&direction=-1&search=%s"
               % (per_query, urllib.request.quote(q)))
        try:
            for item in fetch_json(url, opener=opener):
                seen[item.get("id") or item.get("modelId")] = item
        except Exception as exc:
            _log(f"HF search '{q}' failed: {exc}")
    return hf_candidates(list(seen.values()))


# ---------------------------------------------------------------------------
# Refresh / cache / listing
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json_atomic(path: Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def refresh(offline: bool = False, include_hf: bool = False,
            fetch: Callable[[str], Any] = fetch_json) -> Dict[str, Any]:
    """Fetch every source, merge, cache. Each source degrades independently; offline uses the cache/seed."""
    sources: Dict[str, str] = {}
    base: List[Dict[str, Any]] = []
    overrides: List[Dict[str, Any]] = []
    hf: List[Dict[str, Any]] = []

    if not offline:
        try:
            models_json = fetch(f"{AS_RAW}/models.json")
            scores_json = fetch(f"{AS_RAW}/models-scores.json")
            try:
                checks = fetch(UVR_CHECKS_URL)
            except Exception as exc:
                checks = {}
                sources["uvr_download_checks"] = f"unavailable: {exc}"
            base = build_audio_separator_entries(models_json, scores_json, checks)
            sources["audio_separator"] = f"ok ({len(base)} models)"
        except Exception as exc:
            sources["audio_separator"] = f"unavailable: {exc}"
        try:
            manifest = fetch(MANIFEST_URL)
            overrides = [e for e in (normalize_manifest_entry(m) for m in manifest.get("models", [])) if e]
            sources["manifest"] = f"ok ({len(overrides)} entries, v{manifest.get('version', '?')})"
        except Exception as exc:
            sources["manifest"] = f"unavailable: {exc}"
        if include_hf:
            try:
                hf = search_huggingface()
                sources["huggingface"] = f"ok ({len(hf)} candidates)"
            except Exception as exc:
                sources["huggingface"] = f"unavailable: {exc}"

    if not base and not overrides:
        # Offline or everything failed: previous cache, else bundled seed.
        cached = _read_json(catalog_cache_path())
        seed = load_seed()
        fallback = cached or seed
        if fallback:
            sources["fallback"] = "cache" if cached else "bundled seed"
            fallback = dict(fallback)
            fallback["sources"] = {**fallback.get("sources", {}), **sources}
            fallback["offline"] = True
            return fallback
        return {"fetched_at": None, "sources": sources, "models": [], "offline": True}

    models = merge_entries(base, overrides)
    if hf:
        known = {m["filename"] for m in models}
        models.extend(h for h in hf if h["filename"] not in known)
    catalog = {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "sources": sources, "models": models, "offline": False}
    try:
        _write_json_atomic(catalog_cache_path(), catalog)
    except OSError as exc:
        _log(f"could not write catalog cache: {exc}")
    return catalog


def load_seed() -> Optional[Dict[str, Any]]:
    """Bundled copy of models/catalog.json, normalised into catalog form (works fully offline)."""
    raw = _read_json(BUNDLED_SEED)
    if not raw:
        return None
    models = [e for e in (normalize_manifest_entry(m) for m in raw.get("models", [])) if e]
    for m in models:
        m.setdefault("source", "audio-separator")
    return {"fetched_at": None, "sources": {"seed": f"bundled v{raw.get('version', '?')}"}, "models": models}


def load_catalog() -> Dict[str, Any]:
    return _read_json(catalog_cache_path()) or load_seed() or {"models": [], "fetched_at": None}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def load_registry() -> Dict[str, Any]:
    return _read_json(user_registry_path()) or {"version": 1, "models": {}}


def variant_for(entry: Dict[str, Any]) -> Dict[str, Any]:
    variant: Dict[str, Any] = {"backend": "audio_separator", "filename": entry["filename"],
                               "engine": entry.get("engine") or engine_for(entry.get("family", "MDX23C")),
                               "label": entry.get("name")}
    custom = [f for f in entry.get("files", []) if f.get("name") != entry["filename"] and not f["name"].endswith((".yaml", ".yml"))]
    if entry.get("source") != "audio-separator" or custom:
        variant["files"] = [{k: v for k, v in f.items() if k in ("name", "url", "fallback_url", "sha256")}
                            for f in entry.get("files", [])]
    return variant


def register_model(entry: Dict[str, Any]) -> Dict[str, Any]:
    reg = load_registry()
    reg.setdefault("models", {})[entry["id"]] = {
        "variant": variant_for(entry),
        "name": entry.get("name"), "family": entry.get("family"), "stems": entry.get("stems", []),
        "size_mb": entry.get("size_mb"), "vram_gb": entry.get("vram_gb"), "source": entry.get("source"),
        "license": entry.get("license"), "installed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    _write_json_atomic(user_registry_path(), reg)
    try:
        import model_registry
        model_registry.load_user_variants(force=True)
    except Exception:
        pass
    return reg


def unregister_model(model_id: str) -> bool:
    reg = load_registry()
    removed = reg.get("models", {}).pop(model_id, None)
    if removed is None:
        return False
    _write_json_atomic(user_registry_path(), reg)
    return True


def _builtin_filenames() -> Dict[str, str]:
    try:
        from model_registry import MODEL_VARIANTS
        return {m["filename"]: vid for vid, m in MODEL_VARIANTS.items() if m.get("filename")}
    except Exception:
        return {}


def annotate(entries: List[Dict[str, Any]], budget_gb: float = DEFAULT_VRAM_BUDGET_GB,
             model_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Add installed/new/vram flags for the UI."""
    model_dir = Path(model_dir or audio_separator_model_dir())
    builtin = _builtin_filenames()
    registered = (load_registry().get("models") or {})
    out: List[Dict[str, Any]] = []
    for e in entries:
        e = dict(e)
        fn = e["filename"]
        present = (model_dir / fn).is_file()
        e["builtin_variant"] = builtin.get(fn)
        e["registered"] = e["id"] in registered
        e["installed"] = present
        e["new"] = fn not in builtin and not present and not e["registered"]
        e["variant_id"] = builtin.get(fn) or e["id"]
        e["vram_status"] = vram_status(e.get("vram_gb"), budget_gb)
        e["fits_vram"] = e["vram_status"] in ("ok", "tight")
        out.append(e)
    return out


def list_models(budget_gb: float = DEFAULT_VRAM_BUDGET_GB, installed_only: bool = False,
                include_hf: bool = True, catalog: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    catalog = catalog or load_catalog()
    models = annotate(catalog.get("models", []), budget_gb)
    if not include_hf:
        models = [m for m in models if m.get("source") != "huggingface"]
    if installed_only:
        models = [m for m in models if m["installed"]]
    return {"fetched_at": catalog.get("fetched_at"), "sources": catalog.get("sources", {}),
            "offline": catalog.get("offline", False), "vram_budget_gb": budget_gb, "models": models}


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_model(model_id: str, emit: Callable[[Dict[str, Any]], None] = lambda e: None,
                   catalog: Optional[Dict[str, Any]] = None, model_dir: Optional[Path] = None,
                   downloader: Optional[Callable[..., Dict[str, Any]]] = None) -> Dict[str, Any]:
    import model_doctor
    downloader = downloader or model_doctor.try_download
    catalog = catalog or load_catalog()
    entry = next((m for m in catalog.get("models", []) if m["id"] == model_id), None)
    if not entry:
        return {"ok": False, "model_id": model_id, "detail": f"model '{model_id}' is not in the catalog - refresh it first"}
    model_dir = Path(model_dir or audio_separator_model_dir())
    model_dir.mkdir(parents=True, exist_ok=True)
    files = entry.get("files") or [{"name": entry["filename"]}]
    total_files = len(files)
    errors: List[str] = []
    for idx, f in enumerate(files):
        target = model_dir / f["name"]
        if target.is_file() and model_doctor.file_looks_valid(target):
            continue
        if not f.get("url"):
            res = model_doctor.try_audio_separator_download(entry["filename"], model_dir)
            if not res["ok"]:
                errors.append(res["detail"])
            continue

        def progress(done: int, total: int, _idx=idx, _name=f["name"]) -> None:
            emit({"event": "catalog_progress", "model_id": model_id, "file": _name, "file_index": _idx + 1,
                  "file_count": total_files, "bytes": done, "total": total,
                  "progress": int(100 * done / total) if total else None})

        res = downloader(f["url"], target, expected_sha256=f.get("sha256"), progress=progress)
        if not res["ok"] and f.get("fallback_url"):
            res = downloader(f["fallback_url"], target, expected_sha256=f.get("sha256"), progress=progress)
        if not res["ok"]:
            # Last resort: let audio-separator resolve it.
            alt = model_doctor.try_audio_separator_download(entry["filename"], model_dir) \
                if entry.get("source") == "audio-separator" else res
            if alt["ok"]:
                continue
            errors.append(res["detail"])
    missing = [f["name"] for f in files if not (model_dir / f["name"]).is_file()]
    ok = not errors and not missing
    if ok:
        register_model(entry)
    return {"ok": ok, "model_id": model_id, "variant_id": entry["id"],
            "detail": f"{entry['name']} installed" if ok else "; ".join(errors or [f"missing {', '.join(missing)}"])}


def remove_model(model_id: str, model_dir: Optional[Path] = None) -> Dict[str, Any]:
    model_dir = Path(model_dir or audio_separator_model_dir())
    reg = load_registry()
    entry = (reg.get("models") or {}).get(model_id)
    if not entry:
        return {"ok": False, "model_id": model_id, "detail": "not a downloaded catalog model"}
    variant = entry.get("variant", {})
    names = [f["name"] for f in variant.get("files", [])] or [variant.get("filename")]
    removed = []
    for n in filter(None, names):
        try:
            (model_dir / n).unlink()
            removed.append(n)
        except OSError:
            pass
    unregister_model(model_id)
    return {"ok": True, "model_id": model_id, "detail": f"removed {len(removed)} file(s)"}


# ---------------------------------------------------------------------------
# Maintainer: build models/catalog.json with real sizes
# ---------------------------------------------------------------------------

def head_size(url: str, timeout: int = 20) -> Optional[int]:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "LiminalStemSplit/0.7"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            n = resp.headers.get("Content-Length")
            return int(n) if n else None
    except Exception:
        return None


def build_manifest(out_path: Path, workers: int = 8) -> Dict[str, Any]:
    cat = refresh(include_hf=False)
    models = [m for m in cat["models"] if m.get("source") == "audio-separator"]

    def probe(m: Dict[str, Any]) -> Dict[str, Any]:
        f = m["files"][0]
        size = head_size(f["url"]) or (head_size(f["fallback_url"]) if f.get("fallback_url") else None)
        if size:
            mb = round(size / (1024 * 1024))
            return {"filename": m["filename"], "size_mb": mb}
        return {"filename": m["filename"]}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        sizes = {r["filename"]: r.get("size_mb") for r in pool.map(probe, models)}
    entries = []
    for m in models:
        mb = sizes.get(m["filename"])
        # VRAM rule of thumb: working memory scales with checkpoint size for roformer/mdx23c.
        vram = m["vram_gb"]
        if mb and m["family"] in ("Roformer", "MDX23C"):
            vram = round(max(vram, 2.5 + mb / 250.0), 1) if mb > 1100 else vram
        entry = {"id": m["id"], "filename": m["filename"], "name": m["name"], "family": m["family"],
                 "engine": m["engine"], "stems": m["stems"], "sdr": m["sdr"], "size_mb": mb or m["size_mb"],
                 "vram_gb": vram, "files": m["files"], "license": m["license"]}
        if not mb:
            entry["size_mb"] = None  # unknown - keep flagged as an estimate
        entries.append(entry)
    manifest = {"version": time.strftime("%Y.%m.%d"), "generated_by": "scripts/model_catalog.py --build-manifest",
                "notes": "Curated size/VRAM data for audio-separator models. Add extra open models under 'models' with "
                         "'files' (name+url[+sha256]). VRAM figures are estimates for default chunk settings.",
                "models": entries}
    _write_json_atomic(out_path, manifest)
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--hf", action="store_true", help="include Hugging Face community models")
    p.add_argument("--list", action="store_true")
    p.add_argument("--installed", action="store_true")
    p.add_argument("--vram", type=float, default=DEFAULT_VRAM_BUDGET_GB)
    p.add_argument("--download", default=None)
    p.add_argument("--remove", default=None)
    p.add_argument("--build-manifest", default=None)
    a = p.parse_args(argv)

    if a.build_manifest:
        m = build_manifest(Path(a.build_manifest))
        print(json.dumps({"ok": True, "models": len(m["models"])}))
        return 0
    if a.download:
        def emit(ev: Dict[str, Any]) -> None:
            print(json.dumps(ev), flush=True)
        res = download_model(a.download, emit=emit)
        print(json.dumps({"event": "catalog_result", **res}), flush=True)
        return 0 if res["ok"] else 1
    if a.remove:
        res = remove_model(a.remove)
        print(json.dumps(res))
        return 0 if res["ok"] else 1
    if a.refresh:
        cat = refresh(offline=a.offline, include_hf=a.hf)
        print(json.dumps(list_models(a.vram, a.installed, include_hf=a.hf, catalog=cat)))
        return 0
    if a.list:
        print(json.dumps(list_models(a.vram, a.installed, include_hf=a.hf)))
        return 0
    p.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
