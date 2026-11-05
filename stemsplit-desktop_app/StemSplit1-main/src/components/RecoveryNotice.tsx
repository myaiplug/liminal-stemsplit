'use client';

import React, { useEffect, useState } from 'react';
import { RecoveryEvent, SeparationResult, onStemSplitRecovery, readDiagnosticLog } from '@/lib/tauri-bridge';

/** Live "Recovering…" banner while the splitter auto-repairs a failed run. */
export function RecoveryBanner({ active }: { active: boolean }) {
  const [event, setEvent] = useState<RecoveryEvent | null>(null);

  useEffect(() => {
    if (!active) {
      setEvent(null);
      return;
    }
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const { isTauriRuntime } = await import('@/lib/tauri-runtime');
      if (!isTauriRuntime()) return;
      const un = await onStemSplitRecovery((ev) => setEvent(ev));
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [active]);

  if (!active || !event) return null;
  return (
    <div
      role="status"
      className="mt-2 rounded border border-amber-700/50 bg-amber-950/40 px-3 py-1.5 text-[11px] font-mono text-amber-200"
    >
      <span className="mr-1.5 inline-block animate-pulse">⟳</span>
      {event.event === 'recovery' ? event.message : event.message}
    </div>
  );
}

/**
 * Final outcome of auto-recovery, with an expandable diagnostic log.
 * `recovery` and `diagnostic_log` come from the splitter manifest (SeparationResult).
 */
export function RecoveryOutcome({
  result,
  errorText,
}: {
  result: SeparationResult | null;
  errorText?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const recovery = result?.recovery ?? null;
  // On failure the Rust side puts "Diagnostic log: <path>" into the error text.
  const logPath =
    result?.diagnostic_log ??
    recovery?.log_path ??
    (errorText?.match(/Diagnostic log:\s*(.+split_diagnostics\.log)/)?.[1]?.trim() ?? null);
  const message =
    recovery?.final_message ?? errorText?.match(/Auto-recovery:\s*(.+)/)?.[1]?.trim() ?? null;

  if (!message && !logPath) return null;
  if (recovery && !recovery.attempted && !errorText) return null;

  const success = !!recovery?.recovered;
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && log === null && logPath) {
      try {
        setLog(await readDiagnosticLog(logPath));
      } catch (err) {
        setLogError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  return (
    <div
      className={`mt-2 rounded border px-3 py-1.5 text-[11px] font-mono ${
        success
          ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200'
          : 'border-amber-700/50 bg-amber-950/30 text-amber-200'
      }`}
    >
      {message && (
        <div>
          {success ? '✓ ' : '⚠ '}
          {message}
        </div>
      )}
      {recovery && recovery.attempts.length > 1 && (
        <div className="text-[10px] opacity-80">
          {recovery.attempts.length - 1} automatic fix{recovery.attempts.length > 2 ? 'es' : ''} tried
        </div>
      )}
      {logPath && (
        <>
          <button type="button" onClick={() => void toggle()} className="mt-1 underline opacity-80 hover:opacity-100">
            {open ? 'Hide diagnostic log' : 'View diagnostic log'}
          </button>
          {open && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300 bg-black/40 p-2 rounded">
              {logError ? `Could not read log: ${logError}` : log ?? 'Loading…'}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
