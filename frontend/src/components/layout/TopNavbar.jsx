import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useBackendStatus } from '../../context/BackendStatusContext';
import {
  Sun,
  Moon,
  RefreshCw,
  Activity,
  Server,
  Zap,
  Settings,
} from 'lucide-react';

const PAGE_TITLES = {
  '/dashboard': { title: 'Overview Dashboard', subtitle: 'Global inference cluster status' },
  '/workload': { title: 'Workload Testing', subtitle: 'Workload profiling & benchmark runner' },
  '/monitor': { title: 'Live Experiment Monitor', subtitle: 'Real-time telemetry and dispatch events' },
  '/backends': { title: 'Backend Workers', subtitle: 'Worker containers and fault injection' },
  '/scheduler': { title: 'Scheduler Configuration', subtitle: 'Token weights and auto-scaling rules' },
  '/comparison': { title: 'Performance Comparison', subtitle: 'Token-Aware vs FIFO comparison' },
  '/reports': { title: 'Experiment Reports', subtitle: 'Telemetry audit and metric exports' },
  '/settings': { title: 'System Settings', subtitle: 'API endpoints, preferences, and defaults' },
};

export const TopNavbar = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const {
    isConnected,
    isChecking,
    useDemoMode,
    setUseDemoMode,
    checkConnection,
    activeExperimentId,
  } = useBackendStatus();

  const currentInfo = PAGE_TITLES[location.pathname] || {
    title: 'Inference Scheduler',
    subtitle: 'Gateway Dashboard',
  };

  return (
    <header className="flex h-14 w-full items-center justify-between border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5">
      {/* Title */}
      <div>
        <h1 className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
          {currentInfo.title}
        </h1>
        <p className="text-[11px] text-gray-500 dark:text-slate-400 hidden sm:block">
          {currentInfo.subtitle}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Active Experiment live shortcut */}
        {activeExperimentId && (
          <Link
            to="/monitor"
            className="hidden md:flex items-center gap-1.5 rounded border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors"
          >
            <Activity className="h-3.5 w-3.5 animate-pulse" />
            <span className="font-mono text-[11px]">{activeExperimentId}</span>
          </Link>
        )}

        {/* Backend Connectivity Status */}
        <div className="flex items-center gap-2 rounded border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60 px-2.5 py-1 text-xs">
          <Server className="h-3 w-3 text-gray-400" />
          <span className="hidden lg:inline text-gray-500 dark:text-slate-400">FastAPI:</span>
          {isConnected ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              Offline
            </span>
          )}
          <button
            onClick={checkConnection}
            disabled={isChecking}
            title="Refresh status"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
          >
            <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>

        {/* Demo Mode Toggle */}
        <button
          onClick={() => setUseDemoMode(!useDemoMode)}
          className={`flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
            useDemoMode
              ? 'border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
              : 'border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
          }`}
          title={useDemoMode ? 'Demo Mode Active' : 'Live Mode Active'}
        >
          <Zap className="h-3 w-3" />
          <span>{useDemoMode ? 'Demo' : 'Live'}</span>
        </button>

        {/* Settings Shortcut */}
        <Link
          to="/settings"
          className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-750"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>

        {/* Dark / Light Toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-750"
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  );
};
