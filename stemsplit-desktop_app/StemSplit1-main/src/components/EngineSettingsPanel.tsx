'use client';

import React, { useEffect, useState } from 'react';
import { useAppUpdater } from '@/hooks/useAppUpdater';
import { APP_VERSION } from '@/lib/app-version';
import { EngineDoctorReport, EngineProgressEvent, engineDoctor, onEngineProgress } from '@/lib/tauri-bridge';

interface Props {
  onOpenModelLibrary: () => void;
}

/**
 * Settings section: app updates, engine repair, and the model library entry point.
 * Rendered inside the configuration modal; every control degrades gracefully outside Tauri.
 */
export default function EngineSettingsPanel({ onOpenModelLibrary }: Props) {
  const updater = useAppUpdater();
  const [inTauri, setInTauri] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [report, setReport] = useState<EngineDoctorReport | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairLog, setRepairLog] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      setInTauri(isTauriRuntime());
    })();
  }, []);

  useEffect(() => {
    if (!repairing) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await onEngineProgress((ev: EngineProgressEvent) => {
        if (ev.message) setRepairLog((l) => [...l.slice(-7), String(ev.message)]);
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [repairing]);

  const runRepair = async () => {
    setRepairing(true);
    setRepairError(null);
    setReport(null);
    setRepairLog([]);
    try {
      setReport(await engineDoctor(true));
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  const updating = updater.phase === 'downloading' || updater.phase === 'installing';

  return (
    <div className="border border-slate-800 rounded-xl p-2.5 bg-slate-950/60 space-y-2">
      <label className="block text-slate-400 text-[10px] font-mono uppercase tracking-widest">
        App &amp; Engine
      </label>

      {/* Updates */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-300">Version {APP_VERSION}</span>
        <button
          type="button"
          disabled={!inTauri || updater.phase === 'checking' || updating}
          onClick={() => void updater.check()}
          className="px-3 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          title={inTauri ? 'Look for a newer signed release on GitHub' : 'Only available in the desktop app'}
        >
          {updater.phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {updater.phase === 'uptodate' && <span className="text-emerald-400">You&apos;re up to date.</span>}
        {updater.phase === 'error' && (
          <span className="text-red-400 break-all">Update check failed: {updater.error}</span>
        )}
        {updater.phase === 'available' && updater.update && (
          <>
            <span className="text-cyan-300">v{updater.update.version} available</span>
            <button
              type="button"
              onClick={() => void updater.install()}
              className="px-3 py-1 rounded bg-blue-700 border border-blue-500 text-white hover:bg-blue-600"
            >
              Download &amp; install
            </button>
          </>
        )}
        {updating && (
          <span className="text-cyan-300">
            {updater.phase === 'installing' ? 'Installing — the app will restart…' : `Downloading… ${updater.percent ?? ''}${updater.percent === null ? '' : '%'}`}
          </span>
        )}
      </div>

      {/* Engine repair + library */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          disabled={!inTauri || repairing}
          onClick={() => void runRepair()}
          className="px-3 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          title="Verify Python deps, scripts and downloaded models, and repair what's broken"
        >
          {repairing ? 'Repairing…' : 'Repair engine'}
        </button>
        <button
          type="button"
          disabled={!inTauri}
          onClick={onOpenModelLibrary}
          className="px-3 py-1 rounded border border-cyan-700 text-cyan-200 hover:bg-cyan-950/50 disabled:opacity-40"
        >
          Browse model library
        </button>
      </div>

      {repairing && repairLog.length > 0 && (
        <pre className="text-[10px] text-slate-500 whitespace-pre-wrap">{repairLog.join('\n')}</pre>
      )}
      {report && (
        <p className={`text-[11px] ${report.ok ? 'text-emerald-400' : 'text-amber-300'}`}>
          {report.ok
            ? 'Engine verified — everything looks healthy.'
            : `Engine still needs attention: ${
                (report.repairs ?? []).filter((r) => !r.ok).map((r) => `${r.module}: ${r.detail}`).join('; ') ||
                'see the diagnostic log'
              }`}
        </p>
      )}
      {repairError && <p className="text-[11px] text-red-400 break-all">Repair failed: {repairError}</p>}
    </div>
  );
}
