'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLicense } from '@/contexts/LicenseContext';
import {
  registerFreeUser,
  loginFreeUser,
  getFreeUserSession,
  logoutFreeUser,
  verifyFreeUserEmail,
  resendVerificationEmail,
} from '@/lib/tauri-bridge';
import {
  ensureProductionSiteWarm,
  startSiteWarmupLoop,
  type SiteWarmupStatus,
} from '@/lib/site-warmup';

type Mode = 'start' | 'signup' | 'signin' | 'verify';

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const { refresh } = useLicense();
  const [showGate, setShowGate] = useState(true);
  const [mode, setMode] = useState<Mode>('start');
  const [returningEmail, setReturningEmail] = useState<string | null>(null);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);
  const [warmupStatus, setWarmupStatus] = useState<SiteWarmupStatus>({
    awake: false,
    emailReady: false,
    latencyMs: null,
  });
  const [warmupBusy, setWarmupBusy] = useState(false);

  // Pre-warm Render as soon as the login gate appears (cold starts can take ~60s)
  useEffect(() => startSiteWarmupLoop(setWarmupStatus), []);

  useEffect(() => {
    getFreeUserSession().then(s => {
      if (s?.profile?.email) {
        setReturningEmail(s.profile.email);
        setEmail(s.profile.email);
        setMode('signin');
      }
    }).catch(() => {});
  }, []);

  const handleContinueSession = () => {
    setShowGate(false);
    refresh();
  };

  const handleSwitchAccount = async () => {
    try { await logoutFreeUser(); } catch {}
    setReturningEmail(null);
    setEmail('');
    setPassword('');
    setError(null);
    setMode('start');
  };

  const handleSignup = async () => {
    setBusy(true);
    setError(null);
    setFallbackCode(null);
    try {
      if (!warmupStatus.awake || !warmupStatus.emailReady) {
        setWarmupBusy(true);
        setSuccessMsg('Waking up cloud services for email delivery…');
        const warmed = await ensureProductionSiteWarm({ timeoutMs: 120_000, requireEmail: true });
        setWarmupStatus(warmed);
        setWarmupBusy(false);
        setSuccessMsg(null);
      }

      const result = await registerFreeUser(username.trim(), email.trim(), password);
      if (result.success) {
        await refresh();
        setShowGate(false);
      } else {
        setError(result.error || 'Signup failed');
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerifyEmail) return;
    setBusy(true);
    setError(null);
    setFallbackCode(null);
    try {
      if (!warmupStatus.awake || !warmupStatus.emailReady) {
        setWarmupBusy(true);
        setSuccessMsg('Waking up cloud services for email delivery…');
        const warmed = await ensureProductionSiteWarm({ timeoutMs: 120_000, requireEmail: true });
        setWarmupStatus(warmed);
        setWarmupBusy(false);
      }

      const result = await resendVerificationEmail(pendingVerifyEmail);
      if (result.success) {
        if (result.onboarding_email_sent) {
          setSuccessMsg('A new verification code was sent to your email.');
        } else {
          setFallbackCode(result.verification_code || null);
          setSuccessMsg('Email delivery unavailable. Use the code shown below.');
        }
      } else {
        setError(result.error || result.email_error || 'Failed to resend verification email');
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
      setWarmupBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!pendingVerifyEmail || !verificationCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyFreeUserEmail(pendingVerifyEmail, verificationCode.trim());
      if (result.success) {
        await refresh();
        setShowGate(false);
      } else {
        setError(result.error || 'Invalid code');
      }
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
      const result = await loginFreeUser(email.trim(), password);
      if (!result.success) {
        setError(result.error || 'Login failed');
        return;
      }
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
          {!warmupStatus.emailReady && (
            <p className="text-[10px] text-slate-500 mt-2">
              {warmupBusy
                ? 'Connecting email service…'
                : warmupStatus.awake
                  ? 'Preparing email delivery…'
                  : 'Starting cloud services…'}
            </p>
          )}
          {warmupStatus.emailReady && (
            <p className="text-[10px] text-emerald-500/80 mt-2">Email service ready</p>
          )}
        </div>

        {/* Returning user */}
        {returningEmail && mode === 'signin' && (
          <div className="space-y-3">
            <div className="text-center">
              <p className="text-sm text-slate-300">Welcome back</p>
              <p className="text-xs text-cyan-400 font-mono mt-0.5">{returningEmail}</p>
            </div>
            <button
              onClick={handleContinueSession}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm"
            >
              Continue as {returningEmail}
            </button>
            <button
              onClick={handleSwitchAccount}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Switch account
            </button>
          </div>
        )}

        {/* Start screen */}
        {mode === 'start' && !returningEmail && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('signup')}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm"
            >
              Create Free Account
            </button>
            <button
              onClick={() => setMode('signin')}
              className="w-full py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-slate-300 hover:bg-white/[0.04] transition-all text-sm"
            >
              Log In
            </button>
            <p className="text-center text-[9px] text-slate-600 mt-4">
              Free = unlimited 2-stem Spleeter splits. Pro ($19.99 once) unlocks all engines, stems, and FX.
            </p>
          </div>
        )}

        {/* Signup */}
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
            <p className="text-[9px] text-slate-500 text-center">
              By creating an account you agree to our terms. No spam, ever.
            </p>
            <button
              onClick={handleSignup}
              disabled={busy || !username.trim() || !email.trim() || !password}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm disabled:opacity-40"
            >
              {busy ? (warmupBusy ? 'Connecting…' : 'Creating...') : 'Create Free Account'}
            </button>
            <button
              onClick={() => { setMode('start'); setError(null); }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Login */}
        {mode === 'signin' && !returningEmail && (
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-900 accent-cyan-500"
                disabled={busy}
              />
              <span className="text-[11px] text-slate-400">Remember me</span>
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleLogin}
              disabled={busy || !email.trim() || !password}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm disabled:opacity-40"
            >
              {busy ? 'Logging in...' : 'Log In'}
            </button>
            <button
              onClick={() => { setMode('start'); setReturningEmail(null); setError(null); }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Verify Email */}
        {mode === 'verify' && (
          <div className="space-y-3">
            <div className="text-center">
              <p className="text-sm text-slate-300">Verify your email</p>
              <p className="text-xs text-cyan-400 font-mono mt-0.5">{pendingVerifyEmail}</p>
            </div>
            {successMsg && <p className="text-xs text-emerald-400 text-center">{successMsg}</p>}

            {/* Fallback: show code directly when email can't be sent */}
            {fallbackCode && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-center">
                <p className="text-[9px] font-mono uppercase tracking-wider text-amber-400 mb-2">Your Code</p>
                <p className="text-2xl font-mono tracking-[0.3em] text-amber-300 select-all">{fallbackCode}</p>
                <p className="text-[9px] text-amber-500/70 mt-2">Enter this code below to verify</p>
              </div>
            )}

            <input
              value={verificationCode}
              onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.5em] text-white placeholder:text-slate-600 focus:border-cyan-500 outline-none font-mono"
              disabled={busy}
              autoFocus
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleVerify}
              disabled={busy || verificationCode.length < 6}
              className="w-full py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-all font-semibold text-sm disabled:opacity-40"
            >
              {busy ? 'Verifying...' : 'Verify & Enter'}
            </button>

            {/* Resend email button */}
            <button
              onClick={handleResendVerification}
              disabled={busy}
              className="w-full py-2 text-xs text-cyan-500/60 hover:text-cyan-400 transition-colors"
            >
              {busy ? (warmupBusy ? 'Connecting…' : 'Resending...') : 'Resend verification email'}
            </button>

            <button
              onClick={() => { setShowGate(false); refresh(); }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
