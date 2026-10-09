import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  RotateCcw,
  Sliders,
  CheckCircle2,
  Server,
  Zap,
  Cpu,
  Layers,
  ShieldAlert,
  HelpCircle,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import { experimentService } from '../services';
import { useBackendStatus } from '../context/BackendStatusContext';
import { AlertBanner } from '../components/common/AlertBanner';

const PROFILE_PRESETS = [
  {
    id: 'short_interactive',
    title: 'Short Interactive',
    badge: 'Chat / Fast',
    description: 'High concurrency, small input & output token spans.',
    icon: <Zap className="h-4 w-4 text-blue-600" />,
    config: {
      request_count: 1000,
      min_input_tokens: 16,
      max_input_tokens: 64,
      min_output_tokens: 32,
      max_output_tokens: 128,
      arrival_rate: 50,
      priority_distribution: { low: 60, medium: 30, high: 10 },
      latency_target_ms: 150,
      initial_backend_count: 3,
      min_backends: 2,
      max_backends: 6,
      max_concurrency_per_backend: 32,
      queue_capacity: 500,
      scheduling_policy: 'token_aware',
    },
  },
  {
    id: 'long_generation',
    title: 'Long Generation',
    badge: 'Code / Docs',
    description: 'Large prompt context and extended token generation.',
    icon: <Cpu className="h-4 w-4 text-purple-600" />,
    config: {
      request_count: 300,
      min_input_tokens: 512,
      max_input_tokens: 2048,
      min_output_tokens: 1024,
      max_output_tokens: 4096,
      arrival_rate: 10,
      priority_distribution: { low: 30, medium: 40, high: 30 },
      latency_target_ms: 900,
      initial_backend_count: 4,
      min_backends: 3,
      max_backends: 8,
      max_concurrency_per_backend: 16,
      queue_capacity: 250,
      scheduling_policy: 'token_aware',
    },
  },
  {
    id: 'mixed_workload',
    title: 'Mixed Workload',
    badge: 'Production',
    description: 'Heterogeneous mix of short chat prompts and deep reasoning.',
    icon: <Layers className="h-4 w-4 text-indigo-600" />,
    config: {
      request_count: 600,
      min_input_tokens: 32,
      max_input_tokens: 1536,
      min_output_tokens: 64,
      max_output_tokens: 2048,
      arrival_rate: 30,
      priority_distribution: { low: 45, medium: 35, high: 20 },
      latency_target_ms: 400,
      initial_backend_count: 3,
      min_backends: 2,
      max_backends: 6,
      max_concurrency_per_backend: 24,
      queue_capacity: 400,
      scheduling_policy: 'token_aware',
    },
  },
  {
    id: 'burst_workload',
    title: 'Burst Workload',
    badge: 'Spike Traffic',
    description: 'Sudden high arrival surge with simulated backend slowdown.',
    icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
    config: {
      request_count: 800,
      min_input_tokens: 64,
      max_input_tokens: 512,
      min_output_tokens: 64,
      max_output_tokens: 512,
      arrival_rate: 75,
      priority_distribution: { low: 40, medium: 40, high: 20 },
      latency_target_ms: 450,
      initial_backend_count: 3,
      min_backends: 2,
      max_backends: 6,
      max_concurrency_per_backend: 32,
      queue_capacity: 600,
      scheduling_policy: 'token_aware',
      slowdown_config: {
        enabled: true,
        backend_id: 'backend-vllm-03',
        slowdown_ms: 150,
        start_after_sec: 20,
        duration_sec: 60,
      },
    },
  },
  {
    id: 'custom',
    title: 'Custom Workload',
    badge: 'Manual',
    description: 'Custom token lengths, arrival characteristics, and limits.',
    icon: <Sliders className="h-4 w-4 text-gray-500" />,
    config: {},
  },
];

const DEFAULT_CONFIG = {
  profile: 'short_interactive',
  name: 'Short Interactive Inference Benchmark',
  request_count: 1000,
  min_input_tokens: 16,
  max_input_tokens: 64,
  min_output_tokens: 32,
  max_output_tokens: 128,
  arrival_rate: 50,
  priority_distribution: { low: 60, medium: 30, high: 10 },
  random_seed: 42,
  initial_backend_count: 3,
  min_backends: 2,
  max_backends: 6,
  max_concurrency_per_backend: 32,
  queue_capacity: 500,
  scheduling_policy: 'token_aware',
  latency_target_ms: 150,
  slowdown_config: {
    enabled: false,
    backend_id: 'backend-vllm-02',
    slowdown_ms: 100,
    start_after_sec: 15,
    duration_sec: 45,
  },
  failure_config: {
    enabled: false,
    backend_id: 'backend-vllm-03',
    fail_after_sec: 30,
    duration_sec: 30,
  },
};

export const WorkloadTestingPage = () => {
  const navigate = useNavigate();
  const { useDemoMode, setActiveExperimentId } = useBackendStatus();

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedProfile, setSelectedProfile] = useState('short_interactive');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const handleSelectProfile = (preset) => {
    setSelectedProfile(preset.id);
    if (preset.id === 'custom') {
      setConfig((prev) => ({ ...prev, profile: 'custom' }));
      return;
    }
    setConfig((prev) => ({
      ...prev,
      profile: preset.id,
      name: `${preset.title} Benchmark Run`,
      ...preset.config,
    }));
    setErrors({});
  };

  const validate = () => {
    const errs = {};

    if (!config.request_count || config.request_count <= 0) {
      errs.request_count = 'Must be > 0';
    } else if (config.request_count > 50000) {
      errs.request_count = 'Cannot exceed 50,000';
    }

    if (config.min_input_tokens <= 0) errs.min_input_tokens = 'Min tokens >= 1';
    if (config.max_input_tokens < config.min_input_tokens) errs.max_input_tokens = 'Max cannot be < min';

    if (config.min_output_tokens <= 0) errs.min_output_tokens = 'Min tokens >= 1';
    if (config.max_output_tokens < config.min_output_tokens) errs.max_output_tokens = 'Max cannot be < min';

    if (config.arrival_rate <= 0) errs.arrival_rate = 'Must be > 0';

    const priorityTotal =
      Number(config.priority_distribution.low) +
      Number(config.priority_distribution.medium) +
      Number(config.priority_distribution.high);
    if (Math.round(priorityTotal) !== 100) {
      errs.priority_distribution = `Priorities must sum to 100% (currently ${priorityTotal}%)`;
    }

    if (config.min_backends < 1) errs.min_backends = 'Min backends >= 1';
    if (config.max_backends < config.min_backends) errs.max_backends = 'Max cannot be < min';
    if (
      config.initial_backend_count < config.min_backends ||
      config.initial_backend_count > config.max_backends
    ) {
      errs.initial_backend_count = `Must be between ${config.min_backends} and ${config.max_backends}`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleStartExperiment = async (e) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    setSubmissionProgress('Submitting to scheduler...');

    try {
      const result = await experimentService.createExperiment(config, useDemoMode);
      setActiveExperimentId(result.experiment_id);
      setTimeout(() => {
        navigate(`/monitor?id=${result.experiment_id}`);
      }, 500);
    } catch (err) {
      setServerError(err?.message || 'Failed to initialize experiment');
      setIsSubmitting(false);
      setSubmissionProgress(null);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setSelectedProfile('short_interactive');
    setErrors({});
    setServerError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
          Workload Testing & Profiling Engine
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Configure synthetic request arrivals, set backend scaling bounds, inject faults, and evaluate scheduling efficiency.
        </p>
      </div>

      {serverError && (
        <AlertBanner
          type="error"
          title="Experiment Error"
          message={serverError}
          onClose={() => setServerError(null)}
        />
      )}

      {/* Profile Presets Selector */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
          Select Workload Profile Preset
        </label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {PROFILE_PRESETS.map((preset) => {
            const isSelected = selectedProfile === preset.id;
            return (
              <div
                key={preset.id}
                onClick={() => handleSelectProfile(preset)}
                className={`cursor-pointer rounded-lg border p-3.5 transition-colors ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="rounded p-1 bg-gray-50 dark:bg-slate-800">
                    {preset.icon}
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <h3 className="font-semibold text-xs text-gray-900 dark:text-white">
                  {preset.title}
                </h3>
                <span className="text-[10px] text-gray-500 dark:text-slate-400 block mt-0.5">
                  {preset.badge}
                </span>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400 line-clamp-2">
                  {preset.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Configuration Form */}
      <form onSubmit={handleStartExperiment} className="space-y-5">
        {/* Section 1: Identification & Policy */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Sliders className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              1. Experiment Identification & Policy
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Benchmark Name
              </label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Scheduling Policy
              </label>
              <select
                value={config.scheduling_policy}
                onChange={(e) => setConfig({ ...config, scheduling_policy: e.target.value })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              >
                <option value="token_aware">Token-Aware Scheduling (D07)</option>
                <option value="fifo">FIFO Baseline</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Tokens & Traffic */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Zap className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              2. Token Distribution & Request Traffic
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Total Request Count
              </label>
              <input
                type="number"
                min="1"
                max="50000"
                value={config.request_count}
                onChange={(e) => setConfig({ ...config, request_count: Number(e.target.value) })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              />
              {errors.request_count && <p className="mt-1 text-[11px] text-rose-500">{errors.request_count}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Arrival Rate (req/s)
              </label>
              <input
                type="number"
                min="1"
                value={config.arrival_rate}
                onChange={(e) => setConfig({ ...config, arrival_rate: Number(e.target.value) })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              />
              {errors.arrival_rate && <p className="mt-1 text-[11px] text-rose-500">{errors.arrival_rate}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Input Tokens (Min / Max)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  value={config.min_input_tokens}
                  onChange={(e) => setConfig({ ...config, min_input_tokens: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  min="1"
                  value={config.max_input_tokens}
                  onChange={(e) => setConfig({ ...config, max_input_tokens: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Output Tokens (Min / Max)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  value={config.min_output_tokens}
                  onChange={(e) => setConfig({ ...config, min_output_tokens: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  min="1"
                  value={config.max_output_tokens}
                  onChange={(e) => setConfig({ ...config, max_output_tokens: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {/* Priority distribution */}
          <div className="mt-4 border-t border-gray-200 dark:border-slate-800 pt-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
                Priority Distribution (% Low, % Med, % High)
              </label>
              <span className="text-[11px] text-gray-500 font-mono">
                Total: {Number(config.priority_distribution.low) + Number(config.priority_distribution.medium) + Number(config.priority_distribution.high)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] text-gray-500 block">Low %</span>
                <input
                  type="number"
                  value={config.priority_distribution.low}
                  onChange={(e) => setConfig({ ...config, priority_distribution: { ...config.priority_distribution, low: Number(e.target.value) } })}
                  className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block">Med %</span>
                <input
                  type="number"
                  value={config.priority_distribution.medium}
                  onChange={(e) => setConfig({ ...config, priority_distribution: { ...config.priority_distribution, medium: Number(e.target.value) } })}
                  className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block">High %</span>
                <input
                  type="number"
                  value={config.priority_distribution.high}
                  onChange={(e) => setConfig({ ...config, priority_distribution: { ...config.priority_distribution, high: Number(e.target.value) } })}
                  className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-mono"
                />
              </div>
            </div>
            {errors.priority_distribution && (
              <p className="mt-1 text-[11px] text-rose-500">{errors.priority_distribution}</p>
            )}
          </div>
        </div>

        {/* Section 3: Capacity Bounds */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <Server className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              3. Backend Capacity Limits & SLA Targets
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Initial Backend Count
              </label>
              <input
                type="number"
                min="1"
                value={config.initial_backend_count}
                onChange={(e) => setConfig({ ...config, initial_backend_count: Number(e.target.value) })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Min / Max Replicas
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={config.min_backends}
                  onChange={(e) => setConfig({ ...config, min_backends: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  value={config.max_backends}
                  onChange={(e) => setConfig({ ...config, max_backends: Number(e.target.value) })}
                  className="w-1/2 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Queue Capacity
              </label>
              <input
                type="number"
                value={config.queue_capacity}
                onChange={(e) => setConfig({ ...config, queue_capacity: Number(e.target.value) })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Target SLA (ms)
              </label>
              <input
                type="number"
                value={config.latency_target_ms}
                onChange={(e) => setConfig({ ...config, latency_target_ms: Number(e.target.value) })}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Fault Injection */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-slate-800 pb-3 mb-4">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              4. Optional Failure & Slowdown Injection
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-gray-200 dark:border-slate-800 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-800 dark:text-slate-200">
                  Backend Slowdown Delay
                </span>
                <input
                  type="checkbox"
                  checked={config.slowdown_config.enabled}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      slowdown_config: { ...config.slowdown_config, enabled: e.target.checked },
                    })
                  }
                  className="h-3.5 w-3.5 rounded text-blue-600"
                />
              </div>
              {config.slowdown_config.enabled && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <input
                    type="number"
                    value={config.slowdown_config.slowdown_ms}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        slowdown_config: { ...config.slowdown_config, slowdown_ms: Number(e.target.value) },
                      })
                    }
                    placeholder="Delay ms"
                    className="w-24 rounded border border-gray-300 dark:border-slate-700 px-2 py-1 font-mono text-xs"
                  />
                  <span className="text-gray-400">ms delay</span>
                </div>
              )}
            </div>

            <div className="border border-gray-200 dark:border-slate-800 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-800 dark:text-slate-200">
                  Worker Crash Simulation
                </span>
                <input
                  type="checkbox"
                  checked={config.failure_config.enabled}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      failure_config: { ...config.failure_config, enabled: e.target.checked },
                    })
                  }
                  className="h-3.5 w-3.5 rounded text-blue-600"
                />
              </div>
              {config.failure_config.enabled && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <input
                    type="number"
                    value={config.failure_config.fail_after_sec}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        failure_config: { ...config.failure_config, fail_after_sec: Number(e.target.value) },
                      })
                    }
                    placeholder="Fail after sec"
                    className="w-24 rounded border border-gray-300 dark:border-slate-700 px-2 py-1 font-mono text-xs"
                  />
                  <span className="text-gray-400">sec until fail</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">RNG Seed:</span>
            <input
              type="number"
              value={config.random_seed || ''}
              onChange={(e) => setConfig({ ...config, random_seed: Number(e.target.value) })}
              className="w-20 rounded border border-gray-300 dark:border-slate-700 px-2 py-1 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-750"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 active:bg-blue-700"
            >
              <Play className="h-3.5 w-3.5 fill-white" />
              <span>{isSubmitting ? (submissionProgress || 'Starting...') : 'Start Experiment'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
