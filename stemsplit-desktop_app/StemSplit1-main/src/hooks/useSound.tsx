// src/hooks/useSound.tsx
import { useCallback, useEffect, useRef } from 'react';
import { Howl } from 'howler';

// Store global so we don't recreate on re-render
const sounds: Record<string, Howl> = {};

export type SoundEffect = 
  | 'hover_tick' 
  | 'hover_core' 
  | 'click_engage' 
  | 'process_start' 
  | 'success_chime' 
  | 'error_buzz' 
  | 'stem_active';

export const useSound = () => {
  const isSetup = useRef(false);

  useEffect(() => {
    if (isSetup.current) return;
    
    const loadSound = (key: SoundEffect, file: string, loop: boolean = false) => {
      if (!sounds[key]) {
        sounds[key] = new Howl({
          src: [`/sounds/${file}`],
          loop,
          volume: loop ? 0.3 : 0.6,
          preload: true,
        });
      }
    };

    loadSound('hover_tick', 'hover_tick.wav');
    loadSound('hover_core', 'hover_core.wav');
    loadSound('click_engage', 'click_engage.wav');
    loadSound('process_start', 'process_start.wav');
    loadSound('success_chime', 'success_chime.wav');
    loadSound('error_buzz', 'error_buzz.wav');
    loadSound('stem_active', 'stem_active.wav');

    isSetup.current = true;
  }, []);

  const play = useCallback((effect: SoundEffect, volume: number = 0.5) => {
    if (sounds[effect]) {
      sounds[effect].volume(volume);
      sounds[effect].play();
    }
  }, []);

  const stop = useCallback((effect: SoundEffect) => {
    if (sounds[effect]) {
      sounds[effect].stop();
    }
  }, []);

  const fade = useCallback((effect: SoundEffect, to: number, duration: number) => {
    if (sounds[effect]) {
        sounds[effect].fade(sounds[effect].playing() ? 1 : 0, to, duration);
    }
  }, []);

  return { play, stop, fade };
};
