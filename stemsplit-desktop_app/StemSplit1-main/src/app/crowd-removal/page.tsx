'use client';

import dynamic from 'next/dynamic';
const ReactorZone = dynamic(() => import('@/components/ReactorZone'), { ssr: false });

export default function CrowdRemovalPage() {
  return <main><ReactorZone /></main>;
}
