'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLicense } from '@/contexts/LicenseContext';
import {
  registerFreeUser,
  loginFreeUser,
  getFreeUserSession,
} from '@/lib/tauri-bridge';

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const { refresh } = useLicense();
  const [showGate, setShowGate] = useState(true);
  const [mode, setMode] = useState<'start' | 'signup' | 'signin'>('start');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing session
    getFreeUserSession().then(s => {
      if (s?.profile?.username) {
        refresh();
      }
    }).catch(() => {});
  }, [refresh]);

  const handleStartFree = () => {
    setShowGate(false);
  };

  const handleSignup = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerFreeUser(username.trim(), email.trim(), password);
      await refresh();
      setShowGate(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginFreeUser(email.trim(), password);
      await refresh();
      setShowGate(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!showGate) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm mx-4"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-[0_0_40px_rgba(34,211,238,0.3)]">
            <span className="text-slate-950 font-black text-2xl">L</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Liminal StemSplit</h1>
          <p className="text-xs text-slate-400 mt-1">AI Stem Separation — 100% Local</p>
        </div>

        {mode === 'start' && (
          <div className="space-y-3">
            <button
              onClick={handleStartFree}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm"
            >
              Start Free — 2-Stem Spleeter
            </button>
            <button
              onClick={() => setMode('signin')}
              className="w-full py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-slate-300 hover:bg-white/[0.04] transition-all text-sm"
            >
              Log In
            </button>
            <button
              onClick={() => setMode('signup')}
              className="w-full py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.04] transition-all text-sm"
            >
              Create Free Account
            </button>
            <p className="text-center text-[9px] text-slate-600 mt-4">
              Free = 2-stem Spleeter splits. Pro ($49 once) unlocks all engines, stems, and FX.
            </p>
          </div>
        )}

        {mode === 'signup' && (
          <div className="space-y-3">
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none"
              disabled={busy}
            />
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none"
              disabled={busy}
            />
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none"
              disabled={busy}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleSignup}
              disabled={busy || !username.trim() || !password}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm disabled:opacity-40"
            >
              {busy ? 'Creating...' : 'Create Free Account'}
            </button>
            <button
              onClick={() => { setMode('start'); setError(null); }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {mode === 'signin' && (
          <div className="space-y-3">
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none"
              disabled={busy}
            />
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none"
              disabled={busy}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleLogin}
              disabled={busy || !email.trim() || !password}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm disabled:opacity-40"
            >
              {busy ? 'Logging in...' : 'Log In'}
            </button>
            <button
              onClick={() => { setMode('start'); setError(null); }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
