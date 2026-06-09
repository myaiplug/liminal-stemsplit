"""
Hardware Intelligence Module for Stem Splitting
Acts as a Senior Systems Architect component for optimal resource allocation and crash prevention.

This module detects system hardware capabilities and returns optimal processing configurations
for audio stem splitting based on available GPU/CPU resources.
"""

import json
import logging
from typing import Dict, Any, Optional
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _detect_torch_device() -> Optional[str]:
    """
    Detect if torch and CUDA are available.
    
    Returns:
        'cuda' if CUDA is available, None otherwise
    """
    try:
        import torch
        if torch.cuda.is_available():
            return 'cuda'
    except ImportError:
        logger.warning("PyTorch not installed. Falling back to CPU.")
    except Exception as e:
        logger.warning(f"Error detecting CUDA: {e}")
    
    return None


def _get_gpu_vram() -> float:
    """
    Get available GPU VRAM in GB.
    
    Returns:
        VRAM in GB if GPU detected, 0.0 otherwise
    """
    try:
        import pynvml
        
        try:
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            
            if device_count > 0:
                # Get first GPU info
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                vram_gb = mem_info.total / (1024 ** 3)
                
                logger.info(f"Detected GPU with {vram_gb:.2f}GB VRAM")
                return vram_gb
        except pynvml.NVMLError as e:
            logger.warning(f"NVIDIA GPU error: {e}. NVIDIA drivers may not be installed.")
        finally:
            try:
                pynvml.nvmlShutdown()
            except Exception:
                pass
                
    except ImportError:
        logger.warning("pynvml not installed. Cannot detect GPU VRAM.")
    except Exception as e:
        logger.warning(f"Unexpected error detecting GPU VRAM: {e}")
    
    return 0.0


def _get_cpu_core_count() -> int:
    """
    Get the number of CPU cores available.
    
    Returns:
        Number of CPU cores
    """
    try:
        import psutil
        return psutil.cpu_count(logical=True)
    except ImportError:
        logger.warning("psutil not installed. Using system default.")
        import multiprocessing
        return multiprocessing.cpu_count()
    except Exception as e:
        logger.warning(f"Error detecting CPU cores: {e}")
        import multiprocessing
        return multiprocessing.cpu_count()


def _configure_mkl_threads(cpu_cores: int) -> int:
    """
    Configure Intel MKL thread count based on available CPU cores.
    Uses 75% of available cores for optimal performance.
    
    Args:
        cpu_cores: Total number of available CPU cores
    
    Returns:
        Number of threads to use
    """
    mkl_threads = max(1, int(cpu_cores * 0.75))
    
    try:
        import os
        os.environ['MKL_NUM_THREADS'] = str(mkl_threads)
        os.environ['NUMEXPR_NUM_THREADS'] = str(mkl_threads)
        os.environ['OMP_NUM_THREADS'] = str(mkl_threads)
        logger.info(f"Configured MKL threads to {mkl_threads} (75% of {cpu_cores} cores)")
    except Exception as e:
        logger.warning(f"Error configuring MKL threads: {e}")
    
    return mkl_threads


def get_processing_config() -> Dict[str, Any]:
    """
    Detect system hardware and return optimal processing configuration.
    
    This function implements the following logic:
    - If NVIDIA GPU found and VRAM > 6GB: use CUDA with 'fast' strategy, 0.1 overlap
    - If NVIDIA GPU found and VRAM 2-6GB: use CUDA with 'segmented' strategy, 10s segments
    - If no GPU or VRAM < 2GB: use CPU with MKL threads at 75% of available cores
    
    Returns:
        Dict containing:
        - device: 'cuda' or 'cpu'
        - split_strategy: 'fast', 'segmented', or 'default'
        - overlap: float (for fast strategy)
        - segment_size: int (for segmented strategy, in seconds)
        - mkl_threads: int (for CPU mode)
        - cpu_cores: int (total available CPU cores)
        - gpu_vram: float (GPU VRAM in GB, 0.0 if no GPU)
        - status: str (human-readable status message)
    """
    
    logger.info("=" * 60)
    logger.info("Starting Hardware Detection")
    logger.info("=" * 60)
    
    config = {
        "device": "cpu",
        "split_strategy": "default",
        "overlap": 0.0,
        "segment_size": 0,
        "mkl_threads": 1,
        "cpu_cores": 0,
        "gpu_vram": 0.0,
        "status": "Initializing hardware detection..."
    }
    
    try:
        # Get CPU information
        cpu_cores = _get_cpu_core_count()
        config["cpu_cores"] = cpu_cores
        logger.info(f"Detected {cpu_cores} CPU cores")
        
        # Check for CUDA device
        cuda_device = _detect_torch_device()
        
        if cuda_device == 'cuda':
            # Get GPU VRAM
            gpu_vram = _get_gpu_vram()
            config["gpu_vram"] = gpu_vram
            
            if gpu_vram > 6.0:
                # High-end GPU: use fast strategy
                config["device"] = "cuda"
                config["split_strategy"] = "fast"
                config["overlap"] = 0.1
                config["status"] = f"High-end GPU detected ({gpu_vram:.2f}GB VRAM). Using CUDA fast strategy."
                logger.info(f"✓ High-end GPU configuration: CUDA, fast strategy, 0.1 overlap")
                
            elif 2.0 <= gpu_vram <= 6.0:
                # Mid-range GPU: use segmented strategy
                config["device"] = "cuda"
                config["split_strategy"] = "segmented"
                config["segment_size"] = 10
                config["status"] = f"Mid-range GPU detected ({gpu_vram:.2f}GB VRAM). Using CUDA segmented strategy."
                logger.info(f"✓ Mid-range GPU configuration: CUDA, segmented strategy, 10s segments")
                
            else:
                # Low VRAM: fallback to CPU
                config["device"] = "cpu"
                config["split_strategy"] = "default"
                mkl_threads = _configure_mkl_threads(cpu_cores)
                config["mkl_threads"] = mkl_threads
                config["status"] = f"GPU VRAM too low ({gpu_vram:.2f}GB). Falling back to CPU with {mkl_threads} threads."
                logger.info(f"✓ Low VRAM fallback: CPU mode with {mkl_threads} threads")
        else:
            # No CUDA: use CPU
            mkl_threads = _configure_mkl_threads(cpu_cores)
            config["device"] = "cpu"
            config["split_strategy"] = "default"
            config["mkl_threads"] = mkl_threads
            config["status"] = f"No CUDA device detected. Using CPU with {mkl_threads} MKL threads (75% of {cpu_cores} cores)."
            logger.info(f"✓ CPU configuration: {mkl_threads} MKL threads (75% of {cpu_cores} cores)")
        
        logger.info("=" * 60)
        logger.info("Hardware Detection Complete")
        logger.info("=" * 60)
        logger.info(f"Final Configuration:\n{json.dumps(config, indent=2)}")
        
    except Exception as e:
        logger.error(f"Critical error during hardware detection: {e}", exc_info=True)
        # Ensure we still return a valid default configuration
        mkl_threads = _configure_mkl_threads(cpu_cores)
        config["mkl_threads"] = mkl_threads
        config["status"] = f"Error during hardware detection. Falling back to safe CPU configuration: {str(e)}"
    
    return config


def validate_config(config: Dict[str, Any]) -> bool:
    """
    Validate the configuration object.
    
    Args:
        config: Configuration dictionary from get_processing_config()
    
    Returns:
        True if valid, False otherwise
    """
    required_keys = {"device", "split_strategy", "cpu_cores", "gpu_vram", "status"}
    
    if not isinstance(config, dict):
        logger.error("Configuration is not a dictionary")
        return False
    
    if not required_keys.issubset(config.keys()):
        logger.error(f"Missing required configuration keys: {required_keys - set(config.keys())}")
        return False
    
    if config["device"] not in ["cpu", "cuda"]:
        logger.error(f"Invalid device: {config['device']}")
        return False
    
    if config["split_strategy"] not in ["default", "fast", "segmented"]:
        logger.error(f"Invalid split_strategy: {config['split_strategy']}")
        return False
    
    return True


def export_config(config: Dict[str, Any], output_file: str = "hardware_config.json") -> bool:
    """
    Export configuration to a JSON file.
    
    Args:
        config: Configuration dictionary
        output_file: Path to output JSON file
    
    Returns:
        True if successful, False otherwise
    """
    try:
        with open(output_file, 'w') as f:
            json.dump(config, f, indent=2)
        logger.info(f"Configuration exported to {output_file}")
        return True
    except Exception as e:
        logger.error(f"Error exporting configuration: {e}")
        return False


if __name__ == "__main__":
    # Main execution
    try:
        # Configure logging to write to stderr so stdout is clean for JSON
        logging.getLogger().handlers = []
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            stream=sys.stderr
        )

        config = get_processing_config()
        
        # Validate configuration
        if validate_config(config):
            logger.info("✓ Configuration validation successful")
        else:
            logger.warning("⚠ Configuration validation failed")
        
        # Export configuration for use by other modules
        # Rust might use stdout, but we keep the file for Python-to-Python fallback
        export_config(config)
        
        # Print configuration as formatted JSON to STDOUT
        print(json.dumps(config, indent=2))
        
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        # Fallback JSON to ensure caller doesn't crash on empty stdout
        print(json.dumps({
            "device": "cpu",
            "error": str(e)
        }))
        sys.exit(1)
