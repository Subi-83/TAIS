import { apiClient, handleAxiosError } from './apiClient';
import { DEMO_METRICS } from './demoData';

export const metricsService = {
  async getHealth(useDemo = false) {
    if (useDemo) {
      return {
        status: 'healthy',
        version: 'v1.4.2-demo',
        uptime_seconds: 86420,
        backend_count: 4,
        active_experiment_id: 'exp-d07-9481',
      };
    }
    try {
      const response = await apiClient.get('/health');
      return response.data;
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async getMetrics(useDemo = false) {
    if (useDemo) {
      return { ...DEMO_METRICS };
    }
    try {
      const response = await apiClient.get('/api/system/status');
      const system = response.data;
      const metrics = system.metrics || {};
      const latency = metrics.completion_latency_ms || {};
      const ttft = metrics.ttft_ms || {};
      return {
        total_requests: (metrics.completed || 0) + (metrics.failed || 0) + (metrics.cancelled || 0) + (system.queue_depth || 0) + (system.active_requests || 0),
        completed_requests: metrics.completed || 0,
        queued_requests: system.queue_depth || 0,
        current_throughput_rps: 0,
        p95_completion_latency_ms: latency.p95 || 0,
        avg_completion_latency_ms: latency.avg || 0,
        avg_time_to_first_token_ms: ttft.avg || 0,
        active_backend_instances: system.scaling?.actual_replicas || 0,
        current_backend_utilization_pct: system.active_requests ? 100 : 0,
        current_scheduler_policy: system.scheduler_policy || 'fifo',
        throughput_series: [],
        latency_series: [],
        utilization_series: [],
        active_instances_series: [],
        success_failure_series: [],
      };
    } catch (error) {
      throw handleAxiosError(error);
    }
  },
};
