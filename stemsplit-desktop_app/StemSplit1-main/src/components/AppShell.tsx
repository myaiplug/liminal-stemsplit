'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

const ReactorZone = dynamic(() => import('@/components/ReactorZone'), { ssr: false });
const PythonSetup = dynamic(() => import('@/components/PythonSetup'), { ssr: false });
const UpdateModal = dynamic(() => import('@/components/UpdateModal'), { ssr: false });
const LicenseModal = dynamic(() => import('@/components/LicenseModal'), { ssr: false });
const SalesModal = dynamic(() => import('@/components/SalesModal'), { ssr: false });
const LicenseGate = dynamic(() => import('@/components/LicenseGate'), { ssr: false });

export default function AppShell() {
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);

  useEffect(() => {
    const handleOpenLicense = () => setIsLicenseModalOpen(true);
    const handleOpenSales = () => setIsSalesModalOpen(true);
    window.addEventListener('open-license-modal', handleOpenLicense);
    window.addEventListener('open-sales-modal', handleOpenSales);
    return () => {
      window.removeEventListener('open-license-modal', handleOpenLicense);
      window.removeEventListener('open-sales-modal', handleOpenSales);
    };
  }, []);

  return (
    <main>
      <PythonSetup onReady={() => {}} />
      <UpdateModal />
      <LicenseModal isOpen={isLicenseModalOpen} onClose={() => setIsLicenseModalOpen(false)} />
      <SalesModal isOpen={isSalesModalOpen} onClose={() => setIsSalesModalOpen(false)} />
      <LicenseGate>
        <ReactorZone />
      </LicenseGate>
    </main>
  );
}