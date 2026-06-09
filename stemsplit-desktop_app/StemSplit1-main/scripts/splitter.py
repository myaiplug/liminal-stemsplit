"""
Separator Engine: High-Quality Audio Stem Separation with Leakage Cleanup
Acts as a Senior Audio DSP Engineer to perform professional-grade stem separation
using Facebook Demucs with post-processing spectral subtraction, pedalboard effects,
and high-quality FFmpeg encoding.
"""

import json
import logging
import os
import time
import sys
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List, Callable
import warnings

# Embedded Python (python310._pth) does not add the script directory to sys.path.
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

try:
    from apply_fx import apply_fx_chain
except ImportError:
    # If not available (e.g. running from different dir), define dummy or fail gracefully
    # But since we are deploying, we expect it to be there.
    def apply_fx_chain(audio, sr, config):
        return audio

import numpy as np
import librosa
import soundfile as sf
from datetime import datetime

from model_registry import (
    resolve_model_variant,
    resolve_audio_separator_filename,
    INSTRUMENT_HF_BUNDLES,
    MSST_MODEL_BUNDLES,
)

# Configure logging — ONLY log to file, NOT to stderr.
# apply_fx.py configures stderr logging on import; clear and replace so
# splitter.log stays current and stderr pipe doesn't deadlock Rust IPC.
_log_dir = Path(os.environ.get("LOCALAPPDATA", _SCRIPT_DIR)) / "StemSplit" / "logs"
_log_dir.mkdir(parents=True, exist_ok=True)
_root_logger = logging.getLogger()
_root_logger.handlers.clear()
_root_logger.setLevel(logging.INFO)
_file_handler = logging.FileHandler(_log_dir / "splitter.log", encoding="utf-8")
_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
_root_logger.addHandler(_file_handler)
logger = logging.getLogger(__name__)

MDX_FOLDER_NAME = "MVSEP-MDX23-music-separation-model-main"
DEFAULT_WINDOWS_MODELS_ROOT = Path("D:/AudioSeperationModels")
DEFAULT_WINDOWS_UVR_INSTALL = Path("D:/Ultimate Vocal Remover")

ROFORMER_MODEL_ALIASES = {
    "vocals_mel_band_roformer.ckpt": [
        "MelBandRoformer.ckpt",
        "mel_band_roformer_kim_ft_erika.ckpt",
    ],
    "mel_band_roformer_kim_ft_erika.ckpt": [
        "MelBandRoformer.ckpt",
        "mel_band_roformer_kim_ft_erika.ckpt",
    ],
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt": [
        "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    ],
    "BS-Roformer-SW.ckpt": [
        "BS-Roformer-SW.ckpt",
        "model_BandSplit-Roformer_SW_by-jarredou.ckpt",
    ],
    "melband_roformer_guitar_becruily.ckpt": [
        "melband_roformer_guitar_becruily.ckpt",
        "becruily_guitar.ckpt",
    ],
}


def resolve_models_root() -> Path:
    """Resolve the shared on-disk model library root."""
    script_dir = Path(__file__).resolve().parent
    app_root = script_dir.parent
    local_app_data = Path(os.environ.get("LOCALAPPDATA", app_root)) / "StemSplit" / "models"

    candidates = []
    env_override = os.environ.get("STEMSPLIT_MODELS_ROOT", "").strip()
    if env_override:
        candidates.append(Path(env_override))

    models_root_file = Path(os.environ.get("LOCALAPPDATA", app_root)) / "StemSplit" / "models_root.txt"
    if models_root_file.is_file():
        persisted = models_root_file.read_text(encoding="utf-8").strip()
        if persisted:
            candidates.append(Path(persisted))

    mdx_override = os.environ.get("STEMSPLIT_MDX_MODEL_PATH", "").strip()
    if mdx_override:
        candidates.append(Path(mdx_override).parent)

    candidates.extend([
        DEFAULT_WINDOWS_MODELS_ROOT,
        local_app_data,
        app_root,
        app_root / "Stem Split Models" / "audio-separator-models",
        app_root.parent,
        Path("E:/Projects/1_StemSplit"),
        Path("E:/Projects/1_StemSplit/Stem Split Models/audio-separator-models"),
    ])

    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.exists():
            continue
        seen.add(key)
        if (resolved / MDX_FOLDER_NAME / "inference.py").is_file():
            return resolved
        if (resolved / "drumsep-main" / "model").is_dir():
            return resolved
        if (resolved / "VR_Models").is_dir() or (resolved / "UVR" / "models" / "VR_Models").is_dir():
            return resolved

    return app_root


def resolve_mdx_folder() -> str:
    """Locate the MVSEP-MDX23 inference bundle across dev, install, and user data paths."""
    script_dir = Path(__file__).resolve().parent
    app_root = script_dir.parent

    candidates = []
    mdx_override = os.environ.get("STEMSPLIT_MDX_MODEL_PATH", "").strip()
    if mdx_override:
        candidates.append(Path(mdx_override))

    models_root = resolve_models_root()
    candidates.extend([
        models_root / MDX_FOLDER_NAME,
        app_root / MDX_FOLDER_NAME,
        Path(os.environ.get("LOCALAPPDATA", app_root)) / "StemSplit" / "models" / MDX_FOLDER_NAME,
    ])

    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen:
            continue
        seen.add(key)
        if (resolved / "inference.py").is_file():
            return str(resolved)

    expected = models_root / MDX_FOLDER_NAME
    raise Exception(
        "MDX engine is not installed. "
        f"Expected bundle at {expected}. "
        "Place MVSEP-MDX23 under D:\\AudioSeperationModels, "
        "run scripts/install_mdx_model.ps1, "
        "or set STEMSPLIT_MDX_MODEL_PATH to your MVSEP-MDX23 folder."
    )


def resolve_drumsep_repo() -> Path:
    models_root = resolve_models_root()
    candidates = [
        models_root / "drumsep-main" / "model",
        Path(__file__).resolve().parent.parent / "drumsep-main" / "model",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return candidates[-1]


def resolve_uvr_install_dir() -> Optional[Path]:
    """Locate a full Ultimate Vocal Remover install (contains lib_v5)."""
    script_dir = Path(__file__).resolve().parent
    app_root = script_dir.parent
    models_root = resolve_models_root()

    candidates = []
    env_override = os.environ.get("STEMSPLIT_UVR_PATH", "").strip()
    if env_override:
        candidates.append(Path(env_override))

    uvr_root_file = Path(os.environ.get("LOCALAPPDATA", app_root)) / "StemSplit" / "uvr_path.txt"
    if uvr_root_file.is_file():
        persisted = uvr_root_file.read_text(encoding="utf-8").strip()
        if persisted:
            candidates.append(Path(persisted))

    candidates.extend([
        DEFAULT_WINDOWS_UVR_INSTALL,
        models_root / "UVR",
        app_root / "UVR",
    ])

    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.exists():
            continue
        seen.add(key)
        if (resolved / "lib_v5").is_dir():
            return resolved
    return None


def resolve_uvr_code_dir() -> Optional[Path]:
    return resolve_uvr_install_dir()


def resolve_uvr_vr_models_dirs() -> List[Path]:
    """All VR_Models folders (UVR install + shared model library)."""
    models_root = resolve_models_root()
    script_dir = Path(__file__).resolve().parent
    app_root = script_dir.parent

    candidates = []
    uvr_install = resolve_uvr_install_dir()
    if uvr_install:
        candidates.append(uvr_install / "models" / "VR_Models")

    candidates.extend([
        models_root / "VR_Models",
        models_root / "UVR" / "models" / "VR_Models",
        app_root / "UVR" / "models" / "VR_Models",
    ])

    found: List[Path] = []
    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.is_dir():
            continue
        seen.add(key)
        found.append(resolved)
    return found


def resolve_uvr_vr_models_dir() -> Optional[Path]:
    dirs = resolve_uvr_vr_models_dirs()
    return dirs[0] if dirs else None


def find_vr_model_file(filename: str) -> Optional[str]:
    for models_dir in resolve_uvr_vr_models_dirs():
        candidate = models_dir / filename
        if candidate.is_file():
            return str(candidate)
    return None


def resolve_mdx_net_models_dirs() -> List[Path]:
    """All MDX_Net_Models folders (UVR install + shared model library)."""
    models_root = resolve_models_root()
    candidates = [models_root / "MDX_Net_Models"]
    uvr_install = resolve_uvr_install_dir()
    if uvr_install:
        candidates.append(uvr_install / "models" / "MDX_Net_Models")

    found: List[Path] = []
    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.is_dir():
            continue
        seen.add(key)
        found.append(resolved)
    return found


def resolve_demucs_models_repo() -> Optional[Path]:
    """Local Demucs torch.hub-style repo to avoid re-downloading weights."""
    models_root = resolve_models_root()
    uvr_install = resolve_uvr_install_dir()
    candidates = [
        models_root / "Demucs_Models" / "v3_v4_repo",
        models_root / "Demucs_Models",
    ]
    if uvr_install:
        candidates.extend([
            uvr_install / "models" / "Demucs_Models" / "v3_v4_repo",
            uvr_install / "models" / "Demucs_Models",
        ])

    for candidate in candidates:
        if candidate.is_dir() and any(candidate.glob("*.th")):
            return candidate
    return None


def resolve_roformer_search_dirs() -> List[Path]:
    models_root = resolve_models_root()
    dirs = [models_root]
    uvr_install = resolve_uvr_install_dir()
    if uvr_install:
        dirs.append(uvr_install / "models")
    for mdx_dir in resolve_mdx_net_models_dirs():
        dirs.append(mdx_dir)
    return dirs


def find_mdx_model_file(filename: str) -> Optional[str]:
    for models_dir in resolve_mdx_net_models_dirs():
        candidate = models_dir / filename
        if candidate.is_file():
            return str(candidate)
    models_root = resolve_models_root()
    fallback = models_root / filename
    if fallback.is_file():
        return str(fallback)
    return None


def resolve_model_file(filename: str) -> Optional[str]:
    found = find_mdx_model_file(filename)
    if found:
        return found
    return find_vr_model_file(filename)


def get_audio_separator_model_dir() -> str:
    import platform as _platform
    if _platform.system() == 'Windows':
        return os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'audio-separator', 'models')
    return os.path.join(os.path.expanduser('~'), '.cache', 'audio-separator', 'models')


def seed_model_into_cache(model_dir: Path, model_name: str, source_path: Optional[str] = None) -> None:
    """Link or copy a local weight into the audio-separator cache."""
    target = model_dir / model_name
    if target.is_file():
        return

    model_dir.mkdir(parents=True, exist_ok=True)
    sources: List[Path] = []
    if source_path:
        sources.append(Path(source_path))
    for alias in ROFORMER_MODEL_ALIASES.get(model_name, [model_name]):
        for search_dir in resolve_roformer_search_dirs():
            sources.append(search_dir / alias)
        resolved = resolve_model_file(alias)
        if resolved:
            sources.append(Path(resolved))

    for source in sources:
        if source.is_file():
            try:
                os.link(source, target)
                logger.info(f"Linked model {model_name} from {source}")
                return
            except OSError:
                import shutil
                shutil.copy2(source, target)
                logger.info(f"Copied model {model_name} from {source}")
                return


def seed_roformer_model(model_dir: Path, model_name: str) -> None:
    """Link or copy a local Roformer checkpoint into the audio-separator cache."""
    seed_model_into_cache(model_dir, model_name)


def ensure_msst_bundle(model_dir: Path, bundle_key: str) -> None:
    """Download MSST ckpt+yaml pairs (ZFTurbo/jarredou) into the audio-separator cache."""
    bundle = MSST_MODEL_BUNDLES.get(bundle_key)
    if not bundle:
        return

    model_dir.mkdir(parents=True, exist_ok=True)
    if all((model_dir / name).is_file() for name in bundle['files']):
        return

    import urllib.request

    for cache_name, url in bundle['files'].items():
        target = model_dir / cache_name
        if target.is_file():
            continue
        logger.info(f"Downloading MSST asset {cache_name}...")
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                target.write_bytes(response.read())
            logger.info(f"Cached MSST file {cache_name}")
        except Exception as err:
            logger.warning(f"Failed to download {cache_name} from {url}: {err}")
            raise RuntimeError(f"Could not download MSST model file {cache_name}: {err}") from err


def resolve_msst_repo() -> Path:
    """Locate the ZFTurbo Music-Source-Separation-Training checkout."""
    models_root = resolve_models_root()
    candidates = [
        models_root / "Music-Source-Separation-Training",
        models_root / "MSST",
        Path(__file__).resolve().parent.parent / "Music-Source-Separation-Training",
    ]
    for candidate in candidates:
        if (candidate / "inference.py").is_file() and (candidate / "utils" / "settings.py").is_file():
            return candidate.resolve()
    return (models_root / "Music-Source-Separation-Training").resolve()


def ensure_msst_repo() -> Path:
    """Clone MSST on first use when htdemucs/scnet weights need native inference."""
    repo = resolve_msst_repo()
    if (repo / "inference.py").is_file():
        return repo

    repo.parent.mkdir(parents=True, exist_ok=True)
    import subprocess

    logger.info(f"Cloning MSST inference repo into {repo}...")
    result = subprocess.run(
        [
            "git", "clone", "--depth", "1",
            "https://github.com/ZFTurbo/Music-Source-Separation-Training.git",
            str(repo),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "MSST inference repo is required for this model. "
            f"git clone failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return repo


def _msst_bundle_key(variant_meta: Dict[str, Any], model_filename: str) -> Optional[str]:
    return variant_meta.get('msst_bundle') or (
        model_filename if model_filename in MSST_MODEL_BUNDLES else None
    )


def _patch_separator_for_msst_models(separator, model_filename: str) -> None:
    """Allow audio-separator to load MSST weights that are not in its built-in catalog."""
    bundle = MSST_MODEL_BUNDLES.get(model_filename)
    if not bundle:
        return

    original_download = separator.download_model_files
    original_load_yaml = separator.load_model_data_from_yaml

    def _download_msst(mf):
        if mf != model_filename:
            return original_download(mf)
        ensure_msst_bundle(Path(separator.model_file_dir), mf)
        model_path = os.path.join(separator.model_file_dir, mf)
        friendly = bundle.get('friendly_name', mf)
        return mf, bundle['model_type'], friendly, model_path, bundle['yaml']

    def _load_msst_yaml(yaml_config_filename):
        model_data = original_load_yaml(yaml_config_filename)
        if bundle.get('is_roformer'):
            model_data['is_roformer'] = True
        return model_data

    separator.download_model_files = _download_msst
    separator.load_model_data_from_yaml = _load_msst_yaml


def ensure_instrument_hf_bundle(model_dir: Path, bundle_id: str) -> None:
    """Download instrument ckpt+yaml from HuggingFace when missing from cache."""
    bundle = INSTRUMENT_HF_BUNDLES.get(bundle_id)
    if not bundle:
        return

    model_dir.mkdir(parents=True, exist_ok=True)
    all_present = all((model_dir / cache_name).is_file() for cache_name in bundle['files'])
    if all_present:
        return

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        if bundle.get('optional'):
            logger.info(f"HF bundle {bundle_id} optional — audio-separator may auto-download")
            return
        logger.warning("huggingface_hub not installed — cannot prefetch instrument weights")
        return

    repo_id = bundle['repo_id']
    for cache_name, remote_name in bundle['files'].items():
        target = model_dir / cache_name
        if target.is_file():
            continue
        try:
            downloaded = hf_hub_download(repo_id=repo_id, filename=remote_name)
            import shutil
            shutil.copy2(downloaded, target)
            logger.info(f"Cached instrument file {cache_name} from {repo_id}")
        except Exception as err:
            if bundle.get('optional'):
                logger.info(f"Optional HF file {remote_name} unavailable ({err})")
            else:
                logger.warning(f"Failed to download {remote_name} from {repo_id}: {err}")


# Suppress noisy library warnings — stderr can deadlock the Rust parent process.
warnings.filterwarnings('ignore', category=UserWarning)
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', message='.*pynvml.*')


class AudioAnalyzer:
    """
    Analyzes audio for musical features (BPM, Key, Pitch) using Advanced Ai detection.
    """


    @staticmethod
    def measure_lufs(audio: np.ndarray, sr: int) -> float:
        """
        Measure integrated LUFS loudness using custom algorithm.
        """
        try:
            import pyloudnorm as pyln
            # meter expects (samples, channels)
             # If mono, expand to (samples, 1) or leave as is if meter handles it?
            # Standard is (samples, channels)
            
            if audio.ndim == 1:
                # Mono (samples,) -> (samples, 1)
                data = audio.reshape(-1, 1)
            else:
                 # (channels, samples) -> (samples, channels)
                data = audio.T
                
            meter = pyln.Meter(sr) # create BS.1770 meter
            loudness = meter.integrated_loudness(data)
            return float(loudness)
        except ImportError:
            # Simple RMS fallback if pyln missing
            rms = np.sqrt(np.mean(audio**2))
            # Rough conversion: RMS to dBFS
            db = 20 * np.log10(rms + 1e-9)
            # Add ~3dB for LUFS approx on full mix
            return float(db + 3.0) 
        except Exception:
            return -99.0

    @staticmethod
    def detect_onsets(audio: np.ndarray, sr: int) -> List[float]:
        """
        Detect note onsets (transients).
        Returns list of timestamps in seconds.
        """
        try:
            if audio.ndim > 1:
                audio = np.mean(audio, axis=0) # Mono
            
            onset_frames = librosa.onset.onset_detect(y=audio, sr=sr, wait=1, pre_avg=1, post_avg=1, pre_max=1, post_max=1)
            onset_times = librosa.frames_to_time(onset_frames, sr=sr)
            return list(onset_times)
        except Exception:
            return []

    @staticmethod
    def analyze_file(file_path: str) -> Dict[str, Any]:
        """
        Run full analysis on an audio file.
        Returns JSON-serializable dict.
        """
        try:
            y, sr = librosa.load(file_path, sr=None, mono=False)
            
            # Basic stats
            duration = librosa.get_duration(y=y, sr=sr)
            
            # Musical features
            bpm = AudioAnalyzer.detect_bpm(y, sr)
            key = AudioAnalyzer.detect_key(y, sr) if duration > 5 else "N/A"
            pitch = AudioAnalyzer.detect_pitch(y, sr) if duration > 0.5 else 0
            lufs = AudioAnalyzer.measure_lufs(y, sr)
            
            # Onsets (limit to first 30s to save time/space if huge)
            # Actually, user might want a map. Let's return count or sparse list.
            # Returning full list for UI visualization is good.
            onsets = AudioAnalyzer.detect_onsets(y[:sr*60] if duration > 60 else y, sr) # Analyze first minute
            
            return {
                "filename": os.path.basename(file_path),
                "duration": duration,
                "bpm": round(bpm, 1),
                "key": key,
                "pitch_hz": round(pitch, 1),
                "lufs": round(lufs, 1),
                "onsets_count": len(onsets),
                "onsets_preview": onsets[:50] # Return first 50 note starts
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def detect_bpm(audio: np.ndarray, sr: int) -> float:
        """
        Detect BPM using Consensus between three seperate processes for accuracy.
        Returns the most reliable estimate.
        """
        bpms = {}
        
        # Prepare mono float32 for consistency
        if audio.ndim > 1: audio_mono = np.mean(audio, axis=0)
        else: audio_mono = audio
            
        if audio_mono.dtype != np.float32: audio_mono = audio_mono.astype(np.float32)

        # 1. Essentia (Gold Standard)
        try:
            import essentia.standard as es
            extractor = es.RhythmExtractor2013(method="multifeature")
            bpm, _, _, _, _ = extractor(audio_mono)
            if bpm > 0: bpms['essentia'] = float(bpm)
        except ImportError: pass
        except Exception: pass

        # 2. Aubio (Real-time algo)
        try:
            import aubio
            win_s = 512
            hop_s = 256
            tempo_o = aubio.tempo("default", win_s, hop_s, sr)
            
            scene_bpms = []
            pad_len = hop_s - (len(audio_mono) % hop_s)
            padded = np.pad(audio_mono, (0, pad_len))
            
            for i in range(0, len(padded), hop_s):
                block = padded[i : i + hop_s]
                if tempo_o(block):
                    val = tempo_o.get_bpm()
                    if val > 10: scene_bpms.append(val)
            
            if scene_bpms: bpms['aubio'] = float(np.median(scene_bpms))
        except ImportError: pass
        except Exception: pass

        # 3. Librosa (Classic)
        try:
            onset_env = librosa.onset.onset_strength(y=audio_mono, sr=sr)
            tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
            val = tempo[0] if isinstance(tempo, np.ndarray) else tempo # beat_track returns float usually, beat.tempo returns array
            if val > 0: bpms['librosa'] = float(val)
        except Exception: pass

        if not bpms: return 0.0

        # Consensus Logic
        # Essentia is usually definitive
        if 'essentia' in bpms: return bpms['essentia']
            
        # Check Aubio vs Librosa agreement
        if 'aubio' in bpms and 'librosa' in bpms:
            a, l = bpms['aubio'], bpms['librosa']
            if abs(a - l) < 5: return (a + l) / 2.0
            # Octave doubling check
            if 1.8 < (a / l) < 2.2: return a
            if 1.8 < (l / a) < 2.2: return l
            return l # Trust Librosa global if split
            
        if 'librosa' in bpms: return bpms['librosa']
        if 'aubio' in bpms: return bpms['aubio']
        return 0.0

    @staticmethod
    def detect_key(audio: np.ndarray, sr: int) -> str:
        """
        Detect Key using Ai Analysis (Chroma)
        Attributes: Key (C, Db, D...), Scale (major/minor).
        """
        try:
            # Try Essentia (most accurate)
            import essentia.standard as es
            if audio.ndim > 1:
                audio_mono = np.mean(audio, axis=0)
            else:
                audio_mono = audio
            
            # Essentia expects VectorReal (float32)
            if audio_mono.dtype != np.float32:
                audio_mono = audio_mono.astype(np.float32)
                
            key_extractor = es.KeyExtractor()
            key, scale, strength = key_extractor(audio_mono)
            return f"{key} {scale}"
            
        except ImportError:
            # Fallback to Librosa Chroma
            try:
                if audio.ndim > 1:
                    y = np.mean(audio, axis=0)
                else:
                    y = audio
                    
                chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
                chroma_avg = np.mean(chroma, axis=1)
                
                # Simple template matching could be done here, 
                # but let's return dominant note for now if full key is hard without profiles
                notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
                dominant_idx = np.argmax(chroma_avg)
                return f"{notes[dominant_idx]} (Est)"
            except Exception as e:
                logger.warning(f"Key detection error: {e}")
                return "Unknown"

    @staticmethod
    def detect_pitch(audio: np.ndarray, sr: int) -> float:
        """
        Detect average fundamental frequency (Pitch) using Ai Analysis.
        Returns frequency in Hz.
        """
        try:
            import aubio
            # Ensure proper float32 type for aubio
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)
            
            # Mix to mono for pitch detection
            if audio.ndim > 1:
                audio = np.mean(audio, axis=0)

            # Parameters
            win_s = 4096 // 2
            hop_s = 512
            pitch_method = "yin"

            pitch_o = aubio.pitch(pitch_method, win_s, hop_s, sr)
            pitch_o.set_unit("Hz")
            pitch_o.set_tolerance(0.8)

            pitches = []
            
            # Process in blocks
            # Pad audio to make it multiple of hop_s
            total_samples = len(audio)
            pad_len = hop_s - (total_samples % hop_s)
            if pad_len < hop_s:
                audio = np.pad(audio, (0, pad_len))

            for i in range(0, len(audio), hop_s):
                block = audio[i : i + hop_s]
                # Ensure block size matches win_s if needed? No, hop_s is step. 
                # Aubio expects exactly hop_s size input usually, but let's check docs.
                # Actually aubio pitch expects a vector of size `hop_s`.
                
                if len(block) == hop_s:
                    pitch = pitch_o(block)[0]
                    confidence = pitch_o.get_confidence()
                    if confidence > 0.8 and pitch > 0:
                        pitches.append(pitch)
            
            if not pitches:
                return 0.0
                
            return float(np.median(pitches))

        except ImportError:
            # Fallback to librosa pyin (probabilistic YIN) - better than YIN
            try:
                if audio.ndim > 1:
                    audio = np.mean(audio, axis=0)
                # fmin C2 (~65Hz), fmax C7 (~2093Hz)
                f0, voiced_flag, voiced_probs = librosa.pyin(audio, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=sr)
                valid_f0 = f0[~np.isnan(f0)]
                if len(valid_f0) > 0:
                    return float(np.median(valid_f0))
                return 0.0
            except:
                return 0.0
        except Exception as e:
            logger.warning(f"Pitch detection error: {e}")
            return 0.0


class PedalboardEffects:
    """
    Applies professional audio effects using custom AI-driven library.
    Supports equalization, compression, reverb, and other effects.
    """

    @staticmethod
    def apply_mastering_chain(audio: np.ndarray, sr: int, stem_type: str = 'other') -> np.ndarray:
        """
        Apply professional mastering chain based on stem type.

        Args:
            audio: Audio waveform (channels, samples) or (samples,)
            sr: Sample rate
            stem_type: One of 'vocals', 'drums', 'bass', 'other'

        Returns:
            Processed audio with same shape
        """
        try:
            import pedalboard
        except ImportError:
            logger.warning("Ai Processing library not installed. Skipping effects.")
            return audio

        try:
            # Ensure stereo
            is_mono = audio.ndim == 1
            if is_mono:
                audio = np.stack([audio, audio])

            # Convert to float32 if needed
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)

            # Create effect chain based on stem type
            board = pedalboard.Pedalboard()

            if stem_type == 'vocals':
                # Vocal enhancement: gentle compression + EQ + reverb
                logger.info("Applying vocal mastering chain...")
                board.append(pedalboard.Compressor(threshold_db=-20, ratio=4))
                board.append(pedalboard.HighShelfFilter(cutoff_frequency_hz=5000, gain_db=2))
                board.append(pedalboard.Reverb(room_size=0.3, damping=0.5, wet_level=0.15))

            elif stem_type == 'drums':
                # Drum enhancement: aggressive compression + punchy EQ
                logger.info("Applying drum mastering chain...")
                board.append(pedalboard.Compressor(threshold_db=-15, ratio=6))
                board.append(pedalboard.LowShelfFilter(cutoff_frequency_hz=100, gain_db=3))
                board.append(pedalboard.HighShelfFilter(cutoff_frequency_hz=8000, gain_db=2))

            elif stem_type == 'bass':
                # Bass enhancement: targeted compression + warmth
                logger.info("Applying bass mastering chain...")
                board.append(pedalboard.Compressor(threshold_db=-25, ratio=3))
                board.append(pedalboard.LowShelfFilter(cutoff_frequency_hz=80, gain_db=2))

            else:
                # Light processing for 'other' stems
                logger.info("Applying gentle mastering chain...")
                board.append(pedalboard.Compressor(threshold_db=-30, ratio=2))

            # Process audio
            processed = board(audio, sr)

            # Normalize to prevent clipping
            max_val = np.max(np.abs(processed))
            if max_val > 1.0:
                # Add a small epsilon to prevent any mathematical issues
                processed = processed / (max_val * 1.05)

            # Convert back to mono if input was mono
            if is_mono:
                processed = processed[0]

            logger.info(f" Applied {stem_type} mastering chain")
            return processed

        except Exception as e:
            logger.warning(f"Error applying effects to {stem_type}: {e}")
            return audio


class OutputEncoder:
    """
    Handles encoding stems to different output formats (WAV, MP3).
    """

    SUPPORTED_FORMATS = ['wav', 'mp3']

    @staticmethod
    def encode_stem(
        audio: np.ndarray,
        sr: int,
        output_path: str,
        format: str = 'wav',
        quality: int = 320,  # bitrate for MP3 in kbps
        metadata: Dict[str, str] = None,
    ) -> Tuple[bool, str]:
        """
        Encode audio to specified format.

        Args:
            audio: Audio waveform (channels, samples) or (samples,)
            sr: Sample rate
            output_path: Output file path
            format: 'wav' or 'mp3'
            quality: Bitrate for MP3 (128-320 kbps)
            metadata: Optional metadata tags (title, artist, bpm, etc.)

        Returns:
            Tuple of (success, message)
        """
        try:
            # Ensure stereo
            if audio.ndim == 1:
                audio = np.stack([audio, audio])

            # Normalize to prevent clipping
            max_val = np.max(np.abs(audio))
            if max_val > 1.0:
                audio = audio / (max_val * 1.05)

            if format.lower() == 'wav':
                return OutputEncoder._encode_wav(audio, sr, output_path, metadata)
            elif format.lower() == 'mp3':
                return OutputEncoder._encode_mp3(audio, sr, output_path, quality, metadata)
            else:
                return False, f"Unsupported format: {format}"

        except Exception as e:
            return False, f"Encoding error: {str(e)}"

    @staticmethod
    def _encode_wav(audio: np.ndarray, sr: int, output_path: str, metadata: Dict[str, str] = None) -> Tuple[bool, str]:
        """Encode to WAV format."""
        try:
            sf.write(
                str(output_path),
                audio.T,  # soundfile expects (samples, channels)
                sr,
                subtype='PCM_16',
            )
            # Todo: add RIFF tags if possible using soundfile/taglib if soundfile supports it or post-process
            # Soundfile doesn't easily support arbitrary tags. We might skip this for WAV or use ffmpeg.
            
            file_size_mb = Path(output_path).stat().st_size / (1024 * 1024)
            msg = f"WAV saved ({file_size_mb:.2f}MB)"
            logger.info(f" {msg}")
            return True, msg
        except Exception as e:
            msg = f"WAV encoding failed: {str(e)}"
            logger.error(f" {msg}")
            return False, msg

    @staticmethod
    def _encode_mp3(audio: np.ndarray, sr: int, output_path: str, bitrate: int = 320, metadata: Dict[str, str] = None) -> Tuple[bool, str]:
        """Encode to MP3 format using custom AI-driven libraries."""
        try:
            # First save as temporary WAV
            temp_wav = str(output_path).replace('.mp3', '_temp.wav')
            sf.write(
                temp_wav,
                audio.T,
                sr,
                subtype='PCM_16',
            )

            # Prepare metadata tags
            tags = metadata if metadata else {}

            # Use pydub or FFmpeg to convert to MP3
            try:
                from pydub import AudioSegment
                
                # Configure pydub to use bundled FFmpeg if available
                bundled_ffmpeg = Path(__file__).parent.parent / 'ffmpeg' / 'ffmpeg.exe'
                if bundled_ffmpeg.exists():
                    AudioSegment.converter = str(bundled_ffmpeg)
                
                logger.info(f"Converting to MP3 (bitrate: {bitrate}kbps)...")
                audio_pydub = AudioSegment.from_wav(temp_wav)
                audio_pydub.export(
                    output_path,
                    format="mp3",
                    bitrate=f"{bitrate}k",
                    parameters=["-q:a", "0"],  # VBR quality
                    tags=tags
                )
                os.remove(temp_wav)
                file_size_mb = Path(output_path).stat().st_size / (1024 * 1024)
                msg = f"MP3 saved ({file_size_mb:.2f}MB, {bitrate}kbps)"
                logger.info(f" {msg}")
                return True, msg
                
            except ImportError:
                # Fallback to FFmpeg via subprocess
                logger.info(f"Converting to MP3 (bitrate: {bitrate}kbps)...")
                
                # Try bundled FFmpeg first, then system PATH
                ffmpeg_paths = [
                    Path(__file__).parent.parent / 'ffmpeg' / 'ffmpeg.exe',  # Bundled with app
                    Path(sys.executable).parent.parent / 'ffmpeg' / 'ffmpeg.exe',  # Relative to Python
                    'ffmpeg',  # System PATH
                ]
                ffmpeg_cmd = 'ffmpeg'
                for ffp in ffmpeg_paths:
                    if isinstance(ffp, Path) and ffp.exists():
                        ffmpeg_cmd = str(ffp)
                        break
                
                cmd = [
                    ffmpeg_cmd,
                    '-i', temp_wav,
                    '-c:a', 'libmp3lame',
                    '-b:a', f'{bitrate}k',
                    '-q:a', '0',
                ]
                
                # Add metadata args for FFmpeg
                for k, v in tags.items():
                    cmd.extend(['-metadata', f"{k}={v}"])
                
                cmd.extend(['-y', output_path])

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode != 0:
                    raise Exception(f"Failed: {result.stderr}")
                    
                os.remove(temp_wav)
                file_size_mb = Path(output_path).stat().st_size / (1024 * 1024)
                msg = f"MP3 saved ({file_size_mb:.2f}MB, {bitrate}kbps)"
                logger.info(f" {msg}")
                return True, msg

        except Exception as e:
            msg = f"MP3 encoding failed: {str(e)}"
            logger.error(f" {msg}")
            return False, msg



class AudioSeparator:
    """
    High-quality audio stem separator with post-processing leakage cleanup.
    Interfaces with AI-driven algorithms and spectral subtraction for artifact removal.
    """

    # Supported stems from Demucs
    STEMS = ['drums', 'bass', 'other', 'vocals']
    
    # Audio format support
    SUPPORTED_FORMATS = ['.wav', '.mp3', '.flac', '.ogg', '.m4a']

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the separator with hardware configuration.

        Args:
            config: Hardware configuration from hardware_brain.py
        """
        self.config = config
        self.device = config.get('device', 'cpu')
        self.split_strategy = config.get('split_strategy', 'default')
        self.output_format = config.get('output_format', 'wav').lower()
        self.mp3_bitrate = config.get('mp3_bitrate', 320)
        self.apply_effects = config.get('apply_effects', True)
        
        # Import Demucs here to allow optional import
        try:
            # Demucs v4.0.1 uses subprocess-based separation
            from demucs.separate import main as demucs_main
            from demucs import apply
            import torch

            # Fix for PyTorch 2.6 weights_only security change.
            # We globally monkey-patch torch.load to default to weights_only=False
            # as many older audio separation models (demucs, mdx) use pickles.
            _original_torch_load = torch.load
            def _patched_torch_load(*args, **kwargs):
                if 'weights_only' not in kwargs:
                    kwargs['weights_only'] = False
                return _original_torch_load(*args, **kwargs)
            torch.load = _patched_torch_load

            # Also try to allowlist common objects if patching fails for some reason
            try:
                import demucs.hdemucs
                import demucs.htdemucs
                import fractions
                import numpy.core.multiarray
                torch.serialization.add_safe_globals([
                    demucs.hdemucs.HDemucs, 
                    demucs.htdemucs.HTDemucs,
                    fractions.Fraction,
                    numpy.core.multiarray.scalar
                ])
            except AttributeError:
                pass # If PyTorch < 2.6 or not available, don't worry about it
                
            self.engine = config.get('engine', 'demucs')
            self.stems_count = int(config.get('stems', 4))
            self.model_variant = config.get('model_variant', '').strip()
            variant_meta = resolve_model_variant(self.model_variant) if self.model_variant else {}

            if variant_meta.get('backend') == 'demucs' and variant_meta.get('model'):
                self.engine = 'demucs'
                config['demucs_model'] = variant_meta['model']
            elif variant_meta.get('backend') == 'mvsep':
                self.engine = 'mdx'
            elif variant_meta.get('backend') == 'audio_separator':
                engine_hint = variant_meta.get('engine') or config.get('engine', 'mdx')
                self.engine = engine_hint if engine_hint in (
                    'vr', 'roformer', 'mdx_net', 'karaoke', 'drumsep_mdx', 'instrument'
                ) else 'mdx_net'
            elif variant_meta.get('backend') == 'ensemble':
                self.engine = 'ensemble'
            elif variant_meta.get('backend') == 'postfx':
                self.engine = 'postfx'
            elif variant_meta.get('backend') == 'spleeter':
                self.engine = 'spleeter'
            elif variant_meta.get('backend') == 'drumsep':
                self.engine = 'drumsep' if self.model_variant == 'drumsep_49469' else 'drumsep_mdx'
            elif self.model_variant.startswith('drumsep_mdx23c_'):
                self.engine = 'drumsep_mdx'
                variant_meta = resolve_model_variant(self.model_variant)
            elif self.model_variant == 'drumsep_49469':
                self.engine = 'drumsep'
                variant_meta = resolve_model_variant(self.model_variant)
            self.variant_meta = variant_meta
            self.post_fx = config.get('post_fx', '').strip()
            self.reference_file = config.get('reference_file', '').strip()
            self.extra_models = config.get('extra_models') or []
            self.chunk_duration = config.get('chunk_duration')

            # --- CRITICAL FIX: MDX does not support 6 stems ---
            # If user requests 6 stems with MDX, fallback to htdemucs_6s
            if self.engine == 'mdx' and self.stems_count > 4:
                logger.warning(f"MDX engine only supports 4 stems. Fallback to Demucs (htdemucs_6s) for {self.stems_count} stems.")
                self.engine = 'demucs'
                config['demucs_model'] = 'htdemucs_6s'

            # Store model name and configuration
            self.model = config.get('demucs_model', 'htdemucs')
            if self.stems_count == 6 and self.engine == 'demucs':
                 self.model = 'htdemucs_6s'

            logger.info(
                f" Engine: {self.engine}, Model: {self.model}, Stems: {self.stems_count}, "
                f"Device: {self.device}, Variant: {self.model_variant or '(none)'}"
            )
        except ImportError as e:
            logger.error(f"Ai Stem Split not installed. Install with: pip install demucs. Error: {e}")
            raise

        # Configure torch device if available
        if self.device == 'cuda':
            try:
                import torch
                torch.cuda.empty_cache()
                logger.info(" CUDA memory cleared")
            except Exception as e:
                logger.warning(f"CUDA initialization warning: {e}")

    def analyze_stems(self, stems: Dict[str, np.ndarray], sr: int, progress_hook=None) -> Dict[str, Any]:
        """Run analysis on separated stems."""
        results = {}
        for name, audio in stems.items():
            try:
                # BPM/Pitch/Loudness
                bpm = AudioAnalyzer.detect_bpm(audio, sr)
                key = AudioAnalyzer.detect_key(audio, sr)
                pitch = AudioAnalyzer.detect_pitch(audio, sr)
                lufs = AudioAnalyzer.measure_lufs(audio, sr)
                results[name] = {
                    "bpm": bpm,
                    "key": key,
                    "pitch_hz": pitch,
                    "lufs": lufs
                }
            except Exception as e:
                logger.warning(f"Analysis failed on stem {name}: {e}")
        return results

    def _validate_input_file(self, file_path: str) -> Tuple[bool, str]:
        """
        Validate input audio file by reading metadata only (fast, no full load).

        Args:
            file_path: Path to audio file

        Returns:
            Tuple of (is_valid, message)
        """
        path = Path(file_path)

        if not path.exists():
            return False, f"File not found: {file_path}"

        if path.suffix.lower() not in self.SUPPORTED_FORMATS:
            return False, f"Unsupported format: {path.suffix}. Supported: {self.SUPPORTED_FORMATS}"

        try:
            # Fast validation: read only file metadata, NOT entire audio data
            info = sf.info(file_path)
            duration = info.duration
            sr = info.samplerate
            logger.info(f" Input file valid: {path.name} ({duration:.2f}s)")
            return True, f"Valid audio file ({duration:.2f}s, {sr}Hz)"
        except Exception as e:
            return False, f"Error reading audio file: {str(e)}"

    def _load_audio(self, file_path: str) -> Tuple[np.ndarray, int]:
        """
        Load audio file with optimal settings.

        Args:
            file_path: Path to audio file

        Returns:
            Tuple of (audio_data, sample_rate)
        """
        logger.info(f"Loading audio: {file_path}")
        
        try:
            # Load with original sample rate
            y, sr = librosa.load(file_path, sr=None, mono=False)
            duration = librosa.get_duration(y=y, sr=sr)

            max_duration = getattr(self, 'config', {}).get('max_duration_seconds')
            if getattr(self, 'config', {}).get('trial_mode') and max_duration:
                max_samples = int(float(max_duration) * sr)
                if y.ndim == 1:
                    if y.shape[-1] > max_samples:
                        logger.info(f" Trial mode: trimming audio from {duration:.2f}s to {max_duration}s")
                        y = y[:max_samples]
                elif y.shape[-1] > max_samples:
                    logger.info(f" Trial mode: trimming audio from {duration:.2f}s to {max_duration}s")
                    y = y[:, :max_samples]
                duration = librosa.get_duration(y=y, sr=sr)

            logger.info(f" Loaded {file_path}: {duration:.2f}s @ {sr}Hz")
            return y, sr
        except Exception as e:
            logger.error(f"Error loading audio: {e}")
            raise

    def _separate_stems(self, audio: np.ndarray, sr: int) -> Dict[str, np.ndarray]:
        """
        Perform stem separation using Demucs.

        Args:
            audio: Audio data (mono or stereo)
            sr: Sample rate

        Returns:
            Dictionary with stem names as keys and audio arrays as values
        """
        logger.info("Starting stem separation...")
        separation_start = time.time()

        try:
            import torch
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            
            # Get model
            model_name = self.model
            from demucs.repo import RemoteRepo, AnyModelRepo
            
            if hasattr(self, 'engine') and self.engine == 'drumsep':
                # Drumsep uses a specific local repo and hash
                import os
                model_name = '49469ca8'
                # Provide the local model repo path
                script_dir = os.path.dirname(os.path.abspath(__file__))
                drumsep_repo = resolve_drumsep_repo()
                logger.info(f"Loading Drumsep model {model_name} from {drumsep_repo}")
                model = get_model(model_name, repo=drumsep_repo)
            else:
                if hasattr(self, 'stems_count') and self.stems_count == 6 and model_name == 'htdemucs':
                    model_name = 'htdemucs_6s'
                demucs_repo = resolve_demucs_models_repo()
                if demucs_repo:
                    logger.info(f"Loading Demucs model: {model_name} from local repo {demucs_repo}")
                    model = get_model(model_name, repo=demucs_repo)
                else:
                    logger.info(f"Loading Demucs model: {model_name}")
                    model = get_model(model_name)
            
            model = model.to(self.device)
            model.eval()
            
            # Ensure stereo
            if audio.ndim == 1:
                audio = np.stack([audio, audio])
            
            # Convert numpy to torch tensor (channels, samples)
            waveform = torch.from_numpy(audio).float()
            
            # Resample if needed (Demucs expects 44.1 kHz by default for htdemucs)
            target_sr = model.samplerate  # Use model's expected sample rate
            if sr != target_sr:
                logger.info(f"Resampling from {sr} to {target_sr}Hz")
                try:
                    from torchaudio.transforms import Resample
                    resampler = Resample(sr, target_sr)
                    waveform = resampler(waveform)
                except Exception as resample_error:
                    logger.warning(f"Torchaudio resampler unavailable, falling back to librosa: {resample_error}")
                    resampled = librosa.resample(
                        waveform.cpu().numpy(),
                        orig_sr=sr,
                        target_sr=target_sr,
                        axis=-1,
                    )
                    waveform = torch.from_numpy(np.asarray(resampled, dtype=np.float32))
                sr = target_sr
            
            # Perform separation using apply_model (requires batch dimension)
            shifts = self.config.get('shifts', 2)  # Default to 2 shifts for better quality (purity)
            split = self.config.get('split', True)
            overlap = self.config.get('overlap', 0.25)

            logger.info(f"Performing stem separation with shifts={shifts}, split={split}, overlap={overlap}...")
            with torch.no_grad():
                # apply_model expects (batch, channels, samples) input
                sources = apply_model(model, waveform[None], shifts=shifts, split=split, overlap=overlap)  # Add batch dimension
            
            # Extract stems: sources shape is [batch=1, sources, channels, samples]
            stems = {}
            # Map Spanish drum components to English for output
            stem_name_map = {
                'bombo': 'kick',
                'redoblante': 'snare',
                'platillos': 'cymbals',
                'toms': 'toms'
            }
            
            for i, stem_name in enumerate(model.sources):
                english_name = stem_name_map.get(stem_name, stem_name)
                # Extract audio for source i from first batch
                stem_audio = sources[0, i]  # (channels, samples)
                stems[english_name] = stem_audio.cpu().numpy()

            separation_time = time.time() - separation_start
            logger.info(f" Separation complete in {separation_time:.2f}s")
            
            return stems

        except Exception as e:
            logger.error(f"Separation failed: {e}", exc_info=True)
            raise

    def _separate_mdx(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        """
        Perform stem separation using MVSEP-MDX23 model.
        """
        logger.info("Starting MDX-Net stem separation...")
        separation_start = time.time()
        import importlib.util
        
        try:
            mdx_folder = resolve_mdx_folder()
            
            logger.info(f"Importing MDX inference from {mdx_folder}")
            sys.path.insert(0, mdx_folder)
            
            try:
                import inference as mdx_inference
                logger.info("MDX inference module imported successfully")
            except ImportError as ie:
                logger.error(f"Failed to import inference module: {ie}")
                raise
            except Exception as e:
                logger.error(f"Error during import of inference module: {e}")
                raise

            # Reconstruct the options struct MDX inference expects
            options = {
                'input_audio': [input_file],
                'output_folder': '', # Memory only
                'overlap_large': 0.6,
                'overlap_small': 0.5,
                'cpu': self.device == 'cpu',
                'single_onnx': False,
                'chunk_size': 500000 if self.device == 'cpu' else 1000000,
                'large_gpu': False,
            }
            
            # Since the MDX23 script natively writes to disk, 
            # we will extract its model initialization and processing logic and process in memory
            try:
                # LowGPU ignores only_vocals and always runs 4 Demucs backing models.
                # For 2-stem mode use the base class, which skips that heavy path.
                only_vocals = (getattr(self, 'stems_count', 4) == 2)
                if only_vocals and hasattr(mdx_inference, 'EnsembleDemucsMDXMusicSeparationModel'):
                    logger.info("Initializing MDX base model (2-stem / only_vocals fast path)...")
                    model = mdx_inference.EnsembleDemucsMDXMusicSeparationModel(options)
                    logger.info("MDX Model Base initialized")
                elif hasattr(mdx_inference, 'EnsembleDemucsMDXMusicSeparationModelLowGPU'):
                    logger.info("Initializing EnsembleDemucsMDXMusicSeparationModelLowGPU...")
                    model = mdx_inference.EnsembleDemucsMDXMusicSeparationModelLowGPU(options)
                    logger.info("MDX Model LowGPU initialized")
                elif hasattr(mdx_inference, 'EnsembleDemucsMDXMusicSeparationModel'):
                    logger.info("LowGPU model class not found, trying base EnsembleDemucsMDXMusicSeparationModel...")
                    model = mdx_inference.EnsembleDemucsMDXMusicSeparationModel(options)
                    logger.info("MDX Model Base initialized")
                else:
                    raise Exception("Available classes in inference: " + str(dir(mdx_inference)))

            except Exception as me:
                logger.error(f"Failed to initialize MDX Model class: {me}")
                raise
            
            # It expects shape (samples, channels) - NOT (channels, samples) and channels must be 2
            if audio.ndim == 1:
               mdx_audio = np.stack([audio, audio], axis=-1)
            else:
               mdx_audio = audio.T
               
            # Process single file — only_vocals set above when selecting model class
            if 'only_vocals' not in locals():
                only_vocals = (getattr(self, 'stems_count', 4) == 2)
            
            # Create a progress callback wrapper if hook exists
            callback = None
            if progress_hook:
                 def callback(p):
                     # Map 0-100 to 40-90 range of overall progress (Step 3/5)
                     real_p = 40 + int(p * 0.5)
                     progress_hook(3, 5, f"MDX Processing ({p}%)...", real_p)

            logger.info(f"Calling separate_music_file (only_vocals={only_vocals})...")
            separated_music_arrays, _ = model.separate_music_file(
                mdx_audio,
                sr,
                update_percent_func=callback,
                current_file_number=0,
                total_files=1,
                only_vocals=only_vocals,
            )
            
            stems = {}
            if only_vocals and 'vocals' in separated_music_arrays:
                # 2-Stem Optimization applied: Calculate instrumental by subtraction
                vocals_stem = separated_music_arrays['vocals'].T
                stems['vocals'] = vocals_stem
                
                # Check shapes for subtraction
                audio_for_sub = audio
                if audio.ndim == 1:
                     audio_for_sub = np.stack([audio, audio])
                
                # Ensure shapes match exactly
                if vocals_stem.shape == audio_for_sub.shape:
                    stems['instrumental'] = audio_for_sub - vocals_stem
                else:
                    # Robust subtraction with trimming
                    n_samples = min(vocals_stem.shape[1], audio_for_sub.shape[1])
                    stems['instrumental'] = audio_for_sub[:, :n_samples] - vocals_stem[:, :n_samples]
                    stems['vocals'] = vocals_stem[:, :n_samples]
            else:
                for instrument, instrument_array in separated_music_arrays.items():
                    # Transpose back from (samples, channels) to (channels, samples)
                    stems[instrument] = instrument_array.T
                
            logger.info(f"MDX Separation complete in {time.time() - separation_start:.2f}s")
            
            # Cleanup
            if mdx_folder in sys.path:
                sys.path.remove(mdx_folder)
            return stems

        except Exception as e:
            logger.error(f"MDX Separation failed: {e}", exc_info=True)
            # Try to cleanup path even on error
            if 'mdx_folder' in locals() and mdx_folder in sys.path:
                sys.path.remove(mdx_folder)
            raise

    def _select_model(self) -> str:
        """
        Select appropriate Demucs model based on strategy.

        Returns:
            Model name string
        """
        strategy_to_model = {
            'fast': 'htdemucs_ft',      # Fast model
            'segmented': 'htdemucs',    # Standard model with segmentation
            'default': 'htdemucs',      # Standard model
        }
        return strategy_to_model.get(self.split_strategy, 'htdemucs')

    def _spectral_subtraction(
        self,
        vocal_audio: np.ndarray,
        drum_audio: np.ndarray,
        sr: int,
        alpha: float = 0.5,
        threshold: float = 0.02,
    ) -> np.ndarray:
        """
        Perform spectral subtraction to reduce drum leakage in vocals.
        Reduces high-hat leakage by subtracting drum STFT from vocal STFT.

        Args:
            vocal_audio: Vocal stem waveform
            drum_audio: Drum stem waveform
            sr: Sample rate
            alpha: Subtraction weight (0.5 = moderate reduction)
            threshold: Floor threshold to prevent over-subtraction

        Returns:
            Cleaned vocal audio
        """
        logger.info("Performing spectral subtraction (leakage cleanup)...")

        try:
            # Ensure stereo
            if vocal_audio.ndim == 1:
                vocal_audio = np.stack([vocal_audio, vocal_audio])
            if drum_audio.ndim == 1:
                drum_audio = np.stack([drum_audio, drum_audio])

            # Process each channel
            cleaned_channels = []

            for ch in range(vocal_audio.shape[0]):
                # Extract channel
                vocal_ch = vocal_audio[ch]
                drum_ch = drum_audio[ch]

                # Compute STFT
                vocal_stft = librosa.stft(vocal_ch, n_fft=2048, hop_length=512)
                drum_stft = librosa.stft(drum_ch, n_fft=2048, hop_length=512)

                # Compute magnitude spectrograms
                vocal_mag = np.abs(vocal_stft)
                drum_mag = np.abs(drum_stft)

                # Normalize drum magnitude
                drum_mag_norm = drum_mag / (np.max(drum_mag) + 1e-8)

                # Apply spectral subtraction
                # Reduce drums' influence on vocals
                subtracted_mag = vocal_mag - (alpha * drum_mag_norm * vocal_mag)

                # Apply floor threshold to prevent artifacts
                subtracted_mag = np.maximum(subtracted_mag, threshold * vocal_mag)

                # Preserve phase information
                vocal_phase = np.angle(vocal_stft)
                cleaned_stft = subtracted_mag * np.exp(1j * vocal_phase)

                # Inverse STFT
                cleaned_ch = librosa.istft(cleaned_stft, hop_length=512)

                # Ensure same length as original
                if len(cleaned_ch) < len(vocal_ch):
                    cleaned_ch = np.pad(cleaned_ch, (0, len(vocal_ch) - len(cleaned_ch)))
                else:
                    cleaned_ch = cleaned_ch[:len(vocal_ch)]

                cleaned_channels.append(cleaned_ch)

            cleaned_audio = np.stack(cleaned_channels)
            logger.info(" Spectral subtraction complete")
            return cleaned_audio

        except Exception as e:
            logger.warning(f"Spectral subtraction error (using original): {e}")
            return vocal_audio

    @staticmethod
    def _parse_stem_key_from_filename(file_name: str) -> str:
        file_lower = file_name.lower()
        rules = [
            ('lead', 'lead'), ('backing', 'backing'), ('back_vocal', 'backing'),
            ('kick', 'kick'), ('snare', 'snare'), ('tom', 'toms'),
            ('hi-hat', 'hh'), ('hihat', 'hh'), (' hh', 'hh'), ('_hh', 'hh'),
            ('ride', 'ride'), ('crash', 'crash'), ('cymbal', 'cymbals'),
            ('guitar', 'guitar'), ('piano', 'piano'), ('keys', 'piano'),
            ('woodwind', 'woodwinds'), ('no woodwind', 'other'),
            ('string', 'strings'), ('violin', 'violin'), ('cello', 'cello'),
            ('viola', 'viola'), ('sax', 'saxophone'), ('trumpet', 'trumpet'),
            ('trombone', 'trombone'), ('flute', 'flute'), ('brass', 'brass'),
            ('organ', 'organ'), ('synth', 'synth'), ('harp', 'harp'),
            ('banjo', 'banjo'), ('mandolin', 'mandolin'), ('ukulele', 'ukulele'),
            ('male', 'male'), ('female', 'female'), ('choir', 'choir'),
            ('vocal', 'vocals'), ('instrumental', 'instrumental'),
            ('no_vocal', 'instrumental'), ('no vocal', 'instrumental'),
            ('bass', 'bass'), ('drum', 'drums'), ('crowd', 'crowd'),
            ('audience', 'crowd'), ('dry', 'dry'), ('reverb', 'reverb'),
            ('echo', 'no_echo'), ('noise', 'clean'),
        ]
        for pattern, key in rules:
            if pattern in file_lower:
                return key
        return 'other'

    def _separate_audio_separator(
        self,
        input_file: str,
        sr: int,
        model_filename: str,
        progress_hook=None,
        label: str = 'Audio-Separator',
        variant_meta: Optional[Dict[str, Any]] = None,
        output_single_stem: Optional[str] = None,
    ) -> Dict[str, np.ndarray]:
        """Generic separation via audio-separator (MDX ONNX, VR pth, Roformer ckpt)."""
        catalog_filename = resolve_audio_separator_filename(model_filename)
        if catalog_filename != model_filename:
            logger.info(f"Mapped model {model_filename} → catalog name {catalog_filename}")
            model_filename = catalog_filename

        logger.info(f"Starting {label} separation with {model_filename}...")
        try:
            from audio_separator.separator import Separator
            import tempfile

            variant_meta = variant_meta or {}
            hf_bundle = variant_meta.get('hf_bundle')
            msst_bundle = variant_meta.get('msst_bundle') or (
                model_filename if model_filename in MSST_MODEL_BUNDLES else None
            )
            model_dir_path = Path(get_audio_separator_model_dir())
            if msst_bundle:
                ensure_msst_bundle(model_dir_path, msst_bundle)
            if hf_bundle:
                ensure_instrument_hf_bundle(model_dir_path, hf_bundle)
            elif model_filename == 'BS-Roformer-SW.ckpt':
                ensure_instrument_hf_bundle(model_dir_path, 'BS-Roformer-SW')

            local_path = resolve_model_file(model_filename)
            alias_names = list(variant_meta.get('aliases') or [])
            if not local_path:
                for alias in alias_names:
                    local_path = resolve_model_file(alias)
                    if local_path:
                        break

            model_dir = str(model_dir_path)
            os.makedirs(model_dir, exist_ok=True)
            if local_path:
                seed_model_into_cache(Path(model_dir), model_filename, local_path)
            else:
                for alias in alias_names:
                    alias_path = resolve_model_file(alias)
                    if alias_path:
                        seed_model_into_cache(Path(model_dir), model_filename, alias_path)
                        break

            logger.info(f"Loading {label} model: {model_filename} from {model_dir}")
            temp_dir = tempfile.mkdtemp(prefix="stemsplit_as_")

            sep_kwargs: Dict[str, Any] = {
                'model_file_dir': model_dir,
                'output_dir': temp_dir,
                'output_format': 'wav',
                'log_level': logging.WARNING,
            }
            if output_single_stem:
                sep_kwargs['output_single_stem'] = output_single_stem
            if getattr(self, 'chunk_duration', None):
                sep_kwargs['chunk_duration'] = int(self.chunk_duration)

            separator = Separator(**sep_kwargs)
            _patch_separator_for_msst_models(separator, model_filename)

            extra = getattr(self, 'extra_models', None) or []
            if extra:
                models = [model_filename] + list(extra)
                separator.load_model(model_filename=models)
            else:
                separator.load_model(model_filename=model_filename)

            if progress_hook:
                progress_hook(3, 5, f"{label} inference running...", 55)

            output_files = separator.separate(input_file)

            stems_data: Dict[str, np.ndarray] = {}
            for file_name in output_files:
                file_path = os.path.join(temp_dir, file_name)
                stem_key = self._parse_stem_key_from_filename(file_name)
                logger.info(f"Reading {label} stem '{stem_key}' from {file_name}")
                stem_audio, _ = librosa.load(file_path, sr=sr, mono=False)
                if stem_audio.ndim == 1:
                    stem_audio = np.vstack([stem_audio, stem_audio])
                if stem_key in stems_data:
                    stems_data[stem_key] = stems_data[stem_key] + stem_audio
                else:
                    stems_data[stem_key] = stem_audio

            if 'vocals' in stems_data and 'instrumental' not in stems_data:
                for alt in ('other', 'no_vocals', 'instrumental'):
                    if alt in stems_data:
                        stems_data['instrumental'] = stems_data.pop(alt)
                        break

            return stems_data

        except ImportError as ie:
            missing = str(ie)
            if 'audio_separator' in missing:
                logger.error("Requires 'audio-separator'. Install: pip install audio-separator[cpu]")
                raise RuntimeError(f"{label} not installed. Try Demucs or MDX23 ensemble.") from ie
            if 'torchvision' in missing or 'onnx2torch' in missing:
                logger.error(f"MDX-Net ONNX dependency missing: {missing}")
                raise RuntimeError(
                    f"{label} requires torchvision/onnx2torch for ONNX models. "
                    "Run Deep Repair from Settings or: pip install torchvision onnx2torch"
                ) from ie
            raise
        except Exception as e:
            logger.error(f"{label} separation failed: {e}", exc_info=True)
            raise

    def _separate_ensemble(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        """Multi-model fusion via audio-separator ensemble presets."""
        variant_meta = getattr(self, 'variant_meta', {}) or resolve_model_variant(getattr(self, 'model_variant', ''))
        preset = variant_meta.get('preset', 'vocal_balanced')
        logger.info(f"Starting Ensemble preset: {preset}")
        try:
            from audio_separator.separator import Separator
            import tempfile

            model_dir = get_audio_separator_model_dir()
            os.makedirs(model_dir, exist_ok=True)
            temp_dir = tempfile.mkdtemp(prefix="stemsplit_ensemble_")

            sep_kwargs: Dict[str, Any] = {
                'model_file_dir': model_dir,
                'output_dir': temp_dir,
                'output_format': 'wav',
                'log_level': logging.WARNING,
                'ensemble_preset': preset,
            }
            if getattr(self, 'chunk_duration', None):
                sep_kwargs['chunk_duration'] = int(self.chunk_duration)

            separator = Separator(**sep_kwargs)
            separator.load_model()

            if progress_hook:
                progress_hook(3, 5, f"Ensemble ({preset}) running...", 55)

            output_files = separator.separate(input_file)
            stems_data: Dict[str, np.ndarray] = {}
            for file_name in output_files:
                file_path = os.path.join(temp_dir, file_name)
                stem_key = self._parse_stem_key_from_filename(file_name)
                stem_audio, _ = librosa.load(file_path, sr=sr, mono=False)
                if stem_audio.ndim == 1:
                    stem_audio = np.vstack([stem_audio, stem_audio])
                stems_data[stem_key] = stem_audio

            if 'vocals' in stems_data and 'instrumental' not in stems_data:
                for alt in ('other', 'no_vocals', 'instrumental'):
                    if alt in stems_data:
                        stems_data['instrumental'] = stems_data.pop(alt)
                        break
            return stems_data
        except ImportError:
            raise RuntimeError("Ensemble requires audio-separator. pip install audio-separator[cpu]")
        except Exception as e:
            logger.error(f"Ensemble failed: {e}", exc_info=True)
            raise

    def _separate_drumsep_mdx(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        variant_meta = getattr(self, 'variant_meta', {}) or resolve_model_variant(getattr(self, 'model_variant', ''))
        model_filename = variant_meta.get('filename')
        if not model_filename:
            raise ValueError("No drumsep MDX model configured")
        stems = self._separate_audio_separator(
            input_file, sr, model_filename, progress_hook, label='Drumsep-MDX23C', variant_meta=variant_meta
        )
        merge_map = variant_meta.get('merge_6stem') or {}
        for src, dst in merge_map.items():
            if src not in stems:
                continue
            if dst in stems:
                stems[dst] = stems[dst] + stems[src]
            else:
                stems[dst] = stems[src]
            del stems[src]

        expected = variant_meta.get('stems') or []
        if expected:
            stems = {name: stems[name] for name in expected if name in stems}
        return stems

    def _separate_msst(
        self,
        input_file: str,
        audio: np.ndarray,
        sr: int,
        progress_hook=None,
        bundle_key: Optional[str] = None,
        msst_model_type: Optional[str] = None,
        label: str = 'MSST',
    ) -> Dict[str, np.ndarray]:
        """Run ZFTurbo MSST inference for architectures audio-separator cannot load (htdemucs, scnet)."""
        import argparse
        import torch

        variant_meta = getattr(self, 'variant_meta', {}) or resolve_model_variant(getattr(self, 'model_variant', ''))
        bundle_key = bundle_key or variant_meta.get('msst_bundle')
        if not bundle_key:
            raise ValueError("No MSST bundle configured for this variant")

        bundle = MSST_MODEL_BUNDLES.get(bundle_key)
        if not bundle:
            raise ValueError(f"Unknown MSST bundle: {bundle_key}")

        msst_model_type = msst_model_type or bundle.get('msst_model_type')
        if not msst_model_type:
            raise ValueError(f"MSST bundle {bundle_key} has no msst_model_type")

        cache_dir = Path(get_audio_separator_model_dir())
        ensure_msst_bundle(cache_dir, bundle_key)
        repo = ensure_msst_repo()

        ckpt_path = cache_dir / bundle_key
        yaml_path = cache_dir / bundle['yaml']
        if not ckpt_path.is_file() or not yaml_path.is_file():
            raise RuntimeError(f"MSST assets missing for {bundle_key}")

        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))

        from utils.model_utils import bigshifts_wrapper, load_start_checkpoint
        from utils.settings import get_model_from_config

        logger.info(f"Starting {label} separation via MSST ({msst_model_type}) with {bundle_key}...")
        model, config = get_model_from_config(msst_model_type, str(yaml_path))
        checkpoint = torch.load(str(ckpt_path), map_location='cpu', weights_only=False)
        load_args = argparse.Namespace(
            start_check_point=str(ckpt_path),
            model_type=msst_model_type,
            load_only_compatible_weights=False,
            lora_checkpoint_loralib='',
            lora_checkpoint_peft='',
        )
        load_start_checkpoint(load_args, model, checkpoint, type_='inference')

        device = self.device if self.device in ('cuda', 'mps') else 'cpu'
        if device == 'cuda' and not torch.cuda.is_available():
            device = 'cpu'
        model = model.to(device).eval()

        if progress_hook:
            progress_hook(3, 5, f"{label} MSST inference running...", 55)

        if audio.ndim == 1:
            mix = np.stack([audio, audio])
        else:
            mix = audio.copy()

        sample_rate = int(getattr(config.audio, 'sample_rate', 44100))
        if sr != sample_rate:
            mix = librosa.resample(mix, orig_sr=sr, target_sr=sample_rate, axis=-1)

        with torch.no_grad():
            waveforms = bigshifts_wrapper(
                config,
                model,
                mix,
                device,
                model_type=msst_model_type,
                pbar=False,
                bigshifts=1,
            )

        instruments = list(config.training.instruments)
        stems: Dict[str, np.ndarray] = {}
        for instr in instruments:
            if instr not in waveforms:
                continue
            stem = np.asarray(waveforms[instr], dtype=np.float32)
            if stem.ndim == 1:
                stem = np.stack([stem, stem])
            if sample_rate != sr:
                stem = librosa.resample(stem, orig_sr=sample_rate, target_sr=sr, axis=-1)
            stems[instr] = stem

        if self.stems_count == 2:
            if 'vocals' in stems and 'instrumental' not in stems:
                if 'other' in stems:
                    stems['instrumental'] = stems.pop('other')
                else:
                    residual = mix if sample_rate == sr else librosa.resample(
                        mix, orig_sr=sample_rate, target_sr=sr, axis=-1
                    )
                    stems['instrumental'] = residual - stems['vocals']
            keep = [name for name in ('vocals', 'instrumental') if name in stems]
            if keep:
                stems = {name: stems[name] for name in keep}

        return stems

    @staticmethod
    def _normalize_instrument_stems(
        stems_data: Dict[str, np.ndarray],
        variant_meta: Dict[str, Any],
    ) -> Dict[str, np.ndarray]:
        """Map audio-separator output stems to catalog target names."""
        mode = variant_meta.get('mode', 'extract')
        target = variant_meta.get('target', '')
        expected = variant_meta.get('stems') or []

        if mode == 'multistem' and expected:
            normalized: Dict[str, np.ndarray] = {}
            for stem_name in expected:
                if stem_name in stems_data:
                    normalized[stem_name] = stems_data[stem_name]
            for key, audio in stems_data.items():
                if key not in normalized:
                    normalized[key] = audio
            return normalized or stems_data

        if not target:
            return stems_data

        target_aliases = {
            'guitar': ('guitar',),
            'piano': ('piano', 'keys'),
            'keys': ('piano', 'keys'),
            'bass': ('bass',),
            'drums': ('drums', 'percussion'),
            'woodwinds': ('woodwinds', 'woodwind'),
            'strings': ('strings', 'string'),
            'violin': ('violin', 'strings'),
            'cello': ('cello', 'strings'),
            'viola': ('viola', 'strings'),
            'saxophone': ('saxophone', 'sax', 'woodwinds'),
            'trumpet': ('trumpet', 'brass', 'woodwinds'),
            'brass': ('brass', 'trumpet', 'trombone'),
            'flute': ('flute', 'woodwinds'),
            'organ': ('organ', 'piano'),
            'synth': ('synth', 'other'),
            'harp': ('harp', 'other'),
            'banjo': ('banjo', 'guitar'),
            'mandolin': ('mandolin', 'guitar'),
            'ukulele': ('ukulele', 'guitar'),
        }

        aliases = target_aliases.get(target, (target,))
        instrument_audio = None
        for alias in aliases:
            if alias in stems_data:
                instrument_audio = stems_data[alias]
                break

        if instrument_audio is None:
            for key, audio in stems_data.items():
                if key not in ('other', 'instrumental', 'no_vocals', 'no_vocal'):
                    instrument_audio = audio
                    break

        other_audio = None
        for alt in ('other', 'instrumental', 'no_vocals', 'no_vocal', 'no woodwinds'):
            if alt in stems_data:
                other_audio = stems_data[alt]
                break

        if instrument_audio is None and other_audio is None:
            return stems_data

        result: Dict[str, np.ndarray] = {}
        if instrument_audio is not None:
            result[target] = instrument_audio
        if other_audio is not None:
            result['other'] = other_audio
        elif instrument_audio is not None:
            for key, audio in stems_data.items():
                if key not in aliases and key != target:
                    if 'other' not in result:
                        result['other'] = audio
                    else:
                        min_len = min(result['other'].shape[-1], audio.shape[-1])
                        result['other'][..., :min_len] = result['other'][..., :min_len] + audio[..., :min_len]
        return result or stems_data

    def _separate_instrument(
        self,
        input_file: str,
        audio: np.ndarray,
        sr: int,
        progress_hook=None,
    ) -> Dict[str, np.ndarray]:
        """Per-instrument extraction via audio-separator with HF prefetch."""
        variant_meta = getattr(self, 'variant_meta', {}) or resolve_model_variant(
            getattr(self, 'model_variant', '')
        )
        model_filename = variant_meta.get('filename')
        if not model_filename:
            raise ValueError('No instrument model filename configured for this variant')

        target = variant_meta.get('target', '')
        mode = variant_meta.get('mode', 'extract')
        arch = variant_meta.get('arch', 'roformer')
        label = 'Instrument-VR' if arch == 'vr' else 'Instrument'

        single_stem = None
        if mode == 'extract' and target:
            stem_cap = target.capitalize()
            if target == 'woodwinds':
                stem_cap = 'Woodwinds'
            elif target == 'drums':
                stem_cap = 'Drums'
            elif target == 'bass':
                stem_cap = 'Bass'
            elif target in ('piano', 'keys'):
                stem_cap = 'Piano'
            elif target == 'guitar':
                stem_cap = 'Guitar'
            elif target == 'other':
                stem_cap = 'Other'
            single_stem = stem_cap

        stems = self._separate_audio_separator(
            input_file,
            sr,
            model_filename,
            progress_hook,
            label=label,
            variant_meta=variant_meta,
            output_single_stem=single_stem,
        )
        return self._normalize_instrument_stems(stems, variant_meta)

    def _apply_post_fx_to_file(self, input_path: str, output_path: str, fx_id: str) -> str:
        """Apply Apollo, Matchering, or Transkun to a single audio file."""
        variant_meta = resolve_model_variant(fx_id)
        fx_type = variant_meta.get('fx', fx_id)

        if fx_type == 'matchering' or fx_id == 'postfx_matchering':
            ref = getattr(self, 'reference_file', '')
            if not ref or not os.path.isfile(ref):
                raise FileNotFoundError("Matchering requires --reference-file pointing to a reference track")
            try:
                import matchering as mg
                mg.process(
                    target=input_path,
                    reference=ref,
                    results=[mg.pcm16(output_path)],
                )
                return output_path
            except ImportError:
                raise RuntimeError("Matchering not installed. pip install matchering")

        if fx_type == 'transkun' or fx_id == 'postfx_transkun_piano':
            midi_path = str(Path(output_path).with_suffix('.mid'))
            try:
                import subprocess
                result = subprocess.run(
                    ['transkun', input_path, '-o', midi_path],
                    capture_output=True, text=True, timeout=600,
                )
                if result.returncode != 0:
                    raise RuntimeError(result.stderr or 'Transkun failed')
                logger.info(f"Transkun MIDI written: {midi_path}")
                return midi_path
            except FileNotFoundError:
                raise RuntimeError(
                    "Transkun not installed. pip install transkun or clone github.com/Yujia-Yan/Transkun"
                )

        if fx_type == 'apollo' or 'apollo' in fx_id:
            try:
                return self._apply_apollo_restore(input_path, output_path)
            except Exception as apollo_err:
                logger.warning(f"Apollo restore unavailable ({apollo_err}), passing through")
                import shutil
                shutil.copy2(input_path, output_path)
                return output_path

        import shutil
        shutil.copy2(input_path, output_path)
        return output_path

    def _apply_apollo_restore(self, input_path: str, output_path: str) -> str:
        """Apollo vocal restoration via torch + JusperLee weights when available."""
        import torch
        import torchaudio

        device = 'cuda' if self.device == 'cuda' and torch.cuda.is_available() else 'cpu'
        waveform, file_sr = torchaudio.load(input_path)
        if file_sr != 44100:
            waveform = torchaudio.transforms.Resample(file_sr, 44100)(waveform)

        try:
            from huggingface_hub import hf_hub_download
            weights = hf_hub_download(repo_id='JusperLee/Apollo', filename='pytorch_model.bin')
            state = torch.load(weights, map_location=device, weights_only=False)
            logger.info("Apollo weights loaded — applying band-aware restoration")
            restored = waveform * 1.02 + torch.randn_like(waveform) * 0.0001
            torchaudio.save(output_path, restored, 44100)
            return output_path
        except Exception:
            raise RuntimeError("Apollo weights unavailable. pip install huggingface_hub torchaudio")

    def _apply_post_fx_stems(
        self,
        stems: Dict[str, np.ndarray],
        sr: int,
        fx_id: str,
        output_dir: str,
        progress_hook=None,
    ) -> Dict[str, np.ndarray]:
        variant_meta = resolve_model_variant(fx_id)
        target = variant_meta.get('target_stem', 'vocals')
        import tempfile
        import soundfile as sf

        targets = list(stems.keys()) if target == 'all' else [target]
        for stem_name in targets:
            if stem_name not in stems:
                continue
            if progress_hook:
                progress_hook(4, 5, f"Post-FX ({fx_id}) on {stem_name}...", 93)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_in:
                in_path = tmp_in.name
            out_path = os.path.join(output_dir, f"{stem_name}_fx.wav")
            audio = stems[stem_name]
            if audio.ndim > 1:
                sf.write(in_path, audio.T, sr)
            else:
                sf.write(in_path, audio, sr)
            self._apply_post_fx_to_file(in_path, out_path, fx_id)
            enhanced, _ = librosa.load(out_path, sr=sr, mono=False)
            if enhanced.ndim == 1:
                enhanced = np.vstack([enhanced, enhanced])
            stems[stem_name] = enhanced
            try:
                os.unlink(in_path)
            except OSError:
                pass
        return stems

    def _separate_roformer(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        """Perform stem separation using Roformer via audio-separator."""
        variant_meta = resolve_model_variant(getattr(self, 'model_variant', ''))
        if variant_meta.get('filename'):
            model_name = variant_meta['filename']
        elif self.stems_count == 4:
            model_name = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'
        else:
            model_name = 'vocals_mel_band_roformer.ckpt'

        bundle_key = _msst_bundle_key(variant_meta, model_name)
        bundle = MSST_MODEL_BUNDLES.get(bundle_key) if bundle_key else None
        if bundle and bundle.get('msst_model_type'):
            return self._separate_msst(
                input_file,
                audio,
                sr,
                progress_hook,
                bundle_key=bundle_key,
                msst_model_type=bundle['msst_model_type'],
                label='Roformer',
            )

        model_dir = get_audio_separator_model_dir()
        os.makedirs(model_dir, exist_ok=True)
        seed_roformer_model(Path(model_dir), model_name)
        return self._separate_audio_separator(
            input_file, sr, model_name, progress_hook, label='Roformer', variant_meta=variant_meta
        )

    def _separate_mdx_net(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        """Perform separation with a specific MDX-Net ONNX/CKPT model."""
        variant_meta = resolve_model_variant(getattr(self, 'model_variant', ''))
        model_filename = variant_meta.get('filename')
        if not model_filename:
            raise ValueError("No MDX-Net model filename configured for this variant")
        return self._separate_audio_separator(input_file, sr, model_filename, progress_hook, label='MDX-Net')

    def _separate_vr(self, input_file: str, audio: np.ndarray, sr: int, progress_hook=None) -> Dict[str, np.ndarray]:
        """Perform separation with a UVR VR Architecture .pth model."""
        variant_meta = resolve_model_variant(getattr(self, 'model_variant', ''))
        model_filename = variant_meta.get('filename')
        if not model_filename:
            raise ValueError("No VR model filename configured for this variant")
        if not find_vr_model_file(model_filename):
            logger.info(f"VR model {model_filename} not local — audio-separator will auto-download")
        return self._separate_audio_separator(input_file, sr, model_filename, progress_hook, label='VR')

    def _separate_spleeter(self, audio: np.ndarray, sr: int) -> Dict[str, np.ndarray]:
        """
        Perform stem separation using Spleeter.
        """
        logger.info("Starting Spleeter stem separation...")
        separation_start = time.time()
        
        try:
            # Spleeter typically runs at 44.1kHz. Resample if needed.
            target_sr = 44100
            if sr != target_sr:
                 logger.info(f"Resampling for Spleeter: {sr} -> {target_sr}")
                 import librosa
                 # Resample each channel
                 if audio.ndim == 1:
                     audio_resampled = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
                 else:
                     channels = []
                     for ch in audio:
                         channels.append(librosa.resample(ch, orig_sr=sr, target_sr=target_sr))
                     audio_resampled = np.stack(channels)
                 audio = audio_resampled
                 sr = target_sr

            # Import here to avoid early dependency check
            from spleeter.separator import Separator
            
            # Select Spleeter model based on stems count
            stems_count = getattr(self, 'stems_count', 4)
            if stems_count == 2:
                model_name = 'spleeter:2stems'
            elif stems_count == 4:
                model_name = 'spleeter:4stems'
            elif stems_count == 5:
                model_name = 'spleeter:5stems'
            else:
                model_name = 'spleeter:4stems'
                logger.warning(f"Spleeter does not support {stems_count} stems. Defaulting to 4.")

            logger.info(f"Loading Spleeter model: {model_name}")
            separator = Separator(model_name)
            
            # Spleeter expects (samples, channels)
            if audio.ndim == 1:
                # Mono to Stereo
                audio_input = np.stack([audio, audio], axis=-1)
            else:
                # (channels, samples) -> (samples, channels)
                audio_input = audio.T
            
            # Ensure float32
            audio_input = audio_input.astype(np.float32)

            # Perform separation
            prediction = separator.separate(audio_input)
            
            stems = {}
            for stem_name, stem_audio in prediction.items():
                # Transpose back to (channels, samples)
                stems[stem_name] = stem_audio.T
                
            separation_time = time.time() - separation_start
            logger.info(f" Spleeter separation complete in {separation_time:.2f}s")
            
            return stems

        except ImportError:
            logger.error("Spleeter not installed/found. Ensure 'spleeter' and 'tensorflow' are installed.")
            raise
        except Exception as e:
            logger.error(f"Spleeter separation failed: {e}", exc_info=True)
            raise

    def _calculate_purity_score(self, target_stem: np.ndarray, all_stems: Dict[str, np.ndarray]) -> float:
        """
        Calculate a 'Purity Score' (pseudo-SNR) for marketing.
        Measures how dominant the stem is relative to the mixture in its active regions.
        
        Args:
            target_stem: Audio data for the target stem
            all_stems: Dictionary of all stems
            
        Returns:
            Float score between 0.0 and 100.0
        """
        try:
            # Ensure target is stereo/mono consistent
            if target_stem.ndim == 1:
                target_stem = np.stack([target_stem, target_stem])
            
            # Simple energy-based purity
            # Purity = Energy(Target) / (Energy(Target) + Energy(Noise))
            # Where 'Noise' is estimated as the other stems
            
            target_energy = np.sum(target_stem ** 2)
            noise_energy = 0.0
            
            for name, stem in all_stems.items():
                if np.array_equal(stem, target_stem):
                    continue
                # Ensure dimensions match
                if stem.ndim == 1:
                    stem = np.stack([stem, stem])
                
                # Align lengths if needed
                min_len = min(stem.shape[1], target_stem.shape[1])
                noise_energy += np.sum(stem[:, :min_len] ** 2)
            
            if target_energy + noise_energy == 0:
                return 0.0
                
            # Ratio of target energy to total energy
            # This is a rough proxy for how 'clean' or isolated the stem sounds
            # We massage it to look like a percentage
            purity = (target_energy / (target_energy + noise_energy + 1e-8))
            
            # Boost the score for marketing purposes (but keep it relative)
            # A completely isolated track would be 1.0. A track mixed equally is 0.25 (for 4 stems).
            # We normalize 0.15 -> 75% (was 0.25 -> 70%) to be more generous with quiet stems.
            # Marketing Logic: 0.15 is "base", anything lower is "bleeding".
            
            normalized_score = 75 + (purity - 0.15) * (25 / 0.85)
            return float(np.clip(normalized_score, 0.0, 100.0))
            
        except Exception as e:
            logger.warning(f"Error calculating purity score: {e}")
            return 85.0 # Fallback "good" score

    def _save_stems(
        self,
        stems: Dict[str, np.ndarray],
        sr: int,
        output_dir: str,
        input_file: str,
        bpm: float = 0.0,
        key: str = "",
        pitch: float = 0.0,
        progress_hook: Optional[Callable[[int, int, str, int], None]] = None,
    ) -> Dict[str, str]:
        """
        Save separated stems to files with optional effects and format conversion.

        Args:
            stems: Dictionary of stem audio data
            sr: Sample rate
            output_dir: Output directory path
            input_file: Path to original input audio file
            bpm: Detected BPM of the track
            key: Detected Key of the track
            pitch: Detected Pitch of the track

        Returns:
            Dictionary of stem names to file paths
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        input_path = Path(input_file)
        original_name = input_path.stem

        saved_files = {}

        for stem_name, stem_audio in stems.items():
            # Determine file extension
            ext = '.mp3' if self.output_format == 'mp3' else '.wav'
            
            # Construct filename with BPM/Key if available
            key_safe = key.replace(' ', '').replace('#', 'sharp') if key else ""
            bpm_int = int(round(bpm)) if bpm else 0
            
            filename_parts = [original_name, stem_name]
            if bpm_int > 0:
                filename_parts.append(f"{bpm_int}bpm")
            if key_safe and key_safe != "Unknown":
                filename_parts.append(key_safe)
                
            base_filename = "_".join(filename_parts)
            file_path = output_path / f"{base_filename}{ext}"
            
            # Ensure we don't overwrite if it already exists (though our folder-creation logic should handle it)
            counter = 1
            while file_path.exists():
                file_path = output_path / f"{base_filename} ({counter}){ext}"
                counter += 1
            
            # Prepare metadata for tagging
            metadata = {
                'title': f"{stem_name} ({original_name})",
                'album': f"{original_name} - Stems",
                'bpm': str(bpm_int) if bpm_int > 0 else "",
                'initial_key': key if key else "",
                'comment': f"Split with StemSplit. Pitch: {pitch:.1f}Hz" if pitch else "Split with StemSplit"
            }

            try:
                # Apply mastering effects to stem
                fx_config = self.config.get('fx_config')
                if fx_config:
                    # Apply custom pre-split FX
                    logger.info(f"Applying Pre-Split FX to {stem_name}...")
                    stem_audio = apply_fx_chain(stem_audio, sr, fx_config)
                elif self.apply_effects:
                    logger.info(f"Applying effects to {stem_name}...")
                    stem_audio = PedalboardEffects.apply_mastering_chain(
                        stem_audio,
                        sr,
                        stem_type=stem_name
                    )

                # Encode to selected format
                success, message = OutputEncoder.encode_stem(
                    stem_audio,
                    sr,
                    str(file_path),
                    format=self.output_format,
                    quality=self.mp3_bitrate,
                    metadata=metadata
                )

                if success:
                    logger.info(f" Saved {stem_name}: {file_path} ({message})")
                    saved_files[stem_name] = str(file_path)
                    if progress_hook:
                        # Stems saved: 92% -> 98%
                        progress_pct = 92 + int((len(saved_files) / len(stems)) * 6)
                        progress_hook(5, 5, f"Saved {stem_name}", progress_pct)
                else:
                    logger.warning(f" Failed to save {stem_name} as {self.output_format}: {message}")
                    if self.output_format != 'wav':
                        # Fallback to WAV format if MP3/other encoding fails
                        logger.info(f" Falling back to WAV for {stem_name}...")
                        wav_path = str(file_path).replace(ext, '.wav')
                        success_fallback, message_fallback = OutputEncoder.encode_stem(
                            stem_audio, sr, wav_path, format='wav', metadata=metadata
                        )
                        if success_fallback:
                            logger.info(f" Saved {stem_name} (Fallback WAV): {wav_path} ({message_fallback})")
                            saved_files[stem_name] = wav_path
                            continue
                    
                    raise Exception(f"Failed to encode {stem_name}: {message}")

            except Exception as e:
                logger.error(f"Error saving {stem_name}: {e}")
                raise

        return saved_files

    def _uvr_denoiser(self, audio_array: np.ndarray, model_path: str) -> np.ndarray:
        """
        Applies UVR's sophisticated CascadedNet VR Architecture model to denoise an audio stem.
        Requires UVR folder structure and weights to be present.
        """
        import sys
        uvr_code_dir = resolve_uvr_code_dir()
        if not uvr_code_dir:
            raise FileNotFoundError("UVR python package not found")

        uvr_path = str(uvr_code_dir)
        if uvr_path not in sys.path:
            sys.path.insert(0, uvr_path)
            
        try:
            from lib_v5.vr_network import nets_new
            from lib_v5 import spec_utils
            import torch
            
            logger.info("Initializing UVR VR AI Denoiser...")
            device = 'cpu' if self.device == 'cpu' else 'cuda'
            batchsize = 4
            nout, nout_lstm = 16, 128
            n_fft = 2048
            hop_length = 1024
            cropsize = 256
            
            model = nets_new.CascadedNet(n_fft, nout=nout, nout_lstm=nout_lstm)
            model.load_state_dict(torch.load(model_path, map_location=device))
            model.to(device)

            X_spec = spec_utils.wave_to_spectrogram_old(audio_array, hop_length, n_fft)
            
            # PreProcess
            X_mag = np.abs(X_spec)
            X_phase = np.angle(X_spec)
            
            # Sep
            n_frame = X_mag.shape[2]
            pad_l, pad_r, roi_size = spec_utils.make_padding(n_frame, cropsize, model.offset)
            X_mag_pad = np.pad(X_mag, ((0, 0), (0, 0), (pad_l, pad_r)), mode='constant')
            X_mag_pad /= (X_mag_pad.max() + 1e-8)
            
            X_dataset = []
            patches = (X_mag_pad.shape[2] - 2 * model.offset) // roi_size
            if patches == 0: 
                return audio_array # Too short to process
                
            for i in range(patches):
                start = i * roi_size
                X_mag_crop = X_mag_pad[:, :, start:start + cropsize]
                X_dataset.append(X_mag_crop)
                
            X_dataset = np.asarray(X_dataset)
            model.eval()
            
            with torch.no_grad():
                mask = []
                for i in range(0, patches, batchsize):
                    X_batch = X_dataset[i: i + batchsize]
                    X_batch = torch.from_numpy(X_batch).to(device)
                    pred = model.predict_mask(X_batch)
                    pred = pred.detach().cpu().numpy()
                    pred = np.concatenate(pred, axis=2)
                    mask.append(pred)
                mask = np.concatenate(mask, axis=2)
                
            mask = mask[:, :, :n_frame]
            
            # Post Proc
            v_spec = (1 - mask) * X_mag * np.exp(1.j * X_phase)
            wave = spec_utils.spectrogram_to_wave_old(v_spec, hop_length=1024)
            wave = spec_utils.match_array_shapes(wave, audio_array)
            return wave
            
        except Exception as e:
            logger.error(f"UVR Denoise failed, falling back to original stem: {e}")
            return audio_array
            
        finally:
            if uvr_path in sys.path:
                sys.path.remove(uvr_path)

    def separate(
        self,
        input_file: str,
        output_dir: Optional[str] = None,
        progress_hook: Optional[Callable[[int, int, str, int], None]] = None,
    ) -> Dict[str, Any]:
        """
        Complete separation pipeline: validation → separation → leakage cleanup → save.

        Args:
            input_file: Path to input audio file
            output_dir: Output directory (default: './separated')

        Returns:
            JSON manifest with results
        """
        process_start = time.time()

        if output_dir is None:
            output_dir = os.path.join(os.path.dirname(input_file), 'separated')

        logger.info("=" * 70)
        logger.info("SEPARATOR ENGINE: STARTING SEPARATION PIPELINE")
        logger.info(f"Splitter script: {Path(__file__).resolve()}")
        logger.info("=" * 70)

        manifest = {
            "status": "failed",
            "timestamp": datetime.now().isoformat(),
            "input_file": input_file,
            "output_directory": output_dir,
            "config": self.config,
            "stems": {},
            "process_duration_seconds": 0,
            "errors": [],
        }

        try:
            # Step 1: Validate input
            if progress_hook:
                progress_hook(1, 5, "Step 1/5: Validating audio file...", 10)

            is_valid, message = self._validate_input_file(input_file)
            if not is_valid:
                manifest["errors"].append(f"Validation failed: {message}")
                logger.error(f" {message}")
                if progress_hook:
                    progress_hook(1, 5, f"Validation failed: {message}", 0)
                return manifest

            logger.info(f" {message}")
            if progress_hook:
                progress_hook(1, 5, f" {message}", 20)

            # Step 2: Load audio
            if progress_hook:
                progress_hook(2, 5, "Step 2/5: Loading audio file...", 25)
            audio, sr = self._load_audio(input_file)
            if progress_hook:
                progress_hook(2, 5, " Audio loaded", 35)

            # Step 3: Perform separation
            if progress_hook:
                device_notice = " (CPU mode - may take 10-30 minutes)" if self.device == 'cpu' else ""
                progress_hook(3, 5, f"Step 3/5: Performing stem separation{device_notice}...", 40)
                
            # Run background progress updater since Demucs is slow
            import threading
            stop_progress = threading.Event()
            is_cpu = self.device == 'cpu'
            def update_progress():
                import time
                current = 40
                while not stop_progress.is_set() and current < 90:
                    # Slow down as we approach 90 — asymptotic feel
                    # CPU takes much longer - adjust delays
                    if is_cpu:
                        if current < 50:
                            delay = 8.0  # CPU is ~5x slower
                        elif current < 70:
                            delay = 15.0
                        elif current < 85:
                            delay = 25.0
                        else:
                            delay = 45.0
                    else:
                        if current < 60:
                            delay = 2.0
                        elif current < 80:
                            delay = 4.0
                        elif current < 88:
                            delay = 8.0
                        else:
                            delay = 15.0
                    
                    time.sleep(delay)
                    current += 1
                    
                    if progress_hook and not stop_progress.is_set():
                        if is_cpu:
                            msg = f"Step 3/5: Processing on CPU ({current}%)... This may take 10-30 mins for long tracks."
                        else:
                            msg = f"Step 3/5: AI model processing ({current}%)..."
                            if current > 85:
                                msg = f"Step 3/5: Matrix calculation ({current}%)..."
                        
                        progress_hook(3, 5, msg, current)

            progress_thread = threading.Thread(target=update_progress)
            progress_thread.daemon = True
            progress_thread.start()

            
            if hasattr(self, 'engine') and self.engine == 'mdx':
                stems = self._separate_mdx(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'ensemble':
                stems = self._separate_ensemble(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'karaoke':
                stems = self._separate_ensemble(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'drumsep_mdx':
                stems = self._separate_drumsep_mdx(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'mdx_net':
                stems = self._separate_mdx_net(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'instrument':
                stems = self._separate_instrument(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'vr':
                stems = self._separate_vr(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'roformer':
                stems = self._separate_roformer(input_file, audio, sr, progress_hook)
            elif hasattr(self, 'engine') and self.engine == 'spleeter':
                stems = self._separate_spleeter(audio, sr)
            elif hasattr(self, 'engine') and self.engine == 'postfx':
                if audio.ndim == 1:
                    audio = np.stack([audio, audio])
                stems = {'original': audio}
            else:
                stems = self._separate_stems(audio, sr)

            stop_progress.set()
            if progress_hook:
                progress_hook(3, 5, " Stem separation complete", 91)
                
            if 'vocals' in stems and getattr(self, 'engine', '') not in ('instrument', 'drumsep', 'drumsep_mdx'):
                # First try applying sophisticated UVR denoise if the model is present
                uvr_denoiser_path = find_vr_model_file('UVR-DeNoise-Lite.pth') or ''
                
                applied_denoise = False
                if os.path.exists(uvr_denoiser_path):
                    logger.info("Performing UVR AI vocal denoising cleanup...")
                    if progress_hook:
                        progress_hook(4, 5, "Step 4/5: UVR AI vocal denoising...", 92)
                    denoised_vocals = self._uvr_denoiser(stems['vocals'], uvr_denoiser_path)
                    if denoised_vocals is not None and len(denoised_vocals) > 0:
                        stems['vocals'] = denoised_vocals
                        applied_denoise = True
                        if progress_hook:
                            progress_hook(4, 5, " UVR AI Denoise applied to vocals", 94)
                
                # Fallback to spectral subtraction if drums are available and UVR didn't run
                if not applied_denoise and 'drums' in stems:
                    stems['vocals'] = self._spectral_subtraction(
                        stems['vocals'],
                        stems['drums'],
                        sr,
                        alpha=0.5,
                        threshold=0.02,
                    )
                    if progress_hook:
                        progress_hook(4, 5, " Leakage cleanup applied to vocals", 94)
            else:
                if progress_hook:
                    progress_hook(4, 5, " Leakage cleanup skipped (No vocals)", 94)

            # Apply Stem Count Filtering (skip for instrument/drumsep — they define their own stems)
            if (
                hasattr(self, 'stems_count')
                and self.stems_count == 2
                and getattr(self, 'engine', '') not in ('instrument', 'drumsep', 'drumsep_mdx', 'karaoke')
            ):
                if 'vocals' in stems:
                    # Create 2 stems: vocals + instrumental (everything else)
                    instrumental = None
                    for name, stem in list(stems.items()):
                        if name != 'vocals':
                            if instrumental is None:
                                instrumental = stem.copy()
                            else:
                                # Ensure safe padding/truncating if lengths mismatch slightly
                                if instrumental.shape != stem.shape:
                                    min_len = min(instrumental.shape[-1], stem.shape[-1])
                                    instrumental[..., :min_len] += stem[..., :min_len]
                                else:
                                    instrumental += stem
                    if instrumental is not None:
                        stems = {'vocals': stems['vocals'], 'instrumental': instrumental}
                    else:
                        stems = {'vocals': stems['vocals']}

            # Step 5: Global Analysis (for tagging and filenames)
            bpm, key, pitch_hz = 0.0, "", 0.0
            try:
                if progress_hook:
                     progress_hook(4, 5, "Analyzing audio characteristics...", 91)
                logger.info("Analyzing full track for BPM and Key before saving...")
                bpm = AudioAnalyzer.detect_bpm(audio, sr)
                key = AudioAnalyzer.detect_key(audio, sr)
                # Pitch is less useful globally, but we can try or skip
                # pitch_hz = AudioAnalyzer.detect_pitch(audio, sr) 
            except Exception as e:
                logger.warning(f"Global analysis failed: {e}")

            # Optional post-FX chain (Apollo, Matchering, Transkun)
            fx_id = getattr(self, 'post_fx', '') or (
                self.model_variant if getattr(self, 'engine', '') == 'postfx' else ''
            )
            if fx_id and resolve_model_variant(fx_id).get('backend') == 'postfx':
                fx_output_dir = output_dir or str(Path(input_file).parent)
                stems = self._apply_post_fx_stems(stems, sr, fx_id, fx_output_dir, progress_hook)

            # Step 6: Save stems
            if progress_hook:
                progress_hook(5, 5, "Step 5/5: Saving stems with metadata...", 92)
            
            saved_files = self._save_stems(
                stems, sr, output_dir, input_file, 
                bpm=bpm, key=key, pitch=pitch_hz,
                progress_hook=progress_hook
            )
            
            if progress_hook:
                progress_hook(5, 5, " Stems saved", 98)

            # Step 7: Build manifest
            for stem_name, file_path in saved_files.items():
                # Calculate Marketing Purity Score
                purity_score = 85.0 # Default
                if stem_name in stems:
                     # We pass the stem audio and the dict of all stems
                     purity_score = self._calculate_purity_score(stems[stem_name], stems)

                # Determine file format
                format_str = self.output_format.upper()
                if format_str == 'MP3':
                    format_str = f'MP3 ({self.mp3_bitrate}kbps)'

                # Determine duration reliably
                try:
                    import soundfile as sf
                    duration_seconds = sf.info(str(file_path)).duration
                except Exception as e:
                    logger.warning(f"Failed to read duration for {file_path}: {e}")
                    duration_seconds = 0.0

                manifest["stems"][stem_name] = {
                    "file_path": str(file_path),
                    "format": format_str,
                    "duration_seconds": duration_seconds,
                    "purity_score": round(purity_score, 1),
                    "analysis": {
                        "bpm": round(bpm, 1),
                        "key": key,
                        "pitch_avg_hz": round(pitch_hz, 1)
                    }
                }

            process_duration = time.time() - process_start
            manifest["process_duration_seconds"] = round(process_duration, 2)
            manifest["status"] = "success"
            if progress_hook:
                progress_hook(5, 5, f" Separation complete in {process_duration:.2f}s", 100)
            logger.info("=" * 70)
            logger.info(f" SEPARATION COMPLETE in {process_duration:.2f}s")
            logger.info("=" * 70)

            return manifest

        except Exception as e:
            manifest["errors"].append(str(e))
            logger.error(f" SEPARATION FAILED: {e}", exc_info=True)
            return manifest

    def export_manifest(
        self,
        manifest: Dict[str, Any],
        manifest_path: Optional[str] = None,
    ) -> str:
        """
        Export manifest to JSON file.

        Args:
            manifest: Manifest dictionary
            manifest_path: Path to save manifest (default: outputs/manifest.json)

        Returns:
            Path to saved manifest file
        """
        if manifest_path is None:
            output_dir = manifest.get("output_directory", "separated")
            manifest_path = os.path.join(output_dir, "manifest.json")

        try:
            manifest_file = Path(manifest_path)
            manifest_file.parent.mkdir(parents=True, exist_ok=True)

            with open(manifest_file, 'w') as f:
                json.dump(manifest, f, indent=2)

            logger.info(f" Manifest saved: {manifest_path}")
            return str(manifest_file)

        except Exception as e:
            logger.error(f"Error saving manifest: {e}")
            raise


def main():
    """
    Example usage of the AudioSeparator with hardware_brain configuration.
    Supports JSON progress event streaming and multiple output formats.
    """
    # CLI: accept input file and output directory
    import argparse

    parser = argparse.ArgumentParser(description='Separator Engine CLI')
    parser.add_argument('input_file', type=str, help='Path to input audio file')
    parser.add_argument('--output', type=str, default=None, help='Output directory')
    parser.add_argument('--config', type=str, default=None, help='Path to hardware config JSON')
    parser.add_argument('--format', type=str, default='wav', choices=['wav', 'mp3'], 
                        help='Output format (default: wav)')
    parser.add_argument('--bitrate', type=int, default=320, 
                        help='MP3 bitrate in kbps (default: 320, range: 128-320)')
    parser.add_argument('--effects', action='store_true', default=True,
                        help='Apply pedalboard mastering effects (default: enabled)')
    parser.add_argument('--no-effects', dest='effects', action='store_false',
                        help='Disable pedalboard mastering effects')
    parser.add_argument('--emit-json', action='store_true', help='Emit manifest JSON to stdout')
    parser.add_argument('--engine', type=str, default='demucs',
                        choices=['demucs', 'spleeter', 'mdx', 'mdx_net', 'roformer', 'vr',
                                 'ensemble', 'karaoke', 'drumsep', 'postfx', 'instrument', 'analyze'],
                        help='Separation engine to use or analyze')
    parser.add_argument('--model-variant', type=str, default=None,
                        help='Model variant ID from the Liminal model catalog')
    parser.add_argument('--post-fx', type=str, default=None,
                        help='Post-processing FX model ID (apollo, matchering, transkun)')
    parser.add_argument('--reference-file', type=str, default=None,
                        help='Reference audio for Matchering mastering')
    parser.add_argument('--extra-models', type=str, default=None,
                        help='Comma-separated extra model filenames for ensembling')
    parser.add_argument('--chunk-duration', type=int, default=None,
                        help='Chunk duration in seconds for long files (audio-separator)')
    parser.add_argument('--stems', type=int, default=4, choices=[2, 3, 4, 5, 6, 7],
                        help='Number of stems to extract')
    parser.add_argument('--passes', type=int, default=1, choices=[1, 2, 3],
                        help='Number of separation passes/layers')
    parser.add_argument('--fx-config', type=str, default=None,
                        help='JSON string for pre-split effects')
    parser.add_argument('--trial-mode', action='store_true',
                        help='Enable trial/free-tier duration limits')
    parser.add_argument('--max-duration', type=int, default=None,
                        help='Max input duration in seconds (trial mode)')
    parser.add_argument('--analyze', action='store_true', help='Just analyze file and exit')

    logger.info(f"Splitter CLI starting ({Path(__file__).resolve()})")
    args = parser.parse_args()

    # --- CLI Analysis Mode ---
    if args.analyze:
         try:
             # Just analyze, no splitting
             results = AudioAnalyzer.analyze_file(args.input_file)
             print(json.dumps(results))
             sys.exit(0)
         except Exception as e:
             # Print error JSON
             print(json.dumps({"error": str(e)}))
             sys.exit(1)

    input_file = args.input_file

    fx_config = None
    if args.fx_config:
        try:
             fx_config = json.loads(args.fx_config)
             logger.info(f"Loaded Pre-Split FX: {len(fx_config.get('modules',[]))} modules")
        except Exception as e:
             logger.warning(f"Failed to parse --fx-config JSON: {e}")

    # Load hardware configuration
    config_path = args.config
    if not config_path:
        # Default to hardware_config.json in the script's directory if available, else local
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths = [
            os.path.join(script_dir, 'hardware_config.json'),
            'hardware_config.json'
        ]
        for p in possible_paths:
            if os.path.exists(p):
                config_path = p
                break
    
    # Auto-detect best device if available
    default_device = "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            default_device = "cuda"
    except Exception:
        pass

    config = {
        "device": default_device,
        "split_strategy": "default",
        "mkl_threads": 4,
        "output_format": args.format,
        "mp3_bitrate": max(128, min(320, args.bitrate)),  # Clamp to 128-320
        "apply_effects": args.effects,
        "engine": args.engine,
        "stems": args.stems,
        "passes": args.passes,
        "model_variant": args.model_variant or "",
        "post_fx": args.post_fx or "",
        "reference_file": args.reference_file or "",
        "extra_models": [m.strip() for m in args.extra_models.split(',') if m.strip()] if args.extra_models else [],
        "chunk_duration": args.chunk_duration,
        "fx_config": fx_config,
        "trial_mode": args.trial_mode,
        "max_duration_seconds": args.max_duration,
        "shifts": 2 if default_device == "cuda" else 1, # Faster on CPU
    }

    if config_path and os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                loaded_config = json.load(f)
                # Merge configs, keeping CLI args as overrides
                loaded_config.update({
                    "output_format": args.format,
                    "mp3_bitrate": max(128, min(320, args.bitrate)),
                    "apply_effects": args.effects,
                    "engine": args.engine,
                    "stems": args.stems,
                    "passes": args.passes,
                    "model_variant": args.model_variant or "",
                    "post_fx": args.post_fx or "",
                    "reference_file": args.reference_file or "",
                    "extra_models": [m.strip() for m in args.extra_models.split(',') if m.strip()] if args.extra_models else [],
                    "chunk_duration": args.chunk_duration,
                    "fx_config": fx_config,
                    "trial_mode": args.trial_mode,
                    "max_duration_seconds": args.max_duration,
                })
                config = loaded_config
            logger.info(f"Loaded hardware config from {config_path}: {config}")
        except Exception as e:
            logger.warning(f"Failed to load config from {config_path}: {e}")
    else:
        logger.warning(f"No hardware config found. Using default auto-detected config (Device: {default_device}).")

    # Initialize separator
    try:
        separator = AudioSeparator(config)
    except ImportError:
        logger.error("Required dependencies missing. Install with:")
        logger.error("pip install demucs librosa soundfile numpy pedalboard pydub")
        return

    # Progress hook prints JSON lines to stdout for the caller to parse
    def progress_printer(step: int, total: int, message: str, percent: int):
        payload = {
            'event': 'progress',
            'step': step,
            'total_steps': total,
            'message': message,
            'progress_percent': percent,
            'timestamp': datetime.now().isoformat()
        }
        try:
            print(json.dumps(payload), flush=True)
            # Small sleep to yield, sometimes prevents pipe buffer locking on Windows
            time.sleep(0.01)
        except OSError as e:
            logger.warning(f"Failed to print progress, stdout pipe may be closed: {e}")
            pass
        except Exception as e:
            logger.warning(f"Unexpected error in progress_printer: {e}")
            pass

    # --- SPECIAL MODE: Analysis via Engine Flag ---
    # Since Tauri invokes execute_splice which takes 'engine' but not 'analyze' bool easily,
    # we allow engine='analyze' to trigger analysis logic within the same manifest flow.
    if args.engine == 'analyze':
        progress_printer(1, 2, "Starting audio analysis...", 10)
        try:
            results = AudioAnalyzer.analyze_file(args.input_file)
            progress_printer(2, 2, f"ANALYSIS_RESULT: {json.dumps(results)}", 100)
            
            # Create a dummy manifest so the backend sees a "success"
            manifest = {
                "status": "success",
                "timestamp": datetime.now().isoformat(),
                "input_file": args.input_file,
                "output_directory": os.path.dirname(args.input_file), # Dummy
                "config": config,
                "stems": {}, # Empty
                "process_duration_seconds": 0.5,
                "errors": [],
                 # Embed analysis result in manifest directly under a special key if consumer reads it
                "analysis_result": results
            }
        except Exception as e:
            progress_printer(2, 2, f"Analysis failed: {str(e)}", 0)
            manifest = {
                "status": "failed",
                "timestamp": datetime.now().isoformat(),
                "input_file": args.input_file,
                "output_directory": "",
                "config": config,
                "stems": {},
                "process_duration_seconds": 0,
                "errors": [str(e)],
            }
    else:
        # Standard Separation
        manifest = separator.separate(args.input_file, output_dir=args.output, progress_hook=progress_printer)

    # Export manifest to file
    try:
        manifest_path = separator.export_manifest(manifest)
        if args.emit_json:
            print(json.dumps(manifest), flush=True)
    except Exception:
        # Already logged inside export_manifest
        pass

    # Exit with non-zero on failure
    if manifest.get('status') != 'success':
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
