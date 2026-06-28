'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getProPriceLabel, openPricingPage, startProCheckout } from '@/lib/commerce';

interface SalesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SalesModal({ isOpen, onClose }: SalesModalProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleBuyPro = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await startProCheckout(email);
    if (result.ok) {
      setNotice('Secure Stripe checkout opened in your browser. After payment, check your email for the access password.');
    } else {
      setError(result.error);
    }

    setBusy(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] bg-slate-950/85 backdrop-blur-md p-4 flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-2xl border border-cyan-500/20 bg-slate-950 shadow-[0_0_60px_rgba(34,211,238,0.12)] overflow-hidden"
          >
            <div className="absolute inset-0 pointer-events-none opacity-[0.08] bg-[linear-gradient(rgba(34,211,238,0.16)_1px,transparent_1px)] bg-[size:100%_3px]" />
            <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400" />

            <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between">
              <div>
                <h2 className="font-mono text-cyan-300 text-lg tracking-[0.18em] uppercase">Upgrade To Pro</h2>
                <p className="text-slate-400 text-sm mt-1">One-time purchase. Unlimited splits. All engines unlocked.</p>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-amber-500/35 bg-amber-900/10 p-4">
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-amber-300">Free</p>
                <h3 className="font-mono text-xl text-amber-200 mt-2">Trial</h3>
                <ul className="mt-4 space-y-2 text-xs text-slate-400 font-mono">
                  <li>Unlimited Spleeter 2-stem splits</li>
                  <li>MP3 output only</li>
                  <li>Advanced engines locked</li>
                </ul>
              </div>

              <div className="relative rounded-xl border border-emerald-400/50 bg-emerald-900/10 p-4 shadow-[0_0_26px_rgba(16,185,129,0.16)]">
                <div className="absolute -top-3 right-3 px-2 py-1 rounded bg-emerald-400 text-slate-950 text-[10px] font-mono tracking-[0.12em] uppercase">
                  Pro — {getProPriceLabel()}
                </div>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-300">One-Time</p>
                <h3 className="font-mono text-xl text-emerald-200 mt-2">Creator Pro</h3>
                <ul className="mt-4 space-y-2 text-xs text-slate-200 font-mono">
                  <li>Demucs, MDX, DrumSep, Spleeter</li>
                  <li>Unlimited splits + batch mode</li>
                  <li>FX rack and VST preview</li>
                  <li>WAV export and multi-pass quality</li>
                </ul>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                <p className="text-slate-200 font-mono text-xs uppercase tracking-[0.14em]">3-Step Upgrade</p>
                <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                  <li>Buy Pro with Stripe (button below)</li>
                  <li>Check your email for the access password</li>
                  <li>Open Activate Pro and paste email + password</li>
                </ol>

                <label className="block text-[10px] font-mono tracking-[0.18em] uppercase text-cyan-300/80">
                  Checkout email (optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 text-slate-100 px-3 py-2 font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/60"
                />

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={handleBuyPro}
                    disabled={busy}
                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-emerald-400 text-slate-950 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-emerald-300 transition-colors disabled:opacity-50"
                  >
                    {busy ? 'Opening Checkout...' : `Buy Pro — ${getProPriceLabel()}`}
                  </button>
                  <button
                    onClick={() => openPricingPage()}
                    className="inline-flex items-center justify-center px-4 py-2.5 rounded-md border border-cyan-400/60 text-cyan-200 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-cyan-400 hover:text-slate-950 transition-colors"
                  >
                    View Pricing Page
                  </button>
                </div>

                {notice && <p className="text-emerald-300 text-xs font-mono">{notice}</p>}
                {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}