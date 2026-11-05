'use client';

/**
 * In-app updater (Tauri 2 updater plugin).
 *
 * Checks the GitHub Releases `latest.json` (see plugins.updater in tauri.conf.json), downloads the
 * signed installer, installs it and relaunches the app. After the relaunch the Rust side runs the
 * embedded-Python self-check (model_doctor --post-update) and emits `engine-post-update`.
 */

import { useCallback, useRef, useState } from 'react';

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'uptodate'
  | 'downloading'
  | 'installing'
  | 'error';

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string;
  date?: string;
}

export interface UseAppUpdater {
  phase: UpdaterPhase;
  update: AvailableUpdate | null;
  /** 0-100 while downloading (null when the server sent no length) */
  percent: number | null;
  error: string | null;
  check: () => Promise<AvailableUpdate | null>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useAppUpdater(): UseAppUpdater {
  const [phase, setPhase] = useState<UpdaterPhase>('idle');
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The plugin's Update handle is a resource id; keep it out of React state.
  const handleRef = useRef<import('@tauri-apps/plugin-updater').Update | null>(null);

  const check = useCallback(async (): Promise<AvailableUpdate | null> => {
    setError(null);
    setPhase('checking');
    try {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      if (!isTauriRuntime()) {
        setPhase('idle');
        return null;
      }
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater');
      const found = await checkUpdate();
      if (!found) {
        handleRef.current = null;
        setUpdate(null);
        setPhase('uptodate');
        return null;
      }
      handleRef.current = found;
      const info: AvailableUpdate = {
        version: found.version,
        currentVersion: found.currentVersion,
        notes: found.body ?? '',
        date: found.date,
      };
      setUpdate(info);
      setPhase('available');
      return info;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
      return null;
    }
  }, []);

  const install = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    setError(null);
    setPercent(0);
    setPhase('downloading');
    try {
      let total = 0;
      let received = 0;
      await handle.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setPercent(total ? 0 : null);
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total) setPercent(Math.min(100, Math.round((received / total) * 100)));
        } else if (event.event === 'Finished') {
          setPercent(100);
          setPhase('installing');
        }
      });
      setPhase('installing');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  const dismiss = useCallback(() => {
    setPhase((p) => (p === 'available' ? 'idle' : p));
  }, []);

  return { phase, update, percent, error, check, install, dismiss };
}
