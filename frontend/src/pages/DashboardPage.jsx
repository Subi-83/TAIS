import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Layers,
  Cpu,
  Clock,
  Zap,
  Server,
  RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { MetricCard } from '../components/common/MetricCard';
import { StatusBadge } from '../components/common/StatusBadge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { AlertBanner } from '../components/common/AlertBanner';
import { metricsService } from '../services';
import { useBackendStatus } from '../context/BackendStatusContext';
import { useNavigate } from 'react-router-dom';

export const DashboardPage = () => {
  const { useDemoMode } = useBackendStatus();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await metricsService.getMetrics(useDemoMode);
      setMetrics(data);
    } catch (err) {
      setError(err?.message || 'Failed to retrieve system overview metrics');
      setMetrics(null);
    } finally {
      setIsLoading(false);
    }
  }, [useDemoMode]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (isLoading && !metrics) {
    return <LoadingSpinner label="Loading cluster status..." />;
  }

  if (error && !metrics) {
    return (
      <div className="space-y-5">
        <AlertBanner
          type="error"
          title="Cluster Telemetry Offline"
          message={error}
        />
        <EmptyState
          title="No Metrics Available"
          description="Unable to connect to the backend monitoring endpoint. You can start a workload experiment or switch to Demo Mode."
          actionText="Configure Workload"
          onAction={() => navigate('/workload')}
        />
      </div>
    );
  }

  if (!metrics || metrics.total_requests === 0) {
    return (
      <EmptyState
        title="No Inference Activity Recorded"
        description="Launch an experiment from the Workload Testing page to populate live performance metrics."
        actionText="Launch Workload Experiment"
        onAction={() => navigate('/workload')}
      />
    );
  }

  const tooltipStyle = {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: '0.375rem',
    color: '#f8fafc',
    fontSize: '12px',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            System Overview & Gateway Telemetry
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Real-time inference queue depth, token throughput, and cluster instance health.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
            <span>Policy:</span>
            <StatusBadge status={metrics.current_scheduler_policy} />
          </div>
          <button
            onClick={fetchMetrics}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          title="Total Requests"
          value={metrics.total_requests.toLocaleString()}
          subtext={`${metrics.completed_requests.toLocaleString()} completed`}
          icon={<Layers className="h-4 w-4 text-blue-600" />}
          definition="Cumulative requests received by the inference gateway."
        />
        <MetricCard
          title="Queued"
          value={metrics.queued_requests}
          unit="req"
          variant={metrics.queued_requests > 100 ? 'warning' : 'default'}
          subtext="Current queue depth"
          icon={<Clock className="h-4 w-4 text-indigo-500" />}
          definition="Requests currently waiting in queue for dispatch to backend workers."
        />
        <MetricCard
          title="Throughput"
          value={metrics.current_throughput_rps.toFixed(1)}
          unit="req/s"
          subtext="Inference req/sec"
          icon={<Zap className="h-4 w-4 text-emerald-600" />}
          definition="Rate of successfully completed inference requests per second."
        />
        <MetricCard
          title="p95 Latency"
          value={metrics.p95_completion_latency_ms.toFixed(0)}
          unit="ms"
          subtext={`Avg TTFT: ${metrics.avg_time_to_first_token_ms.toFixed(1)}ms`}
          icon={<Activity className="h-4 w-4 text-teal-600" />}
          definition="95th percentile end-to-end completion latency."
        />
        <MetricCard
          title="Active Replicas"
          value={metrics.active_backend_instances}
          unit="workers"
          subtext={`Util: ${metrics.current_backend_utilization_pct.toFixed(0)}%`}
          icon={<Server className="h-4 w-4 text-purple-600" />}
          definition="Active GPU model worker replicas handling traffic."
        />
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Throughput */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-slate-100">
                Throughput Over Time (req/s)
              </h3>
            </div>
            <Zap className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.throughput_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="rps"
                  stroke="#2563eb"
                  fill="#93c5fd"
                  fillOpacity={0.3}
                  name="RPS"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Latency Trends */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-slate-100">
                Latency Trends (ms)
              </h3>
            </div>
            <Activity className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.latency_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="p50_ms" stroke="#3b82f6" strokeWidth={2} dot={false} name="Median (p50)" />
                <Line type="monotone" dataKey="p95_ms" stroke="#d97706" strokeWidth={2} dot={false} name="p95" />
                <Line type="monotone" dataKey="p99_ms" stroke="#e11d48" strokeWidth={2} dot={false} name="p99" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Secondary Charts Row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Utilization */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-slate-100 mb-3">
            Cluster Utilization (%)
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.utilization_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="utilization_pct" stroke="#8b5cf6" fill="#ddd6fe" fillOpacity={0.3} name="Utilization %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Instances */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-slate-100 mb-3">
            Active Backend Replicas
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.active_instances_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={[0, 'dataMax + 2']} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="stepAfter" dataKey="instances" stroke="#4f46e5" strokeWidth={2} dot={false} name="Replicas" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Success vs Failed */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-900 dark:text-slate-100 mb-3">
            Success vs Failure Count
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.success_failure_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" dark:stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="successful" fill="#10b981" name="Success" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
