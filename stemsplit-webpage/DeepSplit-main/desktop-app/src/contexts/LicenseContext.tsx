/**
 * License Context - Global license state management
 * Provides license status to all components in the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  LicenseInfo,
  TrialLimitations,
  getLicenseStatus, 
  activateLicense as activateLicenseAPI, 
  deactivateLicense as deactivateLicenseAPI,
  isPro,
  isTrial,
  hasFeature
} from '@/lib/tauri-bridge';

interface LicenseContextType {
  license: LicenseInfo | null;
  loading: boolean;
  error: string | null;
  isPro: boolean;           // Is licensed (paid)
  isTrial: boolean;         // Is trial/free mode
  limitations: TrialLimitations | null;  // Current limitations
  refresh: () => Promise<void>;
  activate: (key: string, email: string) => Promise<LicenseInfo>;
  deactivate: () => Promise<LicenseInfo>;
  hasFeature: (feature: string) => boolean;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const status = await getLicenseStatus();
      setLicense(status);
      if (status.error) {
        setError(status.error);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const activate = useCallback(async (key: string, email: string): Promise<LicenseInfo> => {
    setLoading(true);
    setError(null);
    try {
      const result = await activateLicenseAPI(key, email);
      setLicense(result);
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const deactivate = useCallback(async (): Promise<LicenseInfo> => {
    setLoading(true);
    setError(null);
    try {
      const result = await deactivateLicenseAPI();
      setLicense(result);
      return result;
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const checkFeature = useCallback((feature: string): boolean => {
    if (!license) return false;
    return hasFeature(license, feature);
  }, [license]);

  // Load license status on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const value: LicenseContextType = {
    license,
    loading,
    error,
    isPro: license ? isPro(license) : false,
    isTrial: license ? isTrial(license) : true,
    limitations: license?.limitations || null,
    refresh,
    activate,
    deactivate,
    hasFeature: checkFeature,
  };

  return (
    <LicenseContext.Provider value={value}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense(): LicenseContextType {
  const context = useContext(LicenseContext);
  if (context === undefined) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return context;
}

// Convenience hook for checking pro status
export function useIsPro(): boolean {
  const { isPro } = useLicense();
  return isPro;
}

// Convenience hook for checking trial status
export function useIsTrial(): boolean {
  const { isTrial } = useLicense();
  return isTrial;
}

// Convenience hook for getting limitations
export function useLimitations(): TrialLimitations | null {
  const { limitations } = useLicense();
  return limitations;
}

// Convenience hook for checking if a feature is available
export function useHasFeature(feature: string): boolean {
  const { hasFeature } = useLicense();
  return hasFeature(feature);
}
