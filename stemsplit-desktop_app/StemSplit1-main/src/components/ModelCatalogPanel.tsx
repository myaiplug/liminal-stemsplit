'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CatalogListing,
  CatalogModel,
  EngineProgressEvent,
  catalogDownload,
  catalogList,
  catalogRemove,
  onEngineProgress,
} from '@/lib/tauri-bridge';
import { formatSize, syncInstalledModels } from '@/lib/model-library';

interface Props {
  onClose: () => void;
  /** Called when the user picks a downloaded model to use for the next split. */
  onUseModel?: (variantId: string) => void;
}

type Filter = 'all' | 'installed' | 'fits' | 'new';

const VRAM_BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Fits', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' },
  tight: { label: 'Tight fit', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50' },
  too_big: { label: 'Too big for your GPU', cls: 'bg-red-900/40 text-red-300 border-red-700/50' },
  unknown: { label: 'VRAM unknown', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
};

/**
 * Model library: discover open models (audio-separator list + the remote manifest, optionally
 * Hugging Face), see size / stems / VRAM need, and download them. Downloads register themselves in
 * the user registry so they show up in the model picker.
 */
export default function ModelCatalogPanel({ onClose, onUseModel }: Props) {
  const [listing, setListing] = useState<CatalogListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [includeHf, setIncludeHf] = useState(false);
  const [vramBudget, setVramBudget] = useState<number>(8);
  const [gpuLabel, setGpuLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, EngineProgressEvent | 'working'>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const budgetRef = useRef(vramBudget);
  budgetRef.current = vramBudget;

  const load = useCallback(
    async (refresh = false) => {
      setError(null);
      refresh ? setRefreshing(true) : setLoading(true);
      try {
        const data = await catalogList({ refresh, includeHf, vramGb: budgetRef.current });
        setListing(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [includeHf],
  );

  // GPU memory -> VRAM budget (defaults to 8 GB when no NVIDIA GPU / unknown).
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const profile = await invoke<{ has_nvidia: boolean; gpu_name?: string | null; gpu_vram_gb?: number | null }>(
          'get_system_profile',
        );
        if (profile.has_nvidia && profile.gpu_vram_gb) {
          setVramBudget(Math.round(profile.gpu_vram_gb * 10) / 10);
          setGpuLabel(`${profile.gpu_name ?? 'GPU'} • ${profile.gpu_vram_gb.toFixed(0)} GB`);
        } else {
          setGpuLabel('No NVIDIA GPU detected — sizing against an 8 GB card');
        }
      } catch {
        /* keep default */
      }
    })();
  }, []);

  useEffect(() => {
    void load(false);
  }, [load, vramBudget]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await onEngineProgress((ev) => {
        if (ev.event === 'catalog_progress' && ev.model_id) {
          setBusy((b) => ({ ...b, [ev.model_id as string]: ev }));
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const download = async (m: CatalogModel) => {
    setNotice(null);
    setBusy((b) => ({ ...b, [m.id]: 'working' }));
    try {
      const res = await catalogDownload(m.id);
      setNotice(res.ok ? `${m.name} downloaded and registered.` : `${m.name}: ${res.message ?? 'download failed'}`);
      await syncInstalledModels();
      await load(false);
    } catch (err) {
      setNotice(`${m.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[m.id];
        return next;
      });
    }
  };

  const remove = async (m: CatalogModel) => {
    setBusy((b) => ({ ...b, [m.id]: 'working' }));
    try {
      const res = await catalogRemove(m.id);
      setNotice(res.ok ? `${m.name} removed.` : `${m.name}: ${res.message ?? 'could not remove'}`);
      await syncInstalledModels();
      await load(false);
    } catch (err) {
      setNotice(`${m.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[m.id];
        return next;
      });
    }
  };

  const models = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (listing?.models ?? []).filter((m) => {
      if (filter === 'installed' && !m.installed) return false;
      if (filter === 'fits' && !m.fits_vram) return false;
      if (filter === 'new' && !m.new) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.family ?? '').toLowerCase().includes(q) ||
        m.stems.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [listing, search, filter]);

  const sourceText = listing
    ? Object.entries(listing.sources)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' • ')
    : '';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-cyan-900/50 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div>
            <h2 className="text-cyan-400 font-mono text-lg">Model Library</h2>
            <p className="text-[10px] text-slate-500 font-mono">
              {gpuLabel ?? 'Detecting GPU…'} • budget {vramBudget} GB VRAM
              {listing?.offline ? ' • offline (bundled list)' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white px-2" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-slate-800">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, family, stem…"
            className="flex-1 min-w-[180px] bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-600 outline-none"
          />
          {(['all', 'installed', 'fits', 'new'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-1 rounded-full font-mono border ${
                filter === f
                  ? 'bg-cyan-900/50 text-cyan-300 border-cyan-700/50'
                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
              }`}
            >
              {{ all: 'All', installed: 'Installed', fits: `Fits ${vramBudget} GB`, new: 'New' }[f]}
            </button>
          ))}
          <label className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
            <input type="checkbox" checked={includeHf} onChange={(e) => setIncludeHf(e.target.checked)} />
            Hugging Face
          </label>
          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="text-[10px] px-3 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 font-mono"
          >
            {refreshing ? 'Refreshing…' : 'Refresh online'}
          </button>
        </div>

        {notice && <div className="px-5 py-2 text-xs font-mono text-cyan-300 bg-cyan-950/30">{notice}</div>}
        {error && <div className="px-5 py-2 text-xs font-mono text-red-300 bg-red-950/30">{error}</div>}

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
          {loading && <p className="text-xs text-slate-500 font-mono p-4">Loading catalog…</p>}
          {!loading && models.length === 0 && (
            <p className="text-xs text-slate-500 font-mono p-4">No models match.</p>
          )}
          <ul className="space-y-1.5">
            {models.map((m) => {
              const state = busy[m.id];
              const pct = state && state !== 'working' ? state.progress ?? null : null;
              const badge = VRAM_BADGE[m.vram_status ?? 'unknown'] ?? VRAM_BADGE.unknown;
              return (
                <li key={m.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-slate-100 font-semibold truncate">{m.name}</span>
                        {m.new && !m.installed && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 font-mono">NEW</span>
                        )}
                        {m.installed && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 font-mono">INSTALLED</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
                        <span>{m.family ?? m.engine}</span>
                        <span>size {formatSize(m.size_mb, m.size_estimated)}</span>
                        <span>
                          stems: {m.stems.length ? m.stems.join(' / ') : 'unspecified'}
                        </span>
                        <span>
                          VRAM {m.vram_gb ? `${m.vram_estimated ? '~' : ''}${m.vram_gb} GB` : '—'}
                        </span>
                        {m.sdr ? <span>SDR {m.sdr}</span> : null}
                        <span className={`px-1.5 py-0.5 rounded border ${badge.cls}`}>
                          {m.vram_status === 'too_big' ? `Won’t fit ${vramBudget} GB` : badge.label}
                        </span>
                      </div>
                      {state && (
                        <div className="mt-2">
                          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-cyan-500 ${pct === null ? 'animate-pulse w-full' : ''}`}
                              style={pct === null ? undefined : { width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                            {state === 'working'
                              ? 'Working…'
                              : `Downloading ${state.file ?? ''} (${state.file_index ?? 1}/${state.file_count ?? 1})${pct !== null ? ` ${pct}%` : ''}`}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {m.installed ? (
                        <>
                          {onUseModel && (
                            <button
                              onClick={() => {
                                onUseModel(m.variant_id || m.id);
                                onClose();
                              }}
                              className="text-[10px] px-3 py-1 rounded bg-cyan-900 border border-cyan-600 text-cyan-50 hover:bg-cyan-800 font-mono"
                            >
                              Use
                            </button>
                          )}
                          {!m.builtin_variant && (
                            <button
                              onClick={() => void remove(m)}
                              disabled={!!state}
                              className="text-[10px] px-3 py-1 rounded border border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-800 disabled:opacity-40 font-mono"
                            >
                              Remove
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => void download(m)}
                          disabled={!!state}
                          className="text-[10px] px-3 py-1 rounded bg-blue-700 border border-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 font-mono"
                        >
                          {state ? 'Downloading…' : 'Download'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-5 py-2 border-t border-slate-800 text-[9px] text-slate-600 font-mono truncate" title={sourceText}>
          {models.length} shown • {sourceText || 'sources: bundled'} • open, freely downloadable models only
        </div>
      </div>
    </div>
  );
}
