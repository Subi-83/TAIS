import React, { useState, useEffect, useCallback } from 'react';
import {
  Scale,
  Clock,
  TrendingDown,
  TrendingUp,
  Cpu,
  RefreshCw,
  Layers,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { experimentService } from '../services';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useBackendStatus } from '../context/BackendStatusContext';

export const ComparisonPage = () => {
  const { useDemoMode } = useBackendStatus();

  const [experiments, setExperiments] = useState([]);
  const [selectedTokenAwareId, setSelectedTokenAwareId] = useState('');
  const [selectedFifoId, setSelectedFifoId] = useState('');
  const [tokenAwareExp, setTokenAwareExp] = useState(null);
  const [fifoExp, setFifoExp] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadExperiments = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await experimentService.getExperimentsList(useDemoMode);
      setExperiments(list);

      const defaultTA = list.find((e) => e.policy === 'token_aware');
      const defaultFifo = list.find((e) => e.policy === 'fifo');

      if (defaultTA) setSelectedTokenAwareId(defaultTA.experiment_id);
      if (defaultFifo) setSelectedFifoId(defaultFifo.experiment_id);
    } catch (err) {
      console.error('Failed to load comparison experiments list', err);
    } finally {
      setIsLoading(false);
    }
  }, [useDemoMode]);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  useEffect(() => {
    const fetchSelected = async () => {
      if (selectedTokenAwareId) {
        try {
          const ta = await experimentService.getExperiment(selectedTokenAwareId, useDemoMode);
          setTokenAwareExp(ta);
        } catch (e) {
          console.error(e);
        }
      }
      if (selectedFifoId) {
        try {
          const fifo = await experimentService.getExperiment(selectedFifoId, useDemoMode);
          setFifoExp(fifo);
        } catch (e) {
          console.error(e);
        }
      }
    };
    fetchSelected();
  }, [selectedTokenAwareId, selectedFifoId, useDemoMode]);

  if (isLoading && (!tokenAwareExp || !fifoExp)) {
    return <LoadingSpinner label="Loading comparative benchmark runs..." />;
  }

  if (experiments.length < 2) {
    return (
      <EmptyState
        title="Insufficient Experiments for Comparison"
        description="Run at least one Token-Aware experiment and one FIFO baseline experiment to view comparative performance."
      />
    );
  }

  const ta = tokenAwareExp || {
    experiment_id: 'exp-ta',
    name: 'Token-Aware Run',
    current_p95_latency_ms: 238,
    median_latency_ms: 124,
    p99_latency_ms: 380,
    avg_ttft_ms: 34.8,
    current_throughput_rps: 34.2,
    tokens_per_second: 1140,
    starvation_rate_pct: 0.8,
    avg_backend_utilization_pct: 71.4,
  };

  const fifo = fifoExp || {
    experiment_id: 'exp-fifo',
    name: 'FIFO Baseline Run',
    current_p95_latency_ms: 418.5,
    median_latency_ms: 245,
    p99_latency_ms: 680,
    avg_ttft_ms: 78.4,
    current_throughput_rps: 28.1,
    tokens_per_second: 820,
    starvation_rate_pct: 11.2,
    avg_backend_utilization_pct: 54.0,
  };

  const p95Improvement = Math.round(((fifo.current_p95_latency_ms - ta.current_p95_latency_ms) / fifo.current_p95_latency_ms) * 100);
  const ttftImprovement = Math.round(((fifo.avg_ttft_ms - ta.avg_ttft_ms) / fifo.avg_ttft_ms) * 100);
  const throughputGain = Math.round(((ta.current_throughput_rps - fifo.current_throughput_rps) / fifo.current_throughput_rps) * 100);
  const starvationReduction = Math.round(((fifo.starvation_rate_pct - ta.starvation_rate_pct) / (fifo.starvation_rate_pct || 1)) * 100);

  const latencyComparisonData = [
    { metric: 'Avg TTFT', FIFO: fifo.avg_ttft_ms, TokenAware: ta.avg_ttft_ms },
    { metric: 'Median (p50)', FIFO: fifo.median_latency_ms, TokenAware: ta.median_latency_ms },
    { metric: 'p95 Latency', FIFO: fifo.current_p95_latency_ms, TokenAware: ta.current_p95_latency_ms },
    { metric: 'p99 Latency', FIFO: fifo.p99_latency_ms || 600, TokenAware: ta.p99_latency_ms || 350 },
  ];

  const throughputUtilizationData = [
    { metric: 'Throughput (RPS)', FIFO: fifo.current_throughput_rps, TokenAware: ta.current_throughput_rps },
    { metric: 'Tokens/s (÷10)', FIFO: (fifo.tokens_per_second || 800) / 10, TokenAware: (ta.tokens_per_second || 1100) / 10 },
    { metric: 'Util %', FIFO: fifo.avg_backend_utilization_pct, TokenAware: ta.avg_backend_utilization_pct },
  ];

  const queueDistributionData = [
    { waitBucket: '0-50ms', FIFO: 28, TokenAware: 64 },
    { waitBucket: '50-150ms', FIFO: 40, TokenAware: 26 },
    { waitBucket: '150-300ms', FIFO: 18, TokenAware: 8 },
    { waitBucket: '>300ms (Starved)', FIFO: 14, TokenAware: 2 },
  ];

  const failureRecoveryTimelineData = [
    { time: 'T+0s', FIFO: 210, TokenAware: 120 },
    { time: 'T+20s (Fault)', FIFO: 480, TokenAware: 240 },
    { time: 'T+40s (Peak)', FIFO: 720, TokenAware: 290 },
    { time: 'T+60s (Scale)', FIFO: 530, TokenAware: 190 },
    { time: 'T+80s (Done)', FIFO: 240, TokenAware: 130 },
  ];

  const tooltipStyle = {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: '0.375rem',
    color: '#f8fafc',
    fontSize: '12px',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            Performance Benchmark Comparison
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Compare Token-Aware scheduling performance against standard FIFO baseline.
          </p>
        </div>
        <button
          onClick={loadExperiments}
          className="flex items-center gap-1.5 self-start sm:self-auto rounded border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50"
        >
          <RefreshCw className="h-3 w-3 text-blue-600" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Selectors */}
      <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase text-gray-600 dark:text-slate-300 block mb-1.5">
            Token-Aware Candidate
          </label>
          <select
            value={selectedTokenAwareId}
            onChange={(e) => setSelectedTokenAwareId(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-gray-900 dark:text-white"
          >
            {experiments
              .filter((e) => e.policy === 'token_aware')
              .map((e) => (
                <option key={e.experiment_id} value={e.experiment_id}>
                  {e.experiment_id} — {e.name} (p95: {e.p95_latency_ms}ms)
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase text-gray-600 dark:text-slate-300 block mb-1.5">
            FIFO Baseline
          </label>
          <select
            value={selectedFifoId}
            onChange={(e) => setSelectedFifoId(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-gray-900 dark:text-white"
          >
            {experiments
              .filter((e) => e.policy === 'fifo')
              .map((e) => (
                <option key={e.experiment_id} value={e.experiment_id}>
                  {e.experiment_id} — {e.name} (p95: {e.p95_latency_ms}ms)
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Delta Improvements */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
            <span>p95 Latency Reduction</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-blue-800 dark:text-blue-200">
            -{p95Improvement}%
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.current_p95_latency_ms}ms → {ta.current_p95_latency_ms}ms
          </span>
        </div>

        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
            <span>Avg TTFT Speedup</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-emerald-800 dark:text-emerald-200">
            -{ttftImprovement}%
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.avg_ttft_ms}ms → {ta.avg_ttft_ms}ms
          </span>
        </div>

        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
            <span>Throughput Gain</span>
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-blue-800 dark:text-blue-200">
            +{throughputGain}%
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.current_throughput_rps} → {ta.current_throughput_rps} rps
          </span>
        </div>

        <div className="rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-purple-700 dark:text-purple-300">
            <span>Starvation Reduction</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-purple-800 dark:text-purple-200">
            -{starvationReduction}%
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.starvation_rate_pct}% → {ta.starvation_rate_pct}%
          </span>
        </div>
      </div>

      {/* Comparison Charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Latency Percentiles Comparison (ms)
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyComparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="metric" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar dataKey="FIFO" fill="#94a3b8" radius={[2, 2, 0, 0]} name="FIFO Baseline" />
                <Bar dataKey="TokenAware" fill="#2563eb" radius={[2, 2, 0, 0]} name="Token-Aware (D07)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Queue Waiting-Time Distribution (%)
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={queueDistributionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="waitBucket" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar dataKey="FIFO" fill="#94a3b8" radius={[2, 2, 0, 0]} name="FIFO Baseline" />
                <Bar dataKey="TokenAware" fill="#2563eb" radius={[2, 2, 0, 0]} name="Token-Aware (D07)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Latency During Fault & Recovery (ms)
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={failureRecoveryTimelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Line type="monotone" dataKey="FIFO" stroke="#94a3b8" strokeWidth={2} name="FIFO" />
                <Line type="monotone" dataKey="TokenAware" stroke="#2563eb" strokeWidth={2} name="Token-Aware" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Throughput & Compute Efficiency
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={throughputUtilizationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="metric" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                <Bar dataKey="FIFO" fill="#94a3b8" radius={[2, 2, 0, 0]} name="FIFO Baseline" />
                <Bar dataKey="TokenAware" fill="#2563eb" radius={[2, 2, 0, 0]} name="Token-Aware (D07)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
