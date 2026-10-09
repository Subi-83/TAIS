import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Activity,
  Cpu,
  RefreshCw,
  Clock,
  Layers,
  AlertCircle,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { backendService } from '../services';
import { StatusBadge } from '../components/common/StatusBadge';
import { MetricCard } from '../components/common/MetricCard';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { AlertBanner } from '../components/common/AlertBanner';
import { useBackendStatus } from '../context/BackendStatusContext';

export const BackendsPage = () => {
  const { useDemoMode } = useBackendStatus();

  const [backends, setBackends] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  const [targetBackend, setTargetBackend] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecutingFault, setIsExecutingFault] = useState(false);

  const fetchBackends = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await backendService.getBackends(useDemoMode);
      setBackends(data);
    } catch (err) {
      setError(err?.message || 'Failed to fetch backend instances');
    } finally {
      setIsLoading(false);
    }
  }, [useDemoMode]);

  useEffect(() => {
    fetchBackends();
    const interval = setInterval(fetchBackends, 10000);
    return () => clearInterval(interval);
  }, [fetchBackends]);

  const handleTriggerAction = (backend, action) => {
    setTargetBackend(backend);
    if (action === 'restore') {
      setPendingAction({ action: 'restore' });
    } else if (action === 'simulate_failure') {
      setPendingAction({ action: 'simulate_failure', duration_seconds: 120 });
    } else if (action === 'inject_slowdown') {
      setPendingAction({ action: 'inject_slowdown', slowdown_factor_ms: 150, duration_seconds: 300 });
    }
    setIsModalOpen(true);
  };

  const handleConfirmFault = async () => {
    if (!targetBackend || !pendingAction) return;
    setIsExecutingFault(true);
    try {
      const res = await backendService.injectFault(targetBackend.id, pendingAction, useDemoMode);
      setActionSuccess(res.message);
      setIsModalOpen(false);
      await fetchBackends();
    } catch (err) {
      setError(err?.message || 'Failed to apply fault injection');
    } finally {
      setIsExecutingFault(false);
    }
  };

  const totalActiveRequests = backends.reduce((acc, b) => acc + (b.active_requests || 0), 0);
  const totalTokensSec = backends.reduce((acc, b) => acc + (b.tokens_per_second || 0), 0);
  const healthyCount = backends.filter((b) => b.status === 'healthy').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            Backend Inference Workers
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Real-time worker telemetry, concurrency headroom, and fault injection testing.
          </p>
        </div>
        <button
          onClick={fetchBackends}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {actionSuccess && (
        <AlertBanner
          type="success"
          message={actionSuccess}
          onClose={() => setActionSuccess(null)}
        />
      )}

      {error && (
        <AlertBanner
          type="error"
          title="Backend Error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Aggregate Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          title="Total Replicas"
          value={backends.length}
          unit="workers"
          subtext={`${healthyCount} healthy, ${backends.length - healthyCount} failed/slow`}
          icon={<Server className="h-4 w-4 text-blue-600" />}
        />
        <MetricCard
          title="In-Flight Load"
          value={totalActiveRequests}
          unit="requests"
          subtext="Active concurrency"
          icon={<Layers className="h-4 w-4 text-indigo-500" />}
        />
        <MetricCard
          title="Generation Rate"
          value={totalTokensSec.toFixed(0)}
          unit="tok/s"
          subtext="Cluster throughput"
          icon={<Zap className="h-4 w-4 text-emerald-600" />}
        />
        <MetricCard
          title="Health Ratio"
          value={healthyCount === backends.length ? '100%' : `${Math.round((healthyCount / (backends.length || 1)) * 100)}%`}
          unit="operational"
          variant={healthyCount < backends.length ? 'warning' : 'default'}
          icon={<Activity className="h-4 w-4 text-teal-600" />}
        />
      </div>

      {/* Workers Cards */}
      {isLoading && backends.length === 0 ? (
        <LoadingSpinner label="Inspecting backend worker containers..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {backends.map((backend) => {
            const memoryPct =
              backend.gpu_memory_used_mb && backend.gpu_memory_total_mb
                ? Math.round((backend.gpu_memory_used_mb / backend.gpu_memory_total_mb) * 100)
                : null;

            return (
              <div
                key={backend.id}
                className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
                          {backend.name}
                        </h3>
                        <StatusBadge status={backend.status} size="sm" />
                      </div>
                      <p className="font-mono text-[11px] text-gray-500 mt-0.5">
                        {backend.endpoint}
                      </p>
                      {backend.container_id && (
                        <p className="font-mono text-[10px] text-gray-400">
                          {backend.container_id}
                        </p>
                      )}
                    </div>
                    <div className="rounded p-1.5 text-gray-400 bg-gray-50 dark:bg-slate-800">
                      <Cpu className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Fault badge */}
                  {backend.injected_fault && backend.injected_fault.type !== 'none' && (
                    <div className="mt-2.5">
                      <span className="rounded bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                        Fault: {String(backend.injected_fault.type).toUpperCase()}
                        {backend.injected_fault.slowdown_ms ? ` (+${backend.injected_fault.slowdown_ms}ms)` : ''}
                      </span>
                    </div>
                  )}

                  {/* Worker stats */}
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-slate-800 pt-3 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-gray-400 block">Active Requests</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {backend.active_requests} / {backend.max_concurrency}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-gray-400 block">Speed</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {Number(backend.tokens_per_second || 0).toFixed(1)} tok/s
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-gray-400 block">Errors</span>
                      <span className={`font-semibold ${backend.recent_errors > 0 ? 'text-rose-600' : 'text-gray-900 dark:text-white'}`}>
                        {backend.recent_errors}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-gray-400 block">GPU Memory</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {memoryPct !== null ? `${memoryPct}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="mt-5 border-t border-gray-100 dark:border-slate-800 pt-3 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-gray-400">
                    Checked: {new Date(backend.last_health_check).toLocaleTimeString()}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {backend.status !== 'healthy' ? (
                      <button
                        onClick={() => handleTriggerAction(backend, 'restore')}
                        className="flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Restore</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleTriggerAction(backend, 'inject_slowdown')}
                          className="flex items-center gap-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50"
                        >
                          <Clock className="h-3 w-3" />
                          <span>Slowdown</span>
                        </button>
                        <button
                          onClick={() => handleTriggerAction(backend, 'simulate_failure')}
                          className="flex items-center gap-1 rounded bg-rose-50 dark:bg-rose-950/40 px-2 py-1 text-xs font-medium text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                        >
                          <AlertCircle className="h-3 w-3" />
                          <span>Fail</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={isModalOpen}
        title={
          pendingAction?.action === 'simulate_failure'
            ? `Simulate Failure on ${targetBackend?.name}?`
            : pendingAction?.action === 'inject_slowdown'
            ? `Inject Slowdown on ${targetBackend?.name}?`
            : `Restore ${targetBackend?.name}?`
        }
        message="This operation tests the scheduler's fault recovery and load-redistribution capabilities."
        confirmText={
          pendingAction?.action === 'simulate_failure'
            ? 'Trigger Failure'
            : pendingAction?.action === 'inject_slowdown'
            ? 'Apply Slowdown'
            : 'Restore Worker'
        }
        isDestructive={pendingAction?.action === 'simulate_failure'}
        isLoading={isExecutingFault}
        onConfirm={handleConfirmFault}
        onCancel={() => setIsModalOpen(false)}
      />
    </div>
  );
};
