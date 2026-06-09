'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Download, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { checkPythonStatus, setupPythonEnvironment, deepRepairPythonEnvironment, PythonStatus, PythonSetupProgress } from '@/lib/tauri-bridge';

interface PythonSetupProps {
  onReady: () => void;
}

export default function PythonSetup({ onReady }: PythonSetupProps) {
  const AUTO_INSTALL_ATTEMPTS = 2;
  const AUTO_RETRY_DELAY_MS = 4000;

  const [status, setStatus] = useState<PythonStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<PythonSetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deepRepairUsed, setDeepRepairUsed] = useState(false);
  const autoSetupStartedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await checkPythonStatus();
      setStatus(result);
      
      // If everything is ready, notify parent
      if (result.installed && result.packages_installed) {
        onReady();
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Failed to check Python status: ${detail}`);
    } finally {
      setIsChecking(false);
    }
  }, [onReady]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const runInstall = useCallback(async (autoMode: boolean) => {
    setIsInstalling(true);
    setError(null);
    setProgress({
      message: autoMode ? 'Auto-provisioning runtime...' : 'Starting...',
      percent: 0,
    });

    const maxAttempts = autoMode ? AUTO_INSTALL_ATTEMPTS : 1;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await setupPythonEnvironment((prog) => {
          setProgress(prog);
        });

        // Re-check status after install.
        await checkStatus();
        setIsInstalling(false);
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);

        if (autoMode && attempt < maxAttempts) {
          setProgress({
            message: `Auto-retry ${attempt}/${maxAttempts - 1} in progress...`,
            percent: 5,
          });
          await sleep(AUTO_RETRY_DELAY_MS);
          continue;
        }
      }
    }

    if (autoMode) {
      try {
        setDeepRepairUsed(true);
        setProgress({
          message: 'Auto-fallback: running Deep Repair...',
          percent: 3,
        });
        await deepRepairPythonEnvironment((prog) => {
          setProgress(prog);
        });
        await checkStatus();
        setIsInstalling(false);
        return;
      } catch (deepRepairError: unknown) {
        const detail = deepRepairError instanceof Error ? deepRepairError.message : String(deepRepairError);
        lastError = `${lastError ?? 'Auto setup failed'} | Deep Repair failed: ${detail}`;
      }
    }

    setError(`Installation failed: ${lastError ?? 'Unknown error'}`);
    setIsInstalling(false);
  }, [checkStatus]);

  const handleInstall = async () => {
    await runInstall(false);
  };

  const handleDeepRepair = async () => {
    setIsInstalling(true);
    setError(null);
    setDeepRepairUsed(true);
    setProgress({ message: 'Starting Deep Repair...', percent: 0 });

    try {
      await deepRepairPythonEnvironment((prog) => {
        setProgress(prog);
      });
      await checkStatus();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Deep Repair failed: ${detail}`);
    } finally {
      setIsInstalling(false);
    }
  };

  useEffect(() => {
    if (isChecking || isInstalling) {
      return;
    }

    if (status?.installed && status?.packages_installed) {
      return;
    }

    if (autoSetupStartedRef.current) {
      return;
    }

    autoSetupStartedRef.current = true;
    void runInstall(true);
  }, [isChecking, isInstalling, status, runInstall]);

  if (isChecking) {
    return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full mx-4"
        >
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            <h2 className="text-xl font-semibold text-white">Checking System...</h2>
          </div>
          <p className="text-zinc-400">Verifying AI components are installed</p>
        </motion.div>
      </div>
    );
  }

  // If Python is ready, don't show anything
  if (status?.installed && status?.packages_installed) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-lg w-full mx-4"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-500/20 rounded-xl">
            <Download className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Setup Required</h2>
            <p className="text-zinc-400 text-sm">AI components are being installed automatically</p>
          </div>
        </div>

        {/* Status Items */}
        <div className="space-y-3 mb-6">
          <StatusItem 
            label="Python Environment" 
            installed={status?.installed ?? false}
            detail={status?.version}
          />
          <StatusItem 
            label="PyTorch (AI Engine)" 
            installed={(status?.packages_installed && !status?.missing_packages.includes('torch')) ?? false}
          />
          <StatusItem 
            label="Demucs (Stem Separation)" 
            installed={(status?.packages_installed && !status?.missing_packages.includes('demucs')) ?? false}
          />
          <StatusItem 
            label="Audio Libraries" 
            installed={(status?.packages_installed && !status?.missing_packages.includes('librosa')) ?? false}
          />
        </div>

        {/* Progress Bar */}
        {isInstalling && progress && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-400">{progress.message}</span>
              <span className="text-blue-400">{progress.percent}%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress.percent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/30 rounded-lg mb-6">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Info */}
        <div className="bg-zinc-800/50 rounded-lg p-4 mb-6">
          <p className="text-zinc-300 text-sm">
            <strong>Runtime Download:</strong> up to ~2.7 GB
          </p>
          <p className="text-zinc-400 text-sm mt-1">
            StemSplit tries an optimized runtime first, then automatically falls back to a known-safe CPU stack if GPU packages fail.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-xl transition-colors"
          >
            {isInstalling ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Retry Setup
              </>
            )}
          </button>
          <button
            onClick={handleDeepRepair}
            disabled={isInstalling}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-xl transition-colors"
          >
            {isInstalling && deepRepairUsed ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Deep Repair...
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5" />
                Deep Repair
              </>
            )}
          </button>
        </div>

        <p className="text-zinc-500 text-xs text-center mt-4">
          Setup starts automatically, retries safer paths, and runs Deep Repair before final failure. Use Deep Repair manually if needed.
        </p>
      </motion.div>
    </div>
  );
}

function StatusItem({ 
  label, 
  installed, 
  detail 
}: { 
  label: string; 
  installed: boolean;
  detail?: string | null;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
      <span className="text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        {detail && <span className="text-zinc-500 text-sm">{detail}</span>}
        {installed ? (
          <CheckCircle className="w-5 h-5 text-green-500" />
        ) : (
          <XCircle className="w-5 h-5 text-zinc-500" />
        )}
      </div>
    </div>
  );
}
