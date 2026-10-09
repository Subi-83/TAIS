import React, { useState } from 'react';
import {
  Settings,
  Server,
  Palette,
  Sliders,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Zap,
  Globe,
  Radio,
} from 'lucide-react';
import { useBackendStatus } from '../context/BackendStatusContext';
import { useTheme } from '../context/ThemeContext';
import { metricsService } from '../services';
import { AlertBanner } from '../components/common/AlertBanner';

export const SettingsPage = () => {
  const {
    apiUrl,
    setApiUrl,
    useDemoMode,
    setUseDemoMode,
    pollIntervalSec,
    setPollIntervalSec,
    streamBufferSize,
    setStreamBufferSize,
  } = useBackendStatus();

  const { theme, toggleTheme } = useTheme();

  // Local state for editing
  const [tempUrl, setTempUrl] = useState(apiUrl);
  const [tempPollInterval, setTempPollInterval] = useState(pollIntervalSec);
  const [tempBufferSize, setTempBufferSize] = useState(streamBufferSize);
  const [tempDemoMode, setTempDemoMode] = useState(useDemoMode);
  const [defaultPolicy, setDefaultPolicy] = useState(() => {
    return localStorage.getItem('d07_default_policy') || 'token_aware';
  });

  const [testStatus, setTestStatus] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Test connection to the entered API URL
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      await metricsService.getHealth(false);
      setTestStatus({
        success: true,
        message: 'Successfully reached backend gateway (/health responded 200 OK)',
      });
    } catch (err) {
      setTestStatus({
        success: false,
        message: `Failed to reach backend: ${err?.message || 'Connection refused'}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    setApiUrl(tempUrl);
    setPollIntervalSec(tempPollInterval);
    setStreamBufferSize(tempBufferSize);
    setUseDemoMode(tempDemoMode);
    localStorage.setItem('d07_default_policy', defaultPolicy);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleResetDefaults = () => {
    const defaultUrl = 'http://localhost:8000';
    setTempUrl(defaultUrl);
    setTempPollInterval(15);
    setTempBufferSize(100);
    setTempDemoMode(true);
    setDefaultPolicy('token_aware');

    setApiUrl(defaultUrl);
    setPollIntervalSec(15);
    setStreamBufferSize(100);
    setUseDemoMode(true);
    localStorage.setItem('d07_default_policy', 'token_aware');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Title */}
      <div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
          System Settings & Preferences
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Configure API connection parameters, telemetry streaming buffers, and UI defaults.
        </p>
      </div>

      {saveSuccess && (
        <AlertBanner
          type="success"
          message="Settings updated and saved to local configuration!"
          onClose={() => setSaveSuccess(false)}
        />
      )}

      {testStatus && (
        <AlertBanner
          type={testStatus.success ? 'success' : 'error'}
          title={testStatus.success ? 'Connection Successful' : 'Connection Failed'}
          message={testStatus.message}
          onClose={() => setTestStatus(null)}
        />
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Section 1: Backend API Configuration */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              FastAPI Gateway Connection
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                API Base URL
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="url"
                    value={tempUrl}
                    onChange={(e) => setTempUrl(e.target.value)}
                    placeholder="http://localhost:8000"
                    className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs font-mono text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="rounded border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-750 disabled:opacity-50"
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                URL of the running Python FastAPI backend server.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Cluster Health Polling Interval
                </label>
                <select
                  value={tempPollInterval}
                  onChange={(e) => setTempPollInterval(Number(e.target.value))}
                  className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
                >
                  <option value={5}>Every 5 seconds</option>
                  <option value={10}>Every 10 seconds</option>
                  <option value={15}>Every 15 seconds (Default)</option>
                  <option value={30}>Every 30 seconds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Live Request Stream Buffer Limit
                </label>
                <select
                  value={tempBufferSize}
                  onChange={(e) => setTempBufferSize(Number(e.target.value))}
                  className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
                >
                  <option value={50}>50 requests</option>
                  <option value={100}>100 requests (Default)</option>
                  <option value={250}>250 requests</option>
                  <option value={500}>500 requests</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Appearance & UI Theme */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Palette className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              Appearance & Theme
            </h3>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-gray-900 dark:text-white block">
                Color Mode
              </span>
              <span className="text-[11px] text-gray-500 dark:text-slate-400">
                Currently using {theme === 'dark' ? 'Dark' : 'Light'} theme.
              </span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-750"
            >
              Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
            </button>
          </div>
        </div>

        {/* Section 3: Simulation & Gateway Defaults */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Sliders className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              Simulation & Gateway Defaults
            </h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-gray-900 dark:text-white block">
                  Demo Simulation Mode
                </span>
                <span className="text-[11px] text-gray-500 dark:text-slate-400">
                  When enabled, shows realistic synthetic telemetry traces for local demonstration when FastAPI is offline.
                </span>
              </div>
              <input
                type="checkbox"
                checked={tempDemoMode}
                onChange={(e) => setTempDemoMode(e.target.checked)}
                className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
              />
            </div>

            <div className="border-t border-gray-200 dark:border-slate-800 pt-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Default Scheduling Policy
              </label>
              <select
                value={defaultPolicy}
                onChange={(e) => setDefaultPolicy(e.target.value)}
                className="w-full sm:w-64 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              >
                <option value="token_aware">Token-Aware Scheduling (D07)</option>
                <option value="fifo">FIFO Baseline</option>
              </select>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-750"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 active:bg-blue-700"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};
