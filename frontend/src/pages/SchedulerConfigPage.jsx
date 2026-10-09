import React, { useState, useEffect, useCallback } from 'react';
import {
  Sliders,
  Save,
  RotateCcw,
  Cpu,
  Layers,
} from 'lucide-react';
import { schedulerService } from '../services';
import { StatusBadge } from '../components/common/StatusBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { AlertBanner } from '../components/common/AlertBanner';
import { useBackendStatus } from '../context/BackendStatusContext';

export const SchedulerConfigPage = () => {
  const { useDemoMode } = useBackendStatus();

  const [config, setConfig] = useState(null);
  const [initialConfig, setInitialConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await schedulerService.getConfig(useDemoMode);
      setConfig(data);
      setInitialConfig(data);
    } catch (err) {
      setError(err?.message || 'Failed to load scheduler configuration');
    } finally {
      setIsLoading(false);
    }
  }, [useDemoMode]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!config) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await schedulerService.updateConfig(
        {
          policy: config.policy,
          token_aware_settings: config.token_aware_settings,
          scaling_config: config.scaling_config,
        },
        useDemoMode
      );
      setConfig(updated);
      setInitialConfig(updated);
      setSuccessMessage('Scheduler configuration updated successfully!');
    } catch (err) {
      setError(err?.message || 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (initialConfig) {
      setConfig({ ...initialConfig });
      setError(null);
      setSuccessMessage(null);
    }
  };

  if (isLoading && !config) {
    return <LoadingSpinner label="Fetching scheduler configuration..." />;
  }

  if (!config) {
    return (
      <div className="space-y-4">
        <AlertBanner type="error" title="Config Unavailable" message={error || 'Could not load configuration'} />
        <button
          onClick={loadConfig}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const isTokenAware = config.policy === 'token_aware';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            Scheduler & Auto-Scaling Configuration
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Tune token weights, starvation prevention aging heuristics, and replica autoscaling thresholds.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Active:</span>
          <StatusBadge status={config.policy} />
        </div>
      </div>

      {successMessage && (
        <AlertBanner
          type="success"
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
        />
      )}

      {error && (
        <AlertBanner
          type="error"
          title="Update Error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Policy Selection */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Select Active Scheduling Algorithm
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div
              onClick={() => setConfig({ ...config, policy: 'token_aware' })}
              className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                isTokenAware
                  ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                  : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-gray-900 dark:text-white">
                  Token-Aware Scheduling (D07)
                </span>
                <span className="rounded bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 dark:text-blue-300">
                  Adaptive
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                Balances prompt length, generation tokens, and priority to maximize throughput and prevent starvation.
              </p>
            </div>

            <div
              onClick={() => setConfig({ ...config, policy: 'fifo' })}
              className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                !isTokenAware
                  ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                  : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-gray-900 dark:text-white">
                  FIFO (First-In First-Out)
                </span>
                <span className="rounded bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                  Baseline
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                Standard arrival-order dispatch without estimating token footprint or KV-cache utilization.
              </p>
            </div>
          </div>
        </div>

        {/* Token-Aware Weights */}
        <div
          className={`rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs ${
            !isTokenAware ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Cpu className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              Token Weights & Starvation Heuristics
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
                  Prompt Token Weight (α)
                </label>
                <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {config.token_aware_settings.prompt_tokens_weight}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.token_aware_settings.prompt_tokens_weight}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      prompt_tokens_weight: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
                  Generation Token Weight (β)
                </label>
                <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {config.token_aware_settings.generation_tokens_weight}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={config.token_aware_settings.generation_tokens_weight}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      generation_tokens_weight: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Priority Weight Multiplier (γ)
              </label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="5"
                value={config.token_aware_settings.priority_weight}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      priority_weight: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Aging Factor (λ)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={config.token_aware_settings.aging_factor}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      aging_factor: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Max Wait Threshold (sec)
              </label>
              <input
                type="number"
                min="1"
                max="120"
                value={config.token_aware_settings.max_waiting_time_sec}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      max_waiting_time_sec: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Scheduling Interval (ms)
              </label>
              <input
                type="number"
                min="5"
                max="500"
                value={config.token_aware_settings.scheduling_interval_ms}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    token_aware_settings: {
                      ...config.token_aware_settings,
                      scheduling_interval_ms: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Auto-Scaling Controller */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
                Cluster Auto-Scaler
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Auto-Scaling</span>
              <input
                type="checkbox"
                checked={config.scaling_config.auto_scaling_enabled}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      auto_scaling_enabled: e.target.checked,
                    },
                  })
                }
                className="h-3.5 w-3.5 rounded text-blue-600"
              />
            </div>
          </div>

          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 ${
              !config.scaling_config.auto_scaling_enabled ? 'opacity-40 pointer-events-none' : ''
            }`}
          >
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Min Instances
              </label>
              <input
                type="number"
                value={config.scaling_config.min_instances}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      min_instances: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Max Instances
              </label>
              <input
                type="number"
                value={config.scaling_config.max_instances}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      max_instances: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Scale-Up (%)
              </label>
              <input
                type="number"
                value={config.scaling_config.scale_up_threshold_pct}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      scale_up_threshold_pct: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Scale-Down (%)
              </label>
              <input
                type="number"
                value={config.scaling_config.scale_down_threshold_pct}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      scale_down_threshold_pct: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Cooldown (sec)
              </label>
              <input
                type="number"
                value={config.scaling_config.cooldown_period_sec}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scaling_config: {
                      ...config.scaling_config,
                      cooldown_period_sec: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            <Save className="h-3 w-3" />
            <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
