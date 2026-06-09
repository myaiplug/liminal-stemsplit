'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface SalesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const gumroadUrl = process.env.NEXT_PUBLIC_GUMROAD_PRODUCT_URL || 'https://gumroad.com/l/stemsplit';
const stripeUrl = process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL || '';

export default function SalesModal({ isOpen, onClose }: SalesModalProps) {
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
            className="relative w-full max-w-5xl rounded-2xl border border-cyan-500/20 bg-slate-950 shadow-[0_0_60px_rgba(34,211,238,0.12)] overflow-hidden"
          >
            <div className="absolute inset-0 pointer-events-none opacity-[0.08] bg-[linear-gradient(rgba(34,211,238,0.16)_1px,transparent_1px)] bg-[size:100%_3px]" />
            <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400" />

            <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between">
              <div>
                <h2 className="font-mono text-cyan-300 text-lg tracking-[0.18em] uppercase">Unlock Pro Processing</h2>
                <p className="text-slate-400 text-sm mt-1">Gumroad is the primary marketplace. Hosted billing webhooks can sync both Gumroad and Stripe purchases into app activation.</p>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-amber-500/35 bg-amber-900/10 p-4">
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-amber-300">Current Plan</p>
                <h3 className="font-mono text-xl text-amber-200 mt-2">Free</h3>
                <p className="text-slate-300 text-sm mt-2">Great for trying the workflow.</p>
                <ul className="mt-4 space-y-2 text-xs text-slate-400 font-mono">
                  <li>2 stems only</li>
                  <li>Spleeter engine</li>
                  <li>1 pass and MP3 output</li>
                  <li>No FX or VST routing</li>
                </ul>
              </div>

              <div className="relative rounded-xl border border-emerald-400/50 bg-emerald-900/10 p-4 shadow-[0_0_26px_rgba(16,185,129,0.16)]">
                <div className="absolute -top-3 right-3 px-2 py-1 rounded bg-emerald-400 text-slate-950 text-[10px] font-mono tracking-[0.12em] uppercase">Most Popular</div>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-300">Pro</p>
                <h3 className="font-mono text-xl text-emerald-200 mt-2">Creator Pro</h3>
                <p className="text-slate-300 text-sm mt-2">Full engine stack + advanced workflow tools.</p>
                <ul className="mt-4 space-y-2 text-xs text-slate-200 font-mono">
                  <li>Demucs, MDX, DrumSep, Spleeter</li>
                  <li>Multi-pass quality control</li>
                  <li>Batch processing</li>
                  <li>FX rack and VST preview</li>
                  <li>Priority runtime updates</li>
                </ul>
                <a
                  href={gumroadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex w-full items-center justify-center px-4 py-2 rounded-md bg-emerald-400 text-slate-950 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-emerald-300 transition-colors"
                >
                  Buy On Gumroad
                </a>
                <p className="mt-2 text-[11px] text-emerald-200/80">Primary activation path. Email + license key is verified in-app.</p>
              </div>

              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-4">
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-300">Alt Checkout</p>
                <h3 className="font-mono text-xl text-cyan-200 mt-2">Stripe Express</h3>
                <p className="text-slate-300 text-sm mt-2">Use Stripe checkout, then sync purchase email into your hosted license server for in-app activation.</p>
                <ul className="mt-4 space-y-2 text-xs text-slate-300 font-mono">
                  <li>Fast card checkout</li>
                  <li>Maps to hosted access credentials</li>
                  <li>Recommended with webhook sync</li>
                </ul>
                {stripeUrl ? (
                  <a
                    href={stripeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex w-full items-center justify-center px-4 py-2 rounded-md border border-cyan-400/60 text-cyan-200 font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-cyan-400 hover:text-slate-950 transition-colors"
                  >
                    Open Stripe Checkout
                  </a>
                ) : (
                  <button
                    disabled
                    className="mt-5 inline-flex w-full items-center justify-center px-4 py-2 rounded-md border border-slate-700 text-slate-500 font-mono text-[11px] uppercase tracking-[0.16em] cursor-not-allowed"
                  >
                    Stripe Not Configured
                  </button>
                )}
                <p className="mt-2 text-[11px] text-slate-400">Set NEXT_PUBLIC_STRIPE_CHECKOUT_URL to enable.</p>
              </div>
            </div>

            <div className="px-6 pb-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <p className="text-slate-200 font-mono text-xs uppercase tracking-[0.14em]">Why Users Upgrade</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-xs text-slate-400">
                  <div className="rounded-lg border border-slate-800 p-3">Faster output turnaround from batch and advanced engines.</div>
                  <div className="rounded-lg border border-slate-800 p-3">Cleaner separations from multi-pass and post-FX chain controls.</div>
                  <div className="rounded-lg border border-slate-800 p-3">Lower friction: one activation unlocks full workflow on this machine.</div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
