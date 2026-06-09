'use client';

import React, { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';

interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

export default function UpdateModal() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const isNewerVersion = (current: string, latest: string) => {
    const normalize = (v: string) => v.split(/(?=[a-z])/i).join('.').split(/[.-]/).map(n => parseInt(n) || 0);
    const c = normalize(current);
    const l = normalize(latest);
    for (let i = 0; i < Math.max(c.length, l.length); i++) {
      if ((l[i] || 0) > (c[i] || 0)) return true;
      if ((c[i] || 0) > (l[i] || 0)) return false;
    }
    return false;
  };

  useEffect(() => {
    async function checkForUpdates() {
      try {
        // Skip if running in browser
        if (!('__TAURI__' in window)) return;

        // Check if user dismissed recently
        const dismissed = localStorage.getItem('stemsplit_update_dismissed');
        if (dismissed && (Date.now() - parseInt(dismissed, 10)) < 24 * 60 * 60 * 1000) {
          return; // Skip if dismissed within last 24hrs
        }

        const currentVersion = await getVersion();
        
        // Fetch latest release from GitHub API
        const response = await fetch('https://api.github.com/repos/myaiplug/StemSplit1/releases/latest');
        if (!response.ok) return;
        
        const data = await response.json();
        const latestTag = data.tag_name as string; // usually like 'v0.1.1'
        const latestVersion = latestTag.replace(/^v/, ''); // remove 'v'

        // Basic version comparison
        if (latestVersion !== currentVersion && isNewerVersion(currentVersion, latestVersion)) {
          setUpdateInfo({
            version: latestVersion,
            url: data.html_url, // Link to the GitHub release page
            notes: data.body
          });
          setIsOpen(true);
        }
      } catch (err) {
        console.error('Failed to check for updates', err);
      }
    }

    checkForUpdates();
  }, []);

  const handleRemindLater = () => {
    localStorage.setItem('stemsplit_update_dismissed', Date.now().toString());
    setIsOpen(false);
  };

  const handleUpdateNow = async () => {
    if (updateInfo) {
      await open(updateInfo.url);
      setIsOpen(false);
    }
  };

  if (!isOpen || !updateInfo) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1A1A1A] border border-[#333] rounded-lg shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0 bg-blue-500/20 p-3 rounded-full border border-blue-500/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div className="ml-4 flex-1">
            <h3 className="text-lg font-semibold text-white">Update Available!</h3>
            <p className="text-sm text-gray-400 mt-1">StemSplit version <strong>{updateInfo.version}</strong> is now available.</p>
          </div>
        </div>
        
        <div className="bg-[#111] p-3 rounded text-xs text-gray-300 font-mono mb-6 max-h-32 overflow-y-auto border border-[#222]">
          {updateInfo.notes ? (
            <div className="whitespace-pre-wrap">{updateInfo.notes}</div>
          ) : (
            "Bug fixes and performance improvements."
          )}
        </div>
        
        <div className="flex items-center justify-end space-x-3">
          <button 
            onClick={handleRemindLater}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded transition-colors"
          >
            Remind Later
          </button>
          <button 
            onClick={handleUpdateNow}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Update Now
          </button>
        </div>
      </div>
    </div>
  );
}