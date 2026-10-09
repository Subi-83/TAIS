import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNavbar } from './TopNavbar';
import { useBackendStatus } from '../../context/BackendStatusContext';
import { AlertCircle } from 'lucide-react';

export const Layout = () => {
  const { useDemoMode, apiUrl } = useBackendStatus();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNavbar />

        {useDemoMode && (
          <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
              <span>
                <strong>Demo Mode:</strong> Showing simulated cluster traces. Switch to Live Mode to connect to FastAPI backend at <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 py-0.2 rounded text-[11px]">{apiUrl}</code>.
              </span>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-5 md:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
