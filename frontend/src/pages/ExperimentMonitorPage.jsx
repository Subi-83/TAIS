import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  Layers,
  Clock,
  StopCircle,
  Zap,
  Server,
  Filter,
  Search,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { experimentService } from '../services';
import { MetricCard } from '../components/common/MetricCard';
import { StatusBadge } from '../components/common/StatusBadge';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { AlertBanner } from '../components/common/AlertBanner';
import { useBackendStatus } from '../context/BackendStatusContext';

export const ExperimentMonitorPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { useDemoMode, activeExperimentId, setActiveExperimentId, streamBufferSize } = useBackendStatus();

  const experimentIdParam = searchParams.get('id') || activeExperimentId;

  const [experiment, setExperiment] = useState(null);
  const [pairedExperiment, setPairedExperiment] = useState(null);
  const [requests, setRequests] = useState([]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isStreaming, setIsStreaming] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const loadExperiment = useCallback(async () => {
    if (!experimentIdParam) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await experimentService.getExperiment(experimentIdParam, useDemoMode);
      setExperiment(data);
      if (data.paired_experiment_id) {
        try {
          setPairedExperiment(await experimentService.getExperiment(data.paired_experiment_id, useDemoMode));
        } catch {
          setPairedExperiment(null);
        }
      }
      if (data.recent_requests) setRequests(data.recent_requests);
      if (data.recent_events) setTimelineEvents(data.recent_events);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to load experiment status');
    } finally {
      setIsLoading(false);
    }
  }, [experimentIdParam, useDemoMode]);

  useEffect(() => {
    loadExperiment();
  }, [loadExperiment]);

  // Keep aggregate cards synchronized with the gateway while SSE updates rows.
  useEffect(() => {
    if (!experimentIdParam || useDemoMode) return;
    const interval = setInterval(async () => {
      try {
        const data = await experimentService.getExperiment(experimentIdParam, false);
        setExperiment(data);
        if (data.paired_experiment_id) {
          setPairedExperiment(await experimentService.getExperiment(data.paired_experiment_id, false));
        }
      } catch {
        // The normal page-level error flow handles persistent connection errors.
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [experimentIdParam, useDemoMode]);

  // Subscribe to SSE stream
  useEffect(() => {
    if (!experimentIdParam || !isStreaming || (experiment && ['completed', 'failed', 'cancelled'].includes(experiment.status))) return;

    const cleanup = experimentService.subscribeToEvents(
      experimentIdParam,
      (newEvent) => {
        setTimelineEvents((prev) => prev.some((event) => event.id === newEvent.id) ? prev : [newEvent, ...prev.slice(0, streamBufferSize - 1)]);
      },
      (updatedRequest) => {
        setRequests((prev) => {
          const index = prev.findIndex((r) => r.request_id === updatedRequest.request_id);
          if (index >= 0) {
            const copy = [...prev];
            copy[index] = { ...copy[index], ...updatedRequest };
            return copy;
          }
          return [updatedRequest, ...prev.slice(0, streamBufferSize - 1)];
        });
      },
      (err) => {
        console.warn('SSE stream error', err);
      },
      useDemoMode
    );

    return () => cleanup();
  }, [experimentIdParam, isStreaming, useDemoMode, streamBufferSize, experiment?.status]);

  const handleConfirmCancel = async () => {
    if (!experiment) return;
    setIsCancelling(true);
    try {
      await experimentService.cancelExperiment(experiment.experiment_id, useDemoMode);
      setExperiment((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
      setActiveExperimentId(null);
      setShowCancelModal(false);
    } catch (err) {
      setError(err?.message || 'Failed to cancel experiment');
    } finally {
      setIsCancelling(false);
    }
  };

  const filteredRequests = requests.filter((req) => {
    const matchesSearch =
      req.request_id.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (req.assigned_backend && req.assigned_backend.toLowerCase().includes(searchFilter.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading && !experiment) {
    return <LoadingSpinner label="Connecting to telemetry stream..." />;
  }

  if (error && !experiment) {
    return (
      <div className="space-y-5">
        <AlertBanner type="error" title="Telemetry Offline" message={error} />
        <EmptyState
          title="No Active Experiment Found"
          description={`Experiment ID "${experimentIdParam}" could not be loaded.`}
          actionText="Create New Experiment"
          onAction={() => navigate('/workload')}
        />
      </div>
    );
  }

  if (!experiment) {
    return (
      <EmptyState
        title="No Experiment Selected"
        description="Select or launch a workload benchmark to monitor real-time requests."
        actionText="Launch Workload"
        onAction={() => navigate('/workload')}
      />
    );
  }

  const formatElapsed = (sec) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const fifoExperiment = experiment.pair_role === 'fifo' ? experiment : pairedExperiment;
  const d07Experiment = experiment.pair_role === 'token_aware' ? experiment : pairedExperiment;
  const pairCards = [
    { label: 'FIFO Baseline', item: fifoExperiment, color: 'gray' },
    { label: 'D07 Token-Aware', item: d07Experiment, color: 'blue' },
  ];

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                {experiment.experiment_id}
              </span>
              <StatusBadge status={experiment.status} size="sm" />
              <StatusBadge status={experiment.policy} size="sm" />
            </div>
            <h2 className="mt-1 text-base font-bold text-gray-900 dark:text-white">
              {experiment.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
              <span className="flex items-center gap-1 font-mono">
                <Clock className="h-3 w-3" /> Elapsed: {formatElapsed(experiment.elapsed_seconds)}
              </span>
              <span>•</span>
              <span>SLA Target: {experiment.config?.latency_target_ms}ms</span>
              <span>•</span>
              <span>Profile: {experiment.config?.profile}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {experiment.paired_experiment_id && (
              <>
                <button
                  onClick={() => navigate(`/monitor?id=${experiment.paired_experiment_id}`)}
                  className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700"
                >
                  View {experiment.pair_role === 'fifo' ? 'D07' : 'FIFO'}
                </button>
                <button
                  onClick={() => navigate(`/comparison?fifo=${experiment.pair_role === 'fifo' ? experiment.experiment_id : experiment.paired_experiment_id}&token=${experiment.pair_role === 'token_aware' ? experiment.experiment_id : experiment.paired_experiment_id}`)}
                  className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white"
                >
                  Compare Results
                </button>
              </>
            )}
            <button
              onClick={() => setIsStreaming(!isStreaming)}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium ${
                isStreaming
                  ? 'border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                  : 'border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
              }`}
            >
              <Radio className={`h-3 w-3 ${isStreaming ? 'animate-pulse text-emerald-600' : ''}`} />
              <span>{isStreaming ? 'Streaming' : 'Paused'}</span>
            </button>

            <button
              onClick={() => loadExperiment()}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-slate-300"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Refreshing…' : 'Refresh'}</span>
            </button>
            {lastRefreshed && <span className="text-[10px] text-gray-400">{lastRefreshed.toLocaleTimeString()}</span>}

            {experiment.status === 'running' && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
              >
                <StopCircle className="h-3 w-3" />
                <span>Cancel</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {experiment.paired_experiment_id && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pairCards.map(({ label, item, color }) => (
            <button
              key={label}
              type="button"
              disabled={!item}
              onClick={() => item && navigate(`/monitor?id=${item.experiment_id}`)}
              className={`rounded-lg border p-4 text-left shadow-2xs transition hover:-translate-y-0.5 ${color === 'blue' ? 'border-blue-300 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20' : 'border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-900'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white">{label}</div>
                  <div className="mt-0.5 max-w-[420px] truncate font-mono text-[10px] text-gray-500">{item?.experiment_id || 'Preparing paired run…'}</div>
                </div>
                {item && <StatusBadge status={item.status} size="sm" />}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs sm:grid-cols-6">
                <div><div className="text-gray-500">Submitted</div><div className="mt-1 font-mono font-bold">{item?.total_requests ?? '—'}</div></div>
                <div><div className="text-gray-500">Queued</div><div className="mt-1 font-mono font-bold">{item?.queued_requests ?? '—'}</div></div>
                <div><div className="text-gray-500">Completed</div><div className="mt-1 font-mono font-bold">{item?.completed_requests ?? '—'}</div></div>
                <div><div className="text-gray-500">Avg Latency</div><div className="mt-1 font-mono font-bold">{item ? `${Number(item.current_avg_latency_ms || 0).toFixed(0)}ms` : '—'}</div></div>
                <div><div className="text-gray-500">Avg TTFT</div><div className="mt-1 font-mono font-bold">{item ? `${Number(item.avg_ttft_ms || 0).toFixed(0)}ms` : '—'}</div></div>
                <div><div className="text-gray-500">Throughput</div><div className="mt-1 font-mono font-bold">{item ? `${Number(item.current_throughput_rps || 0).toFixed(2)}/s` : '—'}</div></div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          title="Submitted"
          value={experiment.total_requests}
          unit="req"
          icon={<Layers className="h-4 w-4 text-blue-600" />}
        />
        <MetricCard
          title="Queued"
          value={experiment.queued_requests}
          unit="req"
          variant={experiment.queued_requests > 50 ? 'warning' : 'default'}
          icon={<Clock className="h-4 w-4 text-indigo-500" />}
        />
        <MetricCard
          title="Completed"
          value={experiment.completed_requests}
          subtext={`${experiment.failed_requests} failed`}
          icon={<Zap className="h-4 w-4 text-emerald-600" />}
        />
        <MetricCard
          title="Throughput"
          value={Number(experiment.current_throughput_rps || 0).toFixed(1)}
          unit="req/s"
          icon={<Activity className="h-4 w-4 text-teal-600" />}
        />
        <MetricCard
          title="Average Latency"
          value={Number(experiment.current_avg_latency_ms || 0).toFixed(0)}
          unit="ms"
          subtext={`Avg TTFT: ${Number(experiment.avg_ttft_ms || 0).toFixed(1)}ms`}
          icon={<Clock className="h-4 w-4 text-amber-500" />}
        />
        <MetricCard
          title="Active Workers"
          value={experiment.active_backends}
          unit="replicas"
          subtext={`Util: ${Number(experiment.avg_backend_utilization_pct || 0).toFixed(0)}%`}
          icon={<Server className="h-4 w-4 text-purple-600" />}
        />
      </div>

      {/* Live Table and Event Timeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Table (2 cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              Live Request Buffer ({filteredRequests.length})
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter by Req ID..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-2.5 py-1 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-gray-700 dark:text-slate-300 focus:outline-hidden"
              >
                <option value="all">All</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400 font-mono text-[11px]">
                <tr>
                  <th className="py-2.5 px-3">Request ID</th>
                  <th className="py-2.5 px-2.5">Tokens (In/Out)</th>
                  <th className="py-2.5 px-2.5">Cost / Score</th>
                  <th className="py-2.5 px-2.5">Priority</th>
                  <th className="py-2.5 px-2.5">Status</th>
                  <th className="py-2.5 px-2.5">Backend</th>
                  <th className="py-2.5 px-2.5">TTFT</th>
                  <th className="py-2.5 px-3">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/80 font-mono text-xs">
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-gray-400 text-xs">
                      No matching requests in current buffer.
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => (
                    <tr key={req.request_id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-semibold text-gray-900 dark:text-white">
                        <div>{req.request_id}</div>
                        <div className="mt-1 max-w-[220px] truncate text-[10px] font-normal text-gray-400" title={req.prompt_preview}>
                          {req.request_kind || 'request'}: {req.prompt_preview || 'payload pending'}
                        </div>
                        {req.output_preview && (
                          <div className="mt-1 max-w-[220px] truncate text-[10px] font-normal text-emerald-600" title={req.output_preview}>
                            output: {req.output_preview}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-600 dark:text-slate-300">
                        {req.input_tokens ?? '—'}/{req.output_tokens ?? req.estimated_output_tokens ?? '—'}
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-600 dark:text-slate-300">
                        {req.estimated_cost ?? '—'} / {req.scheduling_score !== undefined ? Number(req.scheduling_score).toFixed(1) : '—'}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <StatusBadge status={req.priority} size="sm" showDot={false} />
                      </td>
                      <td className="py-2.5 px-2.5">
                        <StatusBadge status={req.status} size="sm" />
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-500" title={req.assigned_backend || ''}>
                        <span className="block max-w-52 break-all">{req.assigned_backend || '—'}</span>
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-600 dark:text-slate-300">
                        {req.ttft_ms !== undefined ? `${req.ttft_ms}ms` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-gray-900 dark:text-white">
                        {req.completion_latency_ms !== undefined ? `${req.completion_latency_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Timeline (1 col) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
              Event Timeline
            </h3>
            <span className="text-[11px] font-mono text-gray-500">
              {timelineEvents.length} events
            </span>
          </div>

          <div className="h-[420px] overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5 text-xs">
            {timelineEvents.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-10">No events logged yet.</p>
            ) : (
              timelineEvents.map((evt) => (
                <div key={evt.id} className="border-l-2 border-gray-200 dark:border-slate-800 pl-3 pb-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-0.5">
                    <span>+{evt.relative_time_sec ?? 0}s</span>
                    <span className="uppercase font-semibold">{String(evt.event_type || 'event').replaceAll('_', ' ')}</span>
                  </div>
                  <p className="text-gray-700 dark:text-slate-300 text-xs leading-snug">
                    {evt.message || 'Event received'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={showCancelModal}
        title="Cancel In-Flight Experiment?"
        message={`Cancel experiment "${experiment.experiment_id}" immediately?`}
        confirmText="Cancel Experiment"
        isDestructive={true}
        isLoading={isCancelling}
        onConfirm={handleConfirmCancel}
        onCancel={() => setShowCancelModal(false)}
      />
    </div>
  );
};
