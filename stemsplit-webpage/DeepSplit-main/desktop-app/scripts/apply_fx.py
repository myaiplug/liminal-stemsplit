#!/usr/bin/env python3
"""
apply_fx.py – Apply audio effects to a stem file using Pedalboard.
Supports both single FX (legacy) and multi-FX chains + VSTs.

Usage:
    python apply_fx.py <input_file> --fx <fx_json>

Json Format (New):
    {
        "modules": [
            { "id": "gate", "params": { "threshold": -40, ... } },
            ...
        ],
        "vsts": [ "path/to/plugin.vst3", ... ]
    }

Json Format (Legacy):
    { "id": "eq", "params": { ... } }
"""

import argparse
import json
import os
import sys
import base64
import numpy as np
import soundfile as sf
import logging

# Configure logging to stderr so stdout is clean for JSON result
logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[FX] %(message)s")
logger = logging.getLogger(__name__)

try:
    from pedalboard import (
        Pedalboard, 
        Compressor, 
        NoiseGate, 
        Limiter, 
        HighpassFilter, 
        LowpassFilter, 
        PeakFilter, 
        HighShelfFilter, 
        LowShelfFilter, 
        Reverb, 
        Delay, 
        Chorus,
        Phaser,
        PitchShift,
        Distortion, 
        Clipping, 
        Gain,
        load_plugin
    )
except ImportError:
    # If pedalboard is missing:
    if __name__ == '__main__':
        # If running as script, error and exit
        print(json.dumps({"status": "error", "message": "Pedalboard package not installed"}))
        sys.exit(1)
    else:
        # If imported, log warning but don't crash yet
        logger.warning("Pedalboard package not installed. Effects unavailable.")
        Pedalboard = None
        load_plugin = None


def add_module_to_board(board, fx_id, params):
    """Add a native Pedalboard effect based on ID and params."""
    try:
        # --- Dynamics ---
        if fx_id == "gate":
            logger.info(f"Adding Gate: {json.dumps(params, default=str)}")
            board.append(NoiseGate(
                threshold_db=float(params.get("threshold", -40)),
                ratio=float(params.get("ratio", 4)),
                attack_ms=float(params.get("attack", 2)),
                release_ms=float(params.get("release", 100))
            ))
        
        elif fx_id in ("compressor", "comp"):
            logger.info(f"Adding Compressor: {json.dumps(params, default=str)}")
            thresh = float(params.get("threshold", -20))
            ratio = float(params.get("ratio", 2.5))
            
            # --- Auto Makeup Gain (Pro Feature) ---
            # Estimate gain reduction at 0dB input: (Thresh - Thresh/Ratio)
            # e.g., -20 - (-20/4) = -20 - (-5) = -15dB reduction -> +15dB makeup
            auto_gain = 0.0
            if "makeup" not in params or float(params["makeup"]) <= 0:
                if thresh < 0 and ratio > 1:
                    gain_reduction = thresh * (1 - 1/ratio)
                    # Apply 70% of estimated reduction as conservative makeup
                    auto_gain = abs(gain_reduction) * 0.7 
            else:
                auto_gain = float(params["makeup"])

            board.append(Compressor(
                threshold_db=thresh,
                ratio=ratio,
                attack_ms=float(params.get("attack", 10)),
                release_ms=float(params.get("release", 100))
            ))

            if auto_gain > 0.5:
                # Add Limiter after gain to be safe
                logger.info(f"Adding Auto-Makeup Gain: {auto_gain:.2f}dB")
                board.append(Gain(gain_db=auto_gain))
                board.append(Limiter(threshold_db=-0.5))

        elif fx_id == "limiter":
            logger.info(f"Adding Limiter: {json.dumps(params, default=str)}")
            board.append(Limiter(threshold_db=float(params.get("threshold", -1))))

        # --- Restoration ---
        elif fx_id == "dereverb":
            logger.info(f"Adding De-Reverb: {json.dumps(params, default=str)}")
            # De-Reverb Simulation using gentle expansion (Gate)
            # Higher "amount" = Higher Ratio (more attenuation of tails)
            amount = float(params.get("amount", 40))
            ratio_val = 1.0 + (amount / 10.0) # 0% -> 1:1, 100% -> 11:1
            
            board.append(NoiseGate(
                threshold_db=float(params.get("threshold", -30)),
                ratio=ratio_val,
                attack_ms=10.0, # Slow attack to let transients through
                release_ms=float(params.get("release", 200)) # Long release to smooth tails
            ))

        elif fx_id == "deesser":
            logger.info(f"Adding De-Esser: {json.dumps(params, default=str)}")
            # Hybrid De-Esser: Static cut + Fast Compression
            thresh = float(params.get("threshold", -20))
            freq = float(params.get("frequency", 7000))
            
            # 1. Surgical Cut at sibilance freq (Static)
            board.append(PeakFilter(
                cutoff_frequency_hz=freq, 
                gain_db=-3.0, 
                q=3.0
            ))
            
            # 2. Fast Compressor to catch sibilant peaks
            board.append(Compressor(
                threshold_db=thresh,
                ratio=5.0,
                attack_ms=0.5, # Very fast
                release_ms=30.0 # Fast recovery
            ))

        # --- EQ & Filters ---
        elif fx_id == "eq":
            logger.info(f"Adding EQ: {json.dumps(params, default=str)}")
            low = float(params.get("low", 0))
            mid = float(params.get("mid", 0))
            high = float(params.get("high", 0))
            mid_freq = float(params.get("freq_mid", 1000))

            # Smart Curves (Pro Feature): 
            # If Low boost > 3dB, cut sub-bass rumble (<30Hz) to keep headroom
            if low > 3:
                board.append(HighpassFilter(cutoff_frequency_hz=30))
            
            if low != 0: board.append(LowShelfFilter(cutoff_frequency_hz=200, gain_db=low))
            if mid != 0: board.append(PeakFilter(cutoff_frequency_hz=mid_freq, gain_db=mid, q=1.0))
            if high != 0: board.append(HighShelfFilter(cutoff_frequency_hz=5000, gain_db=high))

            # "Air" band for subtle high-end sheen if High > 2dB
            if high > 2:
                board.append(HighShelfFilter(cutoff_frequency_hz=12000, gain_db=high * 0.25))

        elif fx_id == "highpass":
            logger.info(f"Adding Highpass Filter: {json.dumps(params, default=str)}")
            board.append(HighpassFilter(cutoff_frequency_hz=float(params.get("freq", 100))))

        elif fx_id == "lowpass":
            logger.info(f"Adding Lowpass Filter: {json.dumps(params, default=str)}")
            board.append(LowpassFilter(cutoff_frequency_hz=float(params.get("freq", 10000))))

        # --- Creative ---
        elif fx_id in ("saturation", "distortion"):
            logger.info(f"Adding Saturation/Distortion: {json.dumps(params, default=str)}")
            # Pro: Multi-Stage "Analog" Signal Path
            raw_drive = float(params.get("drive", 20))
            
            # Map input 0-100 to sensible dB
            drive_db = raw_drive * 0.35 

            if drive_db > 0:
                # 1. Pre-EQ Head Bump (Tape Simulation)
                board.append(PeakFilter(cutoff_frequency_hz=60, gain_db=2.0, q=0.5))

                # 2. Main Saturation
                board.append(Distortion(drive_db=drive_db))

                # 3. Soft Clip (Tube Stage)
                board.append(Clipping(threshold_db=-0.3))

                # 4. De-Fizz (Tape Roll-off)
                board.append(LowpassFilter(cutoff_frequency_hz=14000))

        elif fx_id == "reverb":
            logger.info(f"Adding Reverb: {json.dumps(params, default=str)}")
            # Normalize % to 0.0-1.0
            room_size = float(params.get("room_size", 50)) / 100.0
            damping = float(params.get("damping", 50)) / 100.0
            wet = float(params.get("mix", params.get("wet", 20))) / 100.0
            width = float(params.get("width", 100)) / 100.0
            
            # Abbey Road Trick Setup (Pro Feature):
            # We can't route parallel easily here, but we can shape the TAIL with damping
            # Increasing damping for larger room sizes keeps mix clean
            if room_size > 0.6:
                damping = max(damping, 0.6) 

            board.append(Reverb(
                room_size=room_size,
                damping=damping,
                wet_level=wet,
                dry_level=1.0 - wet * 0.5, # Keep dry signal stronger for clarity
                width=width,
                freeze_mode=0.0
            ))
            
            # Post-Reverb EQ (if wet > 30%): gently cut mud
            if wet > 0.3:
                 board.append(PeakFilter(cutoff_frequency_hz=300, gain_db=-2.0, q=0.5))

        elif fx_id == "delay":
            logger.info(f"Adding Delay: {json.dumps(params, default=str)}")
            time_ms = float(params.get("time", 250))
            feedback = float(params.get("feedback", 30)) / 100.0
            mix = float(params.get("mix", 30)) / 100.0
            
            # Simple Tape Delay simulation (Pro Feature)
            # Roll off feedback highs
            if feedback > 0.4:
                board.append(LowpassFilter(cutoff_frequency_hz=4000))
                
            board.append(Delay(
                delay_seconds=time_ms / 1000.0,
                feedback=feedback,
                mix=mix
            ))

        elif fx_id == "chorus":
            logger.info(f"Adding Chorus: {json.dumps(params, default=str)}")
            rate_hz = float(params.get("rate", 1.0))
            depth = float(params.get("depth", 0.25))
            mix = float(params.get("mix", 50)) / 100.0
            centre_delay_ms = float(params.get("delay", 7.0))
            feedback = float(params.get("feedback", 0.0))

            board.append(Chorus(
                rate_hz=rate_hz,
                depth=depth,
                centre_delay_ms=centre_delay_ms,
                feedback=feedback,
                mix=mix
            ))

        elif fx_id == "phaser":
            logger.info(f"Adding Phaser: {json.dumps(params, default=str)}")
            rate_hz = float(params.get("rate", 1.0))
            depth = float(params.get("depth", 0.5))
            mix = float(params.get("mix", 0.5))
            feedback = float(params.get("feedback", 0.5))
            
            board.append(Phaser(
                rate_hz=rate_hz,
                depth=depth,
                feedback=feedback,
                mix=mix,
                centre_frequency_hz=1300 # reasonable default
            ))

        elif fx_id == "pitch":
            logger.info(f"Adding Pitch Shift: {json.dumps(params, default=str)}")
            # Pitch is shifted in semitones
            semitones = float(params.get("semitones", 12)) 
            board.append(PitchShift(semitones=semitones))

        elif fx_id == "filter":
            logger.info(f"Adding Filter: {json.dumps(params, default=str)}")
            # Combined HP/LP dual knob filter
            hp_freq = float(params.get("hp", 0))
            lp_freq = float(params.get("lp", 20000))

            if hp_freq > 20: 
                board.append(HighpassFilter(cutoff_frequency_hz=hp_freq))
            if lp_freq < 19000:
                board.append(LowpassFilter(cutoff_frequency_hz=lp_freq))

        elif fx_id == "loudness": # Pro Maximizer (Gain + Limiter)
            gain_val = float(params.get("gain", 0))
            ceiling_val = float(params.get("ceiling", -0.1))
            
            logger.info(f"Adding Loudness (Maximizer): InputGain={gain_val}dB, Ceiling={ceiling_val}dB")

            # 1. Input Drive
            if gain_val != 0:
                board.append(Gain(gain_db=gain_val))
            
            # 2. Transparent Limiting using High-Ratio Compressor
            # (Standard Limiter in this version behaves unpredictably/auto-normalizes)
            board.append(Compressor(
                threshold_db=ceiling_val,
                ratio=20.0, # Brickwall-ish
                attack_ms=1.0, # Very fast attack to catch peaks
                release_ms=100.0 # Smooth release to avoid distortion
            ))
            
            # 3. Final Output Ceiling (Safety Gain)
            # Since Compressor allows some overshoot during attack, we apply a small safety attenuation?
            # Actually, let's keep it simple. The compressor will hold it down.
            # If needed, we can follow with a Clipping stage for absolute brickwall if user pushes hard.
            board.append(Clipping(threshold_db=ceiling_val))

        elif fx_id == "stereo-width":
            # Logic handled in process_file (post-processing)
            logger.info(f"Deferring Stereo Width (Post-Processing): {json.dumps(params, default=str)}") 
            pass

        elif fx_id == "gain":
             logger.info(f"Adding Gain: {json.dumps(params, default=str)}")
             board.append(Gain(gain_db=float(params.get("gain", 0))))
             
    except Exception as e:
        logger.error(f"Failed to add module {fx_id}: {e}")

def apply_pro_stereo_widener(audio_data, sample_rate, width_percent):
    """
    Apply 'Bass Mono' Widening (Studio Grade).
    """
    if audio_data.shape[0] != 2:
        return audio_data 
        
    width_factor = width_percent / 100.0
    
    # 1. Mid/Side Encoding
    L = audio_data[0]
    R = audio_data[1]
    
    mid = (L + R) * 0.5
    side = (L - R) * 0.5
    
    # 2. Bass Mono Processing (Crossover at 120Hz)
    # Keeping everything below 120Hz Mono preserves kick punch and translation
    side_mono = side.reshape(1, -1) 
    
    # Use steeper slope if possible by chaining filters, but one HPF is usually enough for M/S
    side_board = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=120) 
    ])
    
    side_high = side_board(side_mono, sample_rate)[0]
    
    # 3. Apply Width to ONLY the high-frequency side content
    side_processed = side_high * width_factor
    
    # 4. Haas Effect Micro-Delay (Psychoacoustic Width) 
    # Only engages for 'Extreme' settings (>120%)
    if width_percent > 120:
        delay_ms = 10  # 10ms for safe Haas
        samples = int(sample_rate * (delay_ms / 1000.0))
        # Create a delayed copy of the side signal
        side_delayed = np.roll(side_processed, samples)
        # Mix it in subtly to add 3D depth without washing it out
        side_processed = side_processed + (side_delayed * 0.15)
    
    # 5. Decode M/S -> L/R
    new_L = mid + side_processed
    new_R = mid - side_processed
    
    return np.stack([new_L, new_R])

def apply_fx_chain(audio, sample_rate, fx_config):
    """
    Apply effects chain to audio data (channels, samples).
    """
    if Pedalboard is None:
        return audio
    
    # 1. Normalize Input (channels, samples)
    if audio.ndim == 1:
        audio = np.stack([audio, audio])
    elif audio.shape[0] > 2:
        # If input is (samples, channels), transpose to (channels, samples)
        if audio.shape[0] > audio.shape[1]: 
             audio = audio.T
    
    # Ensure 2 channels for stereo processing
    if audio.shape[0] > 2:
        audio = audio[:2, :] 
    elif audio.shape[0] == 1:
        audio = np.concatenate([audio, audio], axis=0)

    # 2. Build Board
    board = Pedalboard()
    
    is_legacy = "id" in fx_config and "modules" not in fx_config
    stereo_width_val = None

    if is_legacy:
        add_module_to_board(board, fx_config["id"], fx_config.get("params", {}))
    else:
        modules = fx_config.get("modules", [])
        vsts = fx_config.get("vsts", [])
        
        for mod in modules:
            if mod["id"] == "stereo-width":
                params = mod.get("params", {})
                stereo_width_val = float(params.get("width", 100))
                logger.info(f"Configured Stereo Width: {stereo_width_val}%")
            else:
                add_module_to_board(board, mod["id"], mod.get("params", {}))
            
        for vst_entry in vsts:
            vst_path = ""
            vst_state = None
            if isinstance(vst_entry, str):
                vst_path = vst_entry
            elif isinstance(vst_entry, dict):
                vst_path = vst_entry.get("path", "")
                vst_state = vst_entry.get("state")
            
            if vst_path and os.path.exists(vst_path):
                try:
                    logger.info(f"Loading VST: {vst_path}")
                    plugin = load_plugin(vst_path)
                    if vst_state:
                         try:
                             state_bytes = base64.b64decode(vst_state)
                             plugin.raw_state = state_bytes
                             logger.info(f"Restored VST state ({len(state_bytes)} bytes)")
                         except Exception as exc:
                             logger.error(f"Failed to restore VST state: {exc}")
                    board.append(plugin)
                except Exception as e:
                    logger.error(f"Failed to load VST {vst_path}: {e}")
            else:
                logger.warning(f"VST not found or invalid: {vst_entry}")

    # 3. Process
    try:
        effected = board(audio, sample_rate)
    except Exception as e:
        logger.error(f"Processing chain failed: {str(e)}")
        # Fallback to original
        effected = audio

    # 4. Post-Process: Stereo Width
    if stereo_width_val is not None:
        try:
            logger.info(f"Applying Stereo Width Processing: {stereo_width_val}%")
            effected = apply_pro_stereo_widener(effected, sample_rate, stereo_width_val)
        except Exception as e:
             logger.error(f"Stereo width failed: {e}")
             
    return effected


def process_file(input_path, fx_config):
    """
    Load audio, build chain (Modules + VSTs), process, save.
    """
    logger.info(f"Processing {input_path}...")
    
    # 1. Load Audio
    try:
        # Load as float32
        import soundfile as sf
        
        preview_mode = fx_config.get("preview", False)
        
        with sf.SoundFile(input_path) as f:
            sample_rate = f.samplerate
            frames_total = f.frames
            
            # If preview, only process first 10 seconds (or less if file is short)
            frames_to_read = -1
            if preview_mode:
                frames_to_read = min(int(10 * sample_rate), frames_total)
                logger.info(f"PREVIEW MODE: Processing {frames_to_read/sample_rate:.1f}s")
            
            audio = f.read(frames=frames_to_read, dtype='float32', always_2d=True)
            
        # audio is (samples, channels) usually
    except Exception as e:
        return {"status": "error", "message": f"Failed to read audio: {str(e)}"}

    # 2. Apply FX Chain
    effected = apply_fx_chain(audio, sample_rate, fx_config)

    # 5. Save Output
    # Transpose back: (channels, samples) -> (samples, channels)
    output_audio = effected.T

    # Normalize if clipping (soft)
    max_val = np.abs(output_audio).max() if output_audio.size > 0 else 0

    # Add Pro Limiter/Normalizer logic if close to clipping
    if max_val > 0.99:
        # Use simple normalization to -0.1dB
        target_peak = 0.988  # -0.1 dB
        scale = target_peak / max_val
        output_audio = output_audio * scale
        logger.info(f"Auto-normalized output (Peak was {max_val:.2f})")
    
    # Dither (Pro Feature) - only matters for 16-bit output but SoundFile usually does float32 unless specified.
    # If users export to 16bit later, it helps. For now we save as float32 usually (default) or 16bit PCM.
    # Let's assume standard float32 for stems.
    
    # Generate output filename

    # Generate output filename
    base, ext = os.path.splitext(input_path)
    
    # If preview mode, use a temporary filename
    if fx_config.get("preview", False):
        output_path = f"{base}_preview{ext}"
        # Always overwrite preview
        try:
            sf.write(output_path, output_audio, sample_rate)
        except Exception as e:
             return {"status": "error", "message": f"Failed to write preview: {str(e)}"}
             
        return {
            "status": "success",
            "output_path": output_path,
            "message": "Preview generated",
            "is_preview": True
        }

    # Generate descriptive suffix based on active FX
    fx_names = []
    
    # Check internal modules
    if "modules" in fx_config:
        for m in fx_config["modules"]:
             # Extract ID, map common names to short codes
             mid = m.get("id", "mod")
             mapper = {"compressor": "comp", "saturation": "sat", "distortion": "dist", "reverb": "rev", "delay": "dly"}
             fx_names.append(mapper.get(mid, mid))

    # Check VSTs
    if "vsts" in fx_config:
        for v in fx_config["vsts"]:
             if "name" in v:
                 name = v["name"].replace(" ", "")
             else:
                 name = os.path.basename(v.get("path", "vst")).split(".")[0]
             fx_names.append(name[:8]) 

    if not fx_names:
        suffix_str = "fx"
    else:
        suffix_str = "_".join(fx_names)
        
    # Append to base
    # Clean up any existing _preview suffix if user applies to a preview file (unlikely but safe)
    if base.endswith("_preview"):
        base = base[:-8]

    output_path = f"{base}_{suffix_str}{ext}"
    
    # Ensure unique if exists
    counter = 1
    while os.path.exists(output_path):
        output_path = f"{base}_{suffix_str}_{counter}{ext}"
        counter += 1

    try:
        sf.write(output_path, output_audio, sample_rate)
    except Exception as e:
        return {"status": "error", "message": f"Failed to write output: {str(e)}"}

    return {
        "status": "success",
        "output_path": output_path,
        "message": "FX applied successfully",
        "fx_id": fx_config.get("id", "custom_chain")
    }

def print_status(msg, is_error=False):
    """Print simplified status JSON to stdout."""
    payload = {"status": "error" if is_error else "success", "message": msg}
    print(json.dumps(payload))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("--fx", required=True)
    parser.add_argument("--output", default=None) 
    args = parser.parse_args()

    if not os.path.exists(args.input_file):
         print_status(f"Input file not found: {args.input_file}", True)
         sys.exit(1)

    # Parse FX JSON
    try:
        # Check if FX is base64 encoded (often easier for cli)
        if not args.fx.strip().startswith("{"):
             try:
                 decoded = base64.b64decode(args.fx).decode('utf-8')
                 fx_config = json.loads(decoded)
             except:
                 fx_config = json.loads(args.fx)
        else:
            fx_config = json.loads(args.fx)
    except Exception as e:
        print_status(f"Invalid FX JSON: {e}", True)
        sys.exit(1)

    result = process_file(args.input_file, fx_config)
    
    # Print result JSON to stdout for Tauri
    print(json.dumps(result))

if __name__ == "__main__":
    main()
