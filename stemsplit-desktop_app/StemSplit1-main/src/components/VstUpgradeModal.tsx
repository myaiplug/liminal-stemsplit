'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { startVstCheckout } from '@/lib/commerce';
import { getFreeUserSession } from '@/lib/tauri-bridge';
import { getPluginStatus, getVstUpgradeCopy, refreshVstEntitlements, unlockVstAfterCheckout } from '@/lib/vst-licensing';
import type { VstEntitlementsStatus } from '@/lib/tauri-bridge';

interface VstUpgradeModalProps {
  isOpen: boolean;
  pluginId: string;
  onClose: () => void;
  onUnlocked?: () => void;
  entitlements?: VstEntitlementsStatus | null;
}

export default function VstUpgradeModal({
  isOpen,
  pluginId,
  onClose,
  onUnlocked,
  entitlements,
}: VstUpgradeModalProps) {
  const copy = getVstUpgradeCopy(pluginId);
  const pluginStatus = getPluginStatus(entitlements || null, pluginId);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const session = await getFreeUserSession();
      if (session.success && session.profile?.email) {
        setEmail(session.profile.email);
      }
    })();
  }, [isOpen]);

  const handleCheckout = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await startVstCheckout(copy.productSlug, email);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    setNotice('Stripe checkout opened. Unlocking automatically after payment...');
    setPolling(true);
    setBusy(false);

    const unlock = await unlockVstAfterCheckout(email, pluginId);
    setPolling(false);

    if (!unlock.ok) {
      setError(unlock.error || 'Unlock pending. Use Refresh Unlock after payment completes.');
      return;
    }

    setNotice(`${copy.name} unlocked. Enjoy unlimited access.`);
    onUnlocked?.();
  };

  const handleRefreshUnlock = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const status = await refreshVstEntitlements(email);
      const owned = status.pro_unlocked || getPluginStatus(status, pluginId)?.owned;
      if (owned) {
        setNotice(`${copy.name} unlocked.`);
        onUnlocked?.();
      } else {
        setError('No purchase found for this email yet. Complete checkout, then try again.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] bg-slate-950/85 backdrop-blur-md p-4 flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg rounded-2xl border border-violet-500/25 bg-slate-950 shadow-[0_0_50px_rgba(139,92,246,0.15)] overflow-hidden"
          >
            <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-cyan-400" />
            <div className="px-6 py-5 border-b border-slate-800/80">
              <h2 className="font-mono text-violet-300 text-lg tracking-[0.14em] uppercase">
                Unlock {copy.name}
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Limited free trial included. One-time purchase — instant unlock after payment.
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-300 font-mono space-y-1">
                <p>Trial previews left: {pluginStatus?.previews_remaining ?? copy.trialPreviews}</p>
                <p>Trial applies left: {pluginStatus?.applies_remaining ?? copy.trialApplies}</p>
                <p className="text-emerald-300">Full unlock: {copy.priceLabel} one-time</p>
              </div>

              <label className="block text-[10px] font-mono tracking-[0.18em] uppercase text-violet-300/80">
                Email for instant unlock
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-slate-700 bg-slate-950 text-slate-100 px-3 py-2 font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-violet-500/60"
              />

              {error && <p className="text-xs text-red-300 font-mono">{error}</p>}
              {notice && <p className="text-xs text-emerald-300 font-mono">{notice}</p>}
              {polling && <p className="text-xs text-cyan-300 font-mono animate-pulse">Waiting for payment confirmation...</p>}

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleCheckout}
                  disabled={busy || polling || !email.trim()}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-violet-500 text-white font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-violet-400 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Opening Checkout...' : `Upgrade — ${copy.priceLabel}`}
                </button>
                <button
                  onClick={handleRefreshUnlock}
                  disabled={busy || polling || !email.trim()}
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-slate-700 text-slate-200 font-mono text-[11px] uppercase tracking-[0.16em] hover:border-violet-500/50 transition-colors disabled:opacity-50"
                >
                  Refresh Unlock
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}