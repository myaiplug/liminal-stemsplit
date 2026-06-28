// src/hooks/useSound.tsx
import { useCallback, useEffect, useRef } from 'react';
import { Howl } from 'howler';

const sounds: Record<string, Howl> = {};

export type SoundEffect =
  | 'hover_tick'
  | 'hover_core'
  | 'click_engage'
  | 'process_start'
  | 'process_loop'
  | 'success_chime'
  | 'error_buzz'
  | 'stem_active';

function soundUrl(file: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/sounds/${file}`;
}

function ensureSound(key: SoundEffect, file: string, loop = false, volume = 0.6): Howl {
  if (!sounds[key]) {
    sounds[key] = new Howl({
      src: [soundUrl(file)],
      loop,
      volume,
      preload: true,
      html5: true,
    });
  }
  return sounds[key];
}

function playHowl(howl: Howl) {
  const start = () => {
    howl.stop();
    howl.play();
  };
  const state = howl.state();
  if (state === 'unloaded') {
    howl.once('load', start);
    howl.load();
    return;
  }
  start();
}

export const useSound = () => {
  const isSetup = useRef(false);

  useEffect(() => {
    if (isSetup.current) return;

    ensureSound('hover_tick', 'hover_tick.wav');
    ensureSound('hover_core', 'hover_core.wav');
    ensureSound('click_engage', 'click_engage.wav');
    ensureSound('process_start', 'process_start.wav');
    ensureSound('process_loop', 'process_start.wav', true, 0.28);
    ensureSound('success_chime', 'success_chime.wav', false, 0.75);
    ensureSound('error_buzz', 'error_buzz.wav');
    ensureSound('stem_active', 'stem_active.wav', false, 0.55);

    isSetup.current = true;
  }, []);

  const play = useCallback((effect: SoundEffect, volume?: number) => {
    const howl = sounds[effect];
    if (!howl) return;
    if (volume !== undefined) howl.volume(volume);
    playHowl(howl);
  }, []);

  const stop = useCallback((effect: SoundEffect) => {
    const howl = sounds[effect];
    if (howl) howl.stop();
  }, []);

  const fade = useCallback((effect: SoundEffect, to: number, duration: number) => {
    const howl = sounds[effect];
    if (howl) {
      howl.fade(howl.volume(), to, duration);
    }
  }, []);

  return { play, stop, fade };
};