import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const { useDemoMode } = useBackendStatus();

  const [experiments, setExperiments] = useState([]);
  const [selectedTokenAwareId, setSelectedTokenAwareId] = useState('');
  const [selectedFifoId, setSelectedFifoId] = useState('');
  const [tokenAwareExp, setTokenAwareExp] = useState(null);
  const [fifoExp, setFifoExp] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [faultObservations, setFaultObservations] = useState([]);

  const loadExperiments = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await experimentService.getExperimentsList(useDemoMode);
      setExperiments(list);
      const faultData = await experimentService.getFaultRecoveryLatest(useDemoMode);
      setFaultObservations(faultData.observations || []);

      const requestedTA = searchParams.get('token');
      const requestedFifo = searchParams.get('fifo');
      const defaultTA = list.find((e) => e.experiment_id === requestedTA) || list.find((e) => e.policy === 'token_aware');
      const defaultFifo = list.find((e) => e.experiment_id === requestedFifo) || list.find((e) => e.policy === 'fifo');

      if (defaultTA) setSelectedTokenAwareId(defaultTA.experiment_id);
      if (defaultFifo) setSelectedFifoId(defaultFifo.experiment_id);
    } catch (err) {
      console.error('Failed to load comparison experiments list', err);
    } finally {
      setIsLoading(false);
    }
  }, [useDemoMode, searchParams]);

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

  if (!tokenAwareExp || !fifoExp) {
    return <LoadingSpinner label="Loading selected benchmark measurements..." />;
  }

  const ta = tokenAwareExp;
  const fifo = fifoExp;

  const percentChange = (baseline, candidate, higherIsBetter = false) => {
    const base = Number(baseline);
    const next = Number(candidate);
    if (!Number.isFinite(base) || !Number.isFinite(next) || base === 0) return null;
    return Math.round(((higherIsBetter ? next - base : base - next) / base) * 100);
  };
  const p95Improvement = percentChange(fifo.current_p95_latency_ms, ta.current_p95_latency_ms);
  const avgLatencyImprovement = percentChange(fifo.current_avg_latency_ms, ta.current_avg_latency_ms);
  const ttftImprovement = percentChange(fifo.avg_ttft_ms, ta.avg_ttft_ms);
  const throughputGain = percentChange(fifo.current_throughput_rps, ta.current_throughput_rps, true);
  const starvationReduction = percentChange(fifo.starvation_rate_pct, ta.starvation_rate_pct);

  const latencyComparisonData = [
    { metric: 'Average Latency', FIFO: fifo.current_avg_latency_ms, TokenAware: ta.current_avg_latency_ms },
    { metric: 'Avg TTFT', FIFO: fifo.avg_ttft_ms, TokenAware: ta.avg_ttft_ms },
    { metric: 'Median (p50)', FIFO: fifo.median_latency_ms, TokenAware: ta.median_latency_ms },
    { metric: 'p95 Latency', FIFO: fifo.current_p95_latency_ms, TokenAware: ta.current_p95_latency_ms },
    { metric: 'p99 Latency', FIFO: fifo.p99_latency_ms ?? 0, TokenAware: ta.p99_latency_ms ?? 0 },
  ];

  const throughputUtilizationData = [
    { metric: 'Throughput (RPS)', FIFO: fifo.current_throughput_rps, TokenAware: ta.current_throughput_rps },
    { metric: 'Tokens/s (÷10)', FIFO: (fifo.tokens_per_second ?? 0) / 10, TokenAware: (ta.tokens_per_second ?? 0) / 10 },
    { metric: 'Util %', FIFO: fifo.avg_backend_utilization_pct, TokenAware: ta.avg_backend_utilization_pct },
  ];

  const starvationThreshold = fifo.starvation_threshold_ms || 2000;
  const queueDistributionData = [
    { waitBucket: '0-50ms', FIFO: fifo.queue_wait_distribution_pct?.under_50 ?? 0, TokenAware: ta.queue_wait_distribution_pct?.under_50 ?? 0 },
    { waitBucket: '50-150ms', FIFO: fifo.queue_wait_distribution_pct?.['50_to_150'] ?? 0, TokenAware: ta.queue_wait_distribution_pct?.['50_to_150'] ?? 0 },
    { waitBucket: `150-${starvationThreshold}ms`, FIFO: fifo.queue_wait_distribution_pct?.['150_to_threshold'] ?? 0, TokenAware: ta.queue_wait_distribution_pct?.['150_to_threshold'] ?? 0 },
    { waitBucket: `>${starvationThreshold}ms (Starved)`, FIFO: fifo.queue_wait_distribution_pct?.over_threshold ?? 0, TokenAware: ta.queue_wait_distribution_pct?.over_threshold ?? 0 },
  ];

  const failureRecoveryTimelineData = [...new Set(faultObservations.map((item) => item.phase_order))]
    .sort((a, b) => a - b)
    .map((order) => {
      const rows = faultObservations.filter((item) => item.phase_order === order);
      const fifoRow = rows.find((item) => item.policy === 'fifo');
      const tokenRow = rows.find((item) => item.policy === 'token_aware');
      return {
        time: (fifoRow || tokenRow)?.phase?.replaceAll('_', ' ') || `Phase ${order + 1}`,
        FIFO: fifoRow?.average_latency_ms ?? null,
        TokenAware: tokenRow?.average_latency_ms ?? null,
      };
    });

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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <div className="rounded-lg border border-cyan-200 dark:border-cyan-900 bg-cyan-50/50 dark:bg-cyan-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-cyan-700 dark:text-cyan-300">
            <span>Average Latency Change</span>
            <Clock className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-cyan-800 dark:text-cyan-200">
            {avgLatencyImprovement === null ? 'N/A' : `${avgLatencyImprovement >= 0 ? 'Reduction' : 'Regression'} ${Math.abs(avgLatencyImprovement)}%`}
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {Number(fifo.current_avg_latency_ms).toFixed(1)}ms to {Number(ta.current_avg_latency_ms).toFixed(1)}ms
          </span>
        </div>
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
            <span>p95 Latency Change</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-blue-800 dark:text-blue-200">
            {p95Improvement === null ? 'N/A' : `${p95Improvement >= 0 ? 'Reduction' : 'Regression'} ${Math.abs(p95Improvement)}%`}
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.current_p95_latency_ms}ms → {ta.current_p95_latency_ms}ms
          </span>
        </div>

        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
            <span>Avg TTFT Change</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-emerald-800 dark:text-emerald-200">
            {ttftImprovement === null ? 'N/A' : `${ttftImprovement >= 0 ? 'Reduction' : 'Regression'} ${Math.abs(ttftImprovement)}%`}
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.avg_ttft_ms}ms → {ta.avg_ttft_ms}ms
          </span>
        </div>

        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
            <span>Throughput Change</span>
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-blue-800 dark:text-blue-200">
            {throughputGain === null ? 'N/A' : `${throughputGain >= 0 ? 'Gain' : 'Regression'} ${Math.abs(throughputGain)}%`}
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {fifo.current_throughput_rps} → {ta.current_throughput_rps} rps
          </span>
        </div>

        <div className="rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/30 p-3.5">
          <div className="flex items-center justify-between text-xs text-purple-700 dark:text-purple-300">
            <span>Starvation Change</span>
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-purple-800 dark:text-purple-200">
            {starvationReduction === null ? 'N/A' : `${starvationReduction >= 0 ? 'Reduction' : 'Regression'} ${Math.abs(starvationReduction)}%`}
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
            Completion Latency and TTFT Comparison (ms)
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
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-[10px] dark:border-slate-800">
            <div><span className="text-gray-500">Avg wait</span><div className="font-mono">{Number(fifo.average_queue_wait_ms ?? 0).toFixed(1)} / {Number(ta.average_queue_wait_ms ?? 0).toFixed(1)} ms</div></div>
            <div><span className="text-gray-500">P95 wait</span><div className="font-mono">{Number(fifo.p95_queue_wait_ms ?? 0).toFixed(1)} / {Number(ta.p95_queue_wait_ms ?? 0).toFixed(1)} ms</div></div>
            <div><span className="text-gray-500">Max wait</span><div className="font-mono">{Number(fifo.max_queue_wait_ms ?? 0).toFixed(1)} / {Number(ta.max_queue_wait_ms ?? 0).toFixed(1)} ms</div></div>
            <div><span className="text-gray-500">Over 300 ms</span><div className="font-mono">{fifo.over_300ms_rate_pct ?? 'N/A'}% / {ta.over_300ms_rate_pct ?? 'N/A'}%</div></div>
            <div><span className="text-gray-500">Starved &gt; {starvationThreshold} ms</span><div className="font-mono">{fifo.starvation_rate_pct}% / {ta.starvation_rate_pct}%</div></div>
            <div><span className="text-gray-500">Overdue dispatched</span><div className="font-mono">{fifo.overdue_dispatched ?? 0} / {ta.overdue_dispatched ?? 0}</div></div>
            <div><span className="text-gray-500">Max bypass</span><div className="font-mono">{fifo.max_bypass ?? 0} / {ta.max_bypass ?? 0}</div></div>
            <div><span className="text-gray-500">Fairness starvation</span><div className="font-mono">{fifo.fairness_starvation_rate_pct ?? 'N/A'}% / {ta.fairness_starvation_rate_pct ?? 'N/A'}%</div></div>
            <div><span className="text-gray-500">Jain fairness</span><div className="font-mono">{fifo.jain_fairness_on_slowdown == null ? 'N/A' : Number(fifo.jain_fairness_on_slowdown).toFixed(3)} / {ta.jain_fairness_on_slowdown == null ? 'N/A' : Number(ta.jain_fairness_on_slowdown).toFixed(3)}</div></div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white mb-3">
            Latency During Fault & Recovery (ms)
          </h3>
          {failureRecoveryTimelineData.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-center text-xs text-gray-500 dark:text-slate-400">No persisted fault-and-recovery run is available.</div>
          ) : <div className="h-56 w-full">
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
          </div>}
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
