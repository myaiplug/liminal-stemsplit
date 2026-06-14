'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const ReactorZone = dynamic(() => import('@/components/ReactorZone'), { ssr: false });

export default function VocalExtractorPage() {
  return (
    <main>
      <ReactorZone />
    </main>
  );
}
