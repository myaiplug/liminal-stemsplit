import argparse
import sys
import base64
import time
import soundfile as sf
import numpy as np
import threading
from pedalboard import load_plugin, Pedalboard

# Global flag to control the audio thread
STOP_STREAM = False

def preview_vst(vst_path, audio_path):
    global STOP_STREAM
    # Enable verbose logging for debugging
    print(f"Loading VST: {vst_path}", file=sys.stderr)
    
    try:
        # Load Audio (SoundFile)
        audio_data, sample_rate = sf.read(audio_path, dtype='float32')
        
        # Ensure Stereo (samples, channels) make 2D array
        if audio_data.ndim == 1:
            audio_data = audio_data.reshape(-1, 1) # (N, 1)
            # Duplicate mono to stereo
            audio_data = np.concatenate([audio_data, audio_data], axis=1) # (N, 2)
        elif audio_data.shape[1] > 2:
            audio_data = audio_data[:, :2]  # Truncate to stereo
            
        print(f"Loaded audio: {audio_data.shape} @ {sample_rate}Hz", file=sys.stderr)
        
        # Load SoundDevice
        try:
            import sounddevice as sd
        except ImportError:
            print("Error: 'sounddevice' library is required for real-time preview. Please install it with 'pip install sounddevice'.", file=sys.stderr)
            sys.exit(1)

        # Load Plugin
        plugin = load_plugin(vst_path)
        
        # Open Editor
        print("Opening GUI... Check your taskbar if hidden.", file=sys.stderr)
        try:
             plugin.show_editor()
        except Exception as e:
             # some plugins/systems might fail to show editor but still load
             print(f"Warning: Editor might not have opened: {e}", file=sys.stderr)
        
        # Create a Pedalboard (Single Plugin)
        board = Pedalboard([plugin])
        
        # Playback logic state
        current_idx = 0
        total_frames = len(audio_data)

        def callback(outdata, frames, time_info, status):
            nonlocal current_idx
            if status:
                print(status, file=sys.stderr)
            
            chunk_end = current_idx + frames
            
            # Loop logic (seamless)
            if chunk_end > total_frames:
                remaining = total_frames - current_idx
                chunk1 = audio_data[current_idx:total_frames]
                
                needed_from_start = frames - remaining
                # Handle edge case where needed > total_frames (rare but possible with small files)
                chunk2 = audio_data[0:needed_from_start] # Simplified: assumes file length > buffer size usually
                
                # If file is shorter than buffer, tile it
                if len(chunk2) < needed_from_start:
                    reps = int(np.ceil(needed_from_start / len(audio_data))) + 1
                    tiled = np.tile(audio_data, (reps, 1))
                    chunk2 = tiled[0:needed_from_start]

                input_chunk = np.concatenate((chunk1, chunk2))
                current_idx = needed_from_start
            else:
                input_chunk = audio_data[current_idx:chunk_end]
                current_idx = chunk_end
            
            # Process in Pedalboard
            # Pedalboard expects (channels, samples)
            chunk_T = input_chunk.T # (2, N)
            
            # Reset=False keeps tails
            processed_T = board(chunk_T, sample_rate, reset=False) 
            
            # Transpose back for SoundDevice (samples, channels)
            processed = processed_T.T
            
            # Write to output buffer
            outdata[:] = processed

        print("Starting Audio Stream... Close the window (or stop command) to end.", file=sys.stderr)
        
        # Start Output Stream
        # blocksize=2048 gives decent latency (approx 46ms @ 44.1k) without glitches
        with sd.OutputStream(samplerate=sample_rate, channels=2, callback=callback, blocksize=2048):
            while not STOP_STREAM:
                # Capture State periodically
                try:
                    # raw_state access might be tricky if plugin is busy
                    if hasattr(plugin, 'raw_state'):
                         # Get raw bytes
                         state_bytes = plugin.raw_state
                         if state_bytes:
                            # Encode Base64
                            state_b64 = base64.b64encode(state_bytes).decode('utf-8')
                            # Ensure atomic print 
                            sys.stdout.write(f"STATE:{state_b64}\n")
                            sys.stdout.flush()
                except Exception:
                    pass
                time.sleep(1.0) # Frequency of state updates (1s is enough for UI sync, avoids spam)

    except KeyboardInterrupt:
        print("Stopping...", file=sys.stderr)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("vst_path")
    parser.add_argument("audio_path")
    args = parser.parse_args()
    
    preview_vst(args.vst_path, args.audio_path)
