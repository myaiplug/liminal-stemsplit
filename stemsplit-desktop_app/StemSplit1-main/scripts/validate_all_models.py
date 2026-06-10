"""
Validate every model in model_registry.py against:
  - UI catalog IDs (model-catalog.ts + model-catalog-extended.ts)
  - Local weight files on D:\\AudioSeperationModels
  - audio-separator supported model catalog (auto-downloadable)
  - Engine routing / preset / infrastructure prerequisites

Run: python validate_all_models.py [--json] [--inference-sample]
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from model_registry import (  # noqa: E402
    ENSEMBLE_PRESETS,
    INSTRUMENT_HF_BUNDLES,
    MSST_MODEL_BUNDLES,
    MODEL_VARIANTS,
    resolve_audio_separator_filename,
    resolve_model_variant,
)

# Reuse splitter path helpers without importing apply_fx side effects if possible.
import splitter  # noqa: E402


def parse_catalog_ids() -> Set[str]:
    ids: Set[str] = set()
    lib = _SCRIPT_DIR.parent / "src" / "lib"
    pattern = re.compile(r"\bid:\s*'([^']+)'")
    for name in ("model-catalog.ts", "model-catalog-extended.ts"):
        path = lib / name
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            match = pattern.search(line)
            if match:
                ids.add(match.group(1))
    return ids


def load_audio_separator_filenames() -> Set[str]:
    try:
        from audio_separator.separator import Separator

        sep = Separator(log_level=40)
        supported = set(sep.list_supported_model_files())
        simplified = sep.get_simplified_model_list()
        supported.update(simplified.keys())
        return supported
    except Exception as exc:
        print(f"WARNING: could not load audio-separator catalog: {exc}", file=sys.stderr)
        return set()


def check_local_file(filename: str, engine: str) -> Tuple[bool, Optional[str]]:
    resolved = splitter.resolve_model_file(filename)
    if resolved:
        return True, resolved

    cache_dir = Path(splitter.get_audio_separator_model_dir())
    cached = cache_dir / filename
    if cached.is_file():
        return True, str(cached)

    for alias in (filename,):
        pass

    models_root = splitter.resolve_models_root()
    for sub in ("Roformer_Models", "MDX_Net_Models", "VR_Models"):
        candidate = models_root / sub / filename
        if candidate.is_file():
            return True, str(candidate)

    return False, None


def infer_engine(meta: Dict[str, Any], variant_id: str) -> str:
    backend = meta.get("backend", "")
    if backend == "demucs":
        return "demucs"
    if backend == "mvsep":
        return "mdx"
    if backend == "audio_separator":
        return meta.get("engine", "mdx_net")
    if backend == "ensemble":
        return "ensemble"
    if backend == "karaoke":
        return "karaoke"
    if backend == "drumsep":
        return "drumsep" if variant_id == "drumsep_49469" else "drumsep_mdx"
    if backend == "postfx":
        return "postfx"
    if backend == "spleeter":
        return "spleeter"
    return backend or "unknown"


def default_stems(variant_id: str, meta: Dict[str, Any], engine: str) -> int:
    if engine == "drumsep_mdx":
        stems = meta.get("stems") or []
        return len(stems) if stems else 6
    if engine == "drumsep":
        return 5
    if engine in ("instrument",):
        if meta.get("mode") == "multistem":
            return len(meta.get("stems") or [1])
        return 2
    if engine == "postfx":
        return 2
    return 2


def validate_variant(
    variant_id: str,
    meta: Dict[str, Any],
    as_catalog: Set[str],
) -> Dict[str, Any]:
    engine = infer_engine(meta, variant_id)
    backend = meta.get("backend", "")
    issues: List[str] = []
    status = "ready"
    local_path: Optional[str] = None
    filename = meta.get("filename")
    catalog_name = resolve_audio_separator_filename(filename) if filename else None

    if backend == "audio_separator":
        if not filename:
            issues.append("missing filename in registry")
            status = "broken"
        else:
            in_as = catalog_name in as_catalog if as_catalog else False
            local_ok, local_path = check_local_file(filename, engine)
            if not local_ok:
                for alias in meta.get("aliases") or []:
                    local_ok, local_path = check_local_file(alias, engine)
                    if local_ok:
                        break
            if not local_ok and not in_as:
                issues.append(
                    f"not local and not in audio-separator catalog: {catalog_name}"
                )
                status = "needs_download_or_fix"
            elif not local_ok and in_as:
                status = "auto_download"
            else:
                status = "ready_local"

    elif backend == "mvsep":
        try:
            splitter.resolve_mdx_folder()
            status = "ready"
        except Exception as exc:
            issues.append(str(exc))
            status = "broken"

    elif backend == "demucs":
        if not meta.get("model"):
            issues.append("missing demucs model name")
            status = "broken"
        else:
            status = "ready"

    elif backend == "ensemble":
        preset = meta.get("preset", "")
        if preset not in ENSEMBLE_PRESETS:
            issues.append(f"unknown ensemble preset: {preset}")
            status = "broken"
        else:
            status = "auto_download"

    elif backend == "drumsep":
        repo = splitter.resolve_drumsep_repo()
        if not repo.is_dir():
            issues.append(f"drumsep repo missing: {repo}")
            status = "broken"
        elif any(repo.glob("*.pth")) or any(repo.glob("*.ckpt")) or any(repo.glob("*.th")):
            status = "ready_local"
        else:
            issues.append(f"no weights in {repo}")
            status = "needs_weights"

    elif backend == "postfx":
        status = "ready" if meta.get("fx") else "broken"
        if not meta.get("fx"):
            issues.append("missing postfx fx id")

    elif backend == "spleeter":
        status = "ready"

    else:
        issues.append(f"unknown backend: {backend}")
        status = "broken"

    hf_bundle = meta.get("hf_bundle")
    if hf_bundle:
        if hf_bundle not in INSTRUMENT_HF_BUNDLES:
            issues.append(f"hf_bundle not in INSTRUMENT_HF_BUNDLES: {hf_bundle}")
            status = "broken"
        elif status == "needs_download_or_fix":
            issues = [i for i in issues if "not in audio-separator" not in i]
            if not issues:
                status = "hf_auto_download"

    msst_bundle = meta.get("msst_bundle") or (
        filename if filename in MSST_MODEL_BUNDLES else None
    )
    if msst_bundle:
        if msst_bundle not in MSST_MODEL_BUNDLES:
            issues.append(f"msst_bundle not in MSST_MODEL_BUNDLES: {msst_bundle}")
            status = "broken"
        elif status == "needs_download_or_fix":
            issues = [i for i in issues if "not in audio-separator" not in i]
            if not issues:
                status = "msst_auto_download"

    return {
        "id": variant_id,
        "backend": backend,
        "engine": engine,
        "filename": filename,
        "catalog_filename": catalog_name,
        "status": status,
        "local_path": local_path,
        "issues": issues,
        "default_stems": default_stems(variant_id, meta, engine),
    }


RUNNABLE_STATUSES = {
    "ready",
    "ready_local",
    "auto_download",
    "hf_auto_download",
    "msst_auto_download",
}


def main() -> int:
    emit_json = "--json" in sys.argv
    require_all_runnable = "--require-all-runnable" in sys.argv
    catalog_ids = parse_catalog_ids()
    registry_ids = set(MODEL_VARIANTS.keys())
    as_catalog = load_audio_separator_filenames()

    missing_registry = sorted(catalog_ids - registry_ids)
    extra_registry = sorted(registry_ids - catalog_ids)

    results: List[Dict[str, Any]] = []
    for variant_id in sorted(MODEL_VARIANTS.keys()):
        meta = resolve_model_variant(variant_id)
        results.append(validate_variant(variant_id, meta, as_catalog))

    by_status: Dict[str, int] = {}
    for row in results:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1

    broken = [r for r in results if r["status"] == "broken"]
    needs_fix = [r for r in results if r["status"] == "needs_download_or_fix"]

    report = {
        "catalog_count": len(catalog_ids),
        "registry_count": len(registry_ids),
        "audio_separator_catalog_count": len(as_catalog),
        "missing_in_registry": missing_registry,
        "in_registry_not_in_catalog": extra_registry,
        "by_status": by_status,
        "broken": broken,
        "needs_download_or_fix": needs_fix,
        "models": results,
    }

    if emit_json:
        print(json.dumps(report, indent=2))
    else:
        print("=" * 72)
        print(f"Catalog UI models:        {len(catalog_ids)}")
        print(f"Registry (Python) models: {len(registry_ids)}")
        print(f"audio-separator models:   {len(as_catalog)}")
        print("-" * 72)
        print("Status breakdown:")
        for status, count in sorted(by_status.items(), key=lambda x: -x[1]):
            print(f"  {status:24} {count}")
        print("-" * 72)
        if missing_registry:
            print(f"IN CATALOG BUT MISSING FROM REGISTRY ({len(missing_registry)}):")
            for mid in missing_registry:
                print(f"  - {mid}")
        if extra_registry:
            print(f"IN REGISTRY BUT NOT IN UI CATALOG ({len(extra_registry)}):")
            for mid in extra_registry:
                print(f"  - {mid}")
        if broken:
            print(f"\nBROKEN ({len(broken)}):")
            for row in broken:
                print(f"  {row['id']}: {'; '.join(row['issues'])}")
        if needs_fix:
            print(f"\nNEEDS DOWNLOAD OR FILENAME FIX ({len(needs_fix)}):")
            for row in needs_fix:
                print(f"  {row['id']}: {row['filename']} -> {row['catalog_filename']}")
        ready = (
            by_status.get("ready", 0)
            + by_status.get("ready_local", 0)
            + by_status.get("auto_download", 0)
            + by_status.get("hf_auto_download", 0)
            + by_status.get("msst_auto_download", 0)
        )
        print("-" * 72)
        print(f"Runnable (ready + local + auto-download + MSST/HF): {ready} / {len(results)}")
        if require_all_runnable and ready != len(results):
            print(
                f"FAIL: --require-all-runnable set but only {ready}/{len(results)} models are runnable.",
                file=sys.stderr,
            )

    not_runnable = [r for r in results if r["status"] not in RUNNABLE_STATUSES]
    if require_all_runnable and not_runnable:
        if not emit_json:
            print(f"\nNOT RUNNABLE ({len(not_runnable)}):")
            for row in not_runnable:
                print(f"  {row['id']}: {row['status']} -> {'; '.join(row['issues']) or 'no details'}")
        return 1

    return 1 if broken or missing_registry else 0


if __name__ == "__main__":
    raise SystemExit(main())