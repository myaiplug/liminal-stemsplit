'use client';

import React from 'react';
import { LicenseProvider } from '@/contexts/LicenseContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LicenseProvider>
      {children}
    </LicenseProvider>
  );
}
