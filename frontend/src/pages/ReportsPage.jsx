import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Search,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { experimentService } from '../services';
import { StatusBadge } from '../components/common/StatusBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useBackendStatus } from '../context/BackendStatusContext';

export const ReportsPage = () => {
  const { useDemoMode } = useBackendStatus();

  const [experiments, setExperiments] = useState([]);
  const [selectedExpId, setSelectedExpId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [policyFilter, setPolicyFilter] = useState('all');
  const [isExporting, setIsExporting] = useState(false);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await experimentService.getExperimentsList(useDemoMode);
      setExperiments(list);
      if (list.length > 0 && !selectedExpId) {
        setSelectedExpId(list[0].experiment_id);
      }
    } catch (err) {
      console.error('Failed to load experiment history', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedExpId, useDemoMode]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!selectedExpId) return;
    const fetchDetail = async () => {
      setIsLoadingDetail(true);
      try {
        const detail = await experimentService.getExperiment(selectedExpId, useDemoMode);
        setSelectedDetail(detail);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [selectedExpId, useDemoMode]);

  const handleDownloadJSON = async () => {
    if (!selectedExpId) return;
    setIsExporting(true);
    try {
      const report = await experimentService.getExperimentReport(selectedExpId, useDemoMode);
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${selectedExpId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadCSV = () => {
    if (!selectedDetail) return;
    const headers = ['metric', 'value', 'unit'];
    const rows = [
      ['Experiment ID', selectedDetail.experiment_id, ''],
      ['Name', `"${selectedDetail.name}"`, ''],
      ['Policy', selectedDetail.policy, ''],
      ['Total Requests', selectedDetail.total_requests, 'requests'],
      ['Completed Requests', selectedDetail.completed_requests, 'requests'],
      ['Failed Requests', selectedDetail.failed_requests, 'requests'],
      ['Throughput', selectedDetail.current_throughput_rps, 'req/s'],
      ['Average Latency', selectedDetail.current_avg_latency_ms, 'ms'],
      ['p95 Latency', selectedDetail.current_p95_latency_ms, 'ms'],
      ['Avg TTFT', selectedDetail.avg_ttft_ms, 'ms'],
      ['Backend Utilization', selectedDetail.avg_backend_utilization_pct, '%'],
      ['Starvation Rate', selectedDetail.starvation_rate_pct, '%'],
      ['Scaling Events', selectedDetail.scaling_events_count, 'events'],
    ];

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${selectedDetail.experiment_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = experiments.filter((e) => {
    const matchesSearch =
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.experiment_id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPolicy = policyFilter === 'all' || e.policy === policyFilter;
    return matchesSearch && matchesPolicy;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            Experiment Audit Reports & Telemetry History
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Audit historical workload runs, scaling decisions, and export JSON/CSV telemetry reports.
          </p>
        </div>

        <button
          onClick={fetchHistory}
          disabled={isLoading}
          className="flex items-center gap-1.5 self-start sm:self-auto rounded border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: History List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search experiments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-2.5 py-1 text-xs text-gray-900 dark:text-white focus:border-blue-600 focus:outline-hidden"
              />
            </div>
            <select
              value={policyFilter}
              onChange={(e) => setPolicyFilter(e.target.value)}
              className="rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-gray-700 dark:text-slate-300 focus:outline-hidden"
            >
              <option value="all">All</option>
              <option value="token_aware">Token-Aware</option>
              <option value="fifo">FIFO</option>
            </select>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {isLoading ? (
              <LoadingSpinner label="Loading history..." />
            ) : filtered.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-8">No matching experiments.</p>
            ) : (
              filtered.map((item) => {
                const isSelected = selectedExpId === item.experiment_id;
                return (
                  <div
                    key={item.experiment_id}
                    onClick={() => setSelectedExpId(item.experiment_id)}
                    className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
                        : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                        {item.experiment_id}
                      </span>
                      <StatusBadge status={item.status} size="sm" />
                    </div>
                    <h4 className="text-xs font-medium text-gray-700 dark:text-slate-300 truncate">
                      {item.name}
                    </h4>
                    <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-gray-500">
                      <StatusBadge status={item.policy} size="sm" showDot={false} />
                      <span>p95: {item.p95_latency_ms}ms</span>
                      <span>{item.completed_requests}/{item.total_requests} req</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Experiment Report */}
        <div className="lg:col-span-7">
          {isLoadingDetail || !selectedDetail ? (
            <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
              <LoadingSpinner label="Loading report details..." />
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-5">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                      {selectedDetail.experiment_id}
                    </span>
                    <StatusBadge status={selectedDetail.status} size="sm" />
                    <StatusBadge status={selectedDetail.policy} size="sm" />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">
                    {selectedDetail.name}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadCSV}
                    className="flex items-center gap-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-50"
                  >
                    <Download className="h-3 w-3" />
                    <span>CSV</span>
                  </button>
                  <button
                    onClick={handleDownloadJSON}
                    disabled={isExporting}
                    className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    <Download className="h-3 w-3" />
                    <span>JSON Report</span>
                  </button>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs">
                <div className="rounded border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 p-2.5">
                  <span className="text-[10px] text-gray-400 block uppercase">p95 Latency</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {selectedDetail.current_p95_latency_ms} ms
                  </span>
                </div>
                <div className="rounded border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 p-2.5">
                  <span className="text-[10px] text-gray-400 block uppercase">Avg TTFT</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {selectedDetail.avg_ttft_ms} ms
                  </span>
                </div>
                <div className="rounded border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 p-2.5">
                  <span className="text-[10px] text-gray-400 block uppercase">Throughput</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {selectedDetail.current_throughput_rps} req/s
                  </span>
                </div>
                <div className="rounded border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40 p-2.5">
                  <span className="text-[10px] text-gray-400 block uppercase">Starvation</span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                    {selectedDetail.starvation_rate_pct}%
                  </span>
                </div>
              </div>

              {/* Workload Config Breakdown */}
              <div>
                <h4 className="text-xs font-semibold uppercase text-gray-700 dark:text-slate-300 mb-2">
                  Parameters Summary
                </h4>
                <div className="rounded border border-gray-200 dark:border-slate-800 p-3 bg-gray-50/50 dark:bg-slate-800/20 text-xs font-mono grid grid-cols-2 gap-y-1.5 gap-x-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Profile:</span>
                    <span className="text-gray-900 dark:text-white">{selectedDetail.config?.profile}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Arrival Rate:</span>
                    <span className="text-gray-900 dark:text-white">{selectedDetail.config?.arrival_rate} req/s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Queue Capacity:</span>
                    <span className="text-gray-900 dark:text-white">{selectedDetail.config?.queue_capacity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Target SLA:</span>
                    <span className="text-gray-900 dark:text-white">{selectedDetail.config?.latency_target_ms} ms</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
