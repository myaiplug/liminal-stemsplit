'use client';

import React, { useEffect, useState } from 'react';
import { useAppUpdater } from '@/hooks/useAppUpdater';
import type { EngineDoctorReport } from '@/lib/tauri-bridge';

const DISMISS_KEY = 'stemsplit_update_dismissed';
const DISMISS_MS = 24 * 60 * 60 * 1000;

/**
 * Checks for a signed app update on launch (Tauri updater -> GitHub Releases latest.json).
 * "Update now" downloads, installs and relaunches. After the relaunch the engine self-check result
 * (`engine-post-update`) is surfaced here as a small toast.
 */
export default function UpdateModal() {
  const { phase, update, percent, error, check, install, dismiss } = useAppUpdater();
  const [engineNote, setEngineNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Launch check (silent on failure / up to date).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      if (!isTauriRuntime() || process.env.NEXT_PUBLIC_SCREENSHOT_MODE === '1') return;
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (dismissed && Date.now() - parseInt(dismissed, 10) < DISMISS_MS) return;
      if (!cancelled) await check();
    })();
    return () => {
      cancelled = true;
    };
  }, [check]);

  // Post-update engine verification (emitted once per app version by the Rust side).
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      if (!isTauriRuntime()) return;
      const { onEnginePostUpdate } = await import('@/lib/tauri-bridge');
      unlisten = await onEnginePostUpdate((payload: EngineDoctorReport & { skipped?: boolean }) => {
        if (payload.skipped) return;
        setEngineNote({
          ok: !!payload.ok,
          text: payload.ok
            ? 'Engine verified after update.'
            : `Engine needs attention after the update: ${payload.detail || payload.error || 'open Settings → Repair engine.'}`,
        });
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleRemindLater = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    dismiss();
  };

  const busy = phase === 'downloading' || phase === 'installing';
  const open = (phase === 'available' || busy || (phase === 'error' && !!update)) && !!update;

  return (
    <>
      {engineNote && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-[110] max-w-sm rounded-lg border px-4 py-3 text-xs font-mono shadow-xl ${
            engineNote.ok
              ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200'
              : 'bg-amber-950/90 border-amber-700/60 text-amber-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{engineNote.text}</span>
            <button onClick={() => setEngineNote(null)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
              ✕
            </button>
          </div>
        </div>
      )}

      {open && update && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1A1A1A] border border-[#333] rounded-lg shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0 bg-blue-500/20 p-3 rounded-full border border-blue-500/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-white">Update Available!</h3>
                <p className="text-sm text-gray-400 mt-1">
                  NoDAW Liminal <strong>{update.version}</strong> is ready (you have {update.currentVersion}).
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  The update is downloaded, verified against the release signature, installed, and the app restarts.
                  Your models and settings are kept; the engine is re-checked automatically afterwards.
                </p>
              </div>
            </div>

            <div className="bg-[#111] p-3 rounded text-xs text-gray-300 font-mono mb-4 max-h-32 overflow-y-auto border border-[#222]">
              {update.notes ? (
                <div className="whitespace-pre-wrap">{update.notes}</div>
              ) : (
                'Bug fixes and performance improvements.'
              )}
            </div>

            {busy && (
              <div className="mb-4">
                <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-blue-500 transition-all ${percent === null ? 'animate-pulse w-full' : ''}`}
                    style={percent === null ? undefined : { width: `${percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1 font-mono">
                  {phase === 'installing' ? 'Installing — the app will restart…' : `Downloading… ${percent ?? ''}${percent === null ? '' : '%'}`}
                </p>
              </div>
            )}
            {phase === 'error' && error && (
              <p className="text-xs text-red-400 font-mono mb-4 break-words">Update failed: {error}</p>
            )}

            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={handleRemindLater}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded transition-colors disabled:opacity-40"
              >
                Remind Later
              </button>
              <button
                onClick={() => void install()}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-40"
              >
                {phase === 'error' ? 'Retry' : busy ? 'Updating…' : 'Update Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
