'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  getFreeUserSession,
  loginFreeUser,
  logoutFreeUser,
  registerFreeUser,
} from '@/lib/tauri-bridge';
import { useLicense } from '@/contexts/LicenseContext';

type Mode = 'signin' | 'signup' | 'pro';

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LicenseModal({ isOpen, onClose }: LicenseModalProps) {
  const { isPro, activate, refresh } = useLicense();

  const [mode, setMode] = useState<Mode>('signin');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const [licenseKey, setLicenseKey] = useState('');
  const [licenseEmail, setLicenseEmail] = useState('');

  const [sessionUsername, setSessionUsername] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === 'signup') return 'Create Free Account';
    if (mode === 'pro') return 'Pro Activation';
    return 'Login';
  }, [mode]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccess(null);
    setMode(isPro ? 'pro' : 'signin');

    (async () => {
      const session = await getFreeUserSession();
      if (session.success && session.profile) {
        setSessionUsername(session.profile.username);
        setSessionEmail(session.profile.email);
      } else {
        setSessionUsername(null);
        setSessionEmail(null);
      }
    })();
  }, [isOpen, isPro]);

  const handleOpenSales = () => {
    window.dispatchEvent(new CustomEvent('open-sales-modal'));
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const result = await loginFreeUser(identifier, password);
    if (result.success && result.profile) {
      setSessionUsername(result.profile.username);
      setSessionEmail(result.profile.email);
      setSuccess('Welcome back. Free account login successful.');
    } else {
      setError(result.error || 'Login failed.');
    }

    setBusy(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const result = await registerFreeUser(signupUsername, signupEmail, signupPassword);
    if (result.success && result.profile) {
      setSessionUsername(result.profile.username);
      setSessionEmail(result.profile.email);
      if (result.onboarding_email_sent) {
        setSuccess('Account created. Onboarding email sent.');
      } else {
        setSuccess('Account created. Email delivery is not configured yet.');
      }
    } else {
      setError(result.error || 'Signup failed.');
    }

    setBusy(false);
  };

  const handleProActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await activate(licenseKey, licenseEmail);
      if (result.is_valid && !result.is_trial) {
        setSuccess('Pro activation successful. All premium features unlocked.');
        await refresh();
      } else {
        setError(result.error || 'Activation failed.');
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogoutFree = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const result = await logoutFreeUser();
    if (result.success) {
      setSessionUsername(null);
      setSessionEmail(null);
      setSuccess('Logged out from free account.');
    } else {
      setError(result.error || 'Logout failed.');
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
          className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-md p-4 flex items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 14, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl border border-amber-400/30 bg-slate-950 overflow-hidden shadow-[0_0_60px_rgba(245,158,11,0.14)]"
          >
            <div className="absolute inset-0 pointer-events-none opacity-[0.08] bg-[linear-gradient(rgba(245,158,11,0.16)_1px,transparent_1px)] bg-[size:100%_3px]" />
            <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-cyan-400 to-emerald-400" />

            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-amber-300">Identity Console</p>
                <h2 className="font-mono text-lg text-slate-100 mt-1">{title}</h2>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-500/50 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="flex flex-wrap gap-2 mb-4">
                <TabButton active={mode === 'signin'} onClick={() => setMode('signin')} label="Login" />
                <TabButton active={mode === 'signup'} onClick={() => setMode('signup')} label="Create Free" />
                <TabButton active={mode === 'pro'} onClick={() => setMode('pro')} label="Activate Pro" />
                <button
                  onClick={handleOpenSales}
                  className="ml-auto px-3 py-2 rounded-md border border-cyan-500/45 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-cyan-400 hover:text-slate-950 transition-colors"
                >
                  View Pricing
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                {sessionUsername && (
                  <div className="mb-4 p-3 rounded border border-emerald-500/30 bg-emerald-900/10">
                    <p className="text-emerald-300 font-mono text-xs uppercase tracking-[0.16em]">Signed in as {sessionUsername}</p>
                    <p className="text-emerald-200/80 text-xs mt-1">{sessionEmail}</p>
                    <button
                      onClick={handleLogoutFree}
                      disabled={busy}
                      className="mt-2 px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-300 text-xs font-mono uppercase tracking-[0.14em] hover:bg-emerald-500 hover:text-slate-950 transition-colors disabled:opacity-50"
                    >
                      Logout Free Account
                    </button>
                  </div>
                )}

                {mode === 'signin' && (
                  <form onSubmit={handleSignIn} className="space-y-3">
                    <Input label="Email Or Username" value={identifier} setValue={setIdentifier} placeholder="you@example.com or username" />
                    <Input label="Password" type="password" value={password} setValue={setPassword} placeholder="Your password" />
                    <ActionButton label={busy ? 'Signing In...' : 'Sign In'} disabled={busy || !identifier.trim() || !password.trim()} />
                  </form>
                )}

                {mode === 'signup' && (
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <Input label="Username" value={signupUsername} setValue={setSignupUsername} placeholder="Choose a username" />
                    <Input label="Email" value={signupEmail} setValue={setSignupEmail} placeholder="you@example.com" />
                    <Input label="Password" type="password" value={signupPassword} setValue={setSignupPassword} placeholder="At least 8 characters" />
                    <ActionButton label={busy ? 'Creating Account...' : 'Create Free Account'} disabled={busy || !signupUsername.trim() || !signupEmail.trim() || !signupPassword.trim()} />
                    <p className="text-xs text-slate-400">Onboarding email sends automatically when email provider env vars are configured.</p>
                  </form>
                )}

                {mode === 'pro' && (
                  <form onSubmit={handleProActivate} className="space-y-3">
                    <Input label="Purchase Email" value={licenseEmail} setValue={setLicenseEmail} placeholder="Email used at checkout" />
                    <Input label="License Key Or Access Password" value={licenseKey} setValue={setLicenseKey} placeholder="Gumroad key or hosted access password" />
                    <ActionButton label={busy ? 'Activating...' : 'Activate Pro'} disabled={busy || !licenseEmail.trim() || !licenseKey.trim()} />
                    <p className="text-xs text-slate-400">
                      Gumroad is the main marketplace. Stripe or Gumroad webhooks can also issue hosted access credentials against your license server.
                    </p>
                  </form>
                )}

                {error && <p className="mt-3 text-red-400 text-sm font-mono">{error}</p>}
                {success && <p className="mt-3 text-emerald-300 text-sm font-mono">{success}</p>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-md border font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
        active
          ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
          : 'border-slate-700 text-slate-400 hover:border-amber-500/40 hover:text-amber-300'
      }`}
    >
      {label}
    </button>
  );
}

function Input({
  label,
  value,
  setValue,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono tracking-[0.18em] uppercase text-amber-300/80 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-700 bg-slate-950 text-slate-100 px-3 py-2 font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
      />
    </div>
  );
}

function ActionButton({ label, disabled }: { label: string; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full px-4 py-2 rounded-md bg-amber-500 text-slate-950 font-mono text-[11px] uppercase tracking-[0.18em] hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
