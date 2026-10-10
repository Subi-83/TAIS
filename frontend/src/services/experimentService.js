import { apiClient, getApiBaseUrl, handleAxiosError } from './apiClient';
import { DEMO_EXPERIMENT, DEMO_EXPERIMENT_HISTORY } from './demoData';

let localDemoExperiment = { ...DEMO_EXPERIMENT };
let localHistory = [...DEMO_EXPERIMENT_HISTORY];

const queueWaitMetrics = (requests = []) => {
  const waits = requests
    .map((request) => Number(request.queue_wait_ms))
    .filter((wait) => Number.isFinite(wait));
  const total = waits.length;
  const percentage = (matches) => (total ? (matches * 100) / total : 0);
  const distribution = {
    under_50: percentage(waits.filter((wait) => wait < 50).length),
    '50_to_150': percentage(waits.filter((wait) => wait >= 50 && wait < 150).length),
    '150_to_threshold': percentage(waits.filter((wait) => wait >= 150 && wait <= 300).length),
    over_threshold: percentage(waits.filter((wait) => wait > 300).length),
  };
  return { distribution, starvationRate: distribution.over_threshold, samples: total };
};

const toUiExperiment = (item) => {
  const measuredWaits = queueWaitMetrics(item.recent_requests);
  const distribution = Object.keys(item.queue_wait_distribution_pct || {}).length
    ? item.queue_wait_distribution_pct
    : measuredWaits.distribution;
  const starvationRate = Number.isFinite(Number(item.starvation_rate_pct))
    ? Number(item.starvation_rate_pct)
    : measuredWaits.starvationRate;

  return ({
  ...item,
  policy: item.scheduler_policy || item.policy,
  total_requests: item.request_count ?? item.total_requests ?? 0,
  completed_requests: item.completed_requests ?? 0,
  failed_requests: item.failed_requests ?? 0,
  elapsed_seconds: item.elapsed_seconds ?? 0,
  queued_requests: item.queued_requests ?? 0,
  cancelled_requests: item.cancelled_requests ?? 0,
  active_backends: item.active_backends ?? 1,
  current_p95_latency_ms: item.current_p95_latency_ms ?? 0,
  current_avg_latency_ms: item.current_avg_latency_ms ?? item.current_p95_latency_ms ?? 0,
  median_latency_ms: item.median_latency_ms ?? 0,
  p99_latency_ms: item.p99_latency_ms ?? 0,
  avg_ttft_ms: item.avg_ttft_ms ?? 0,
  current_throughput_rps: item.current_throughput_rps ?? 0,
  tokens_per_second: item.tokens_per_second ?? 0,
  starvation_rate_pct: starvationRate,
  starvation_threshold_ms: item.starvation_threshold_ms ?? 2000,
  average_queue_wait_ms: item.average_queue_wait_ms ?? null,
  p95_queue_wait_ms: item.p95_queue_wait_ms ?? null,
  max_queue_wait_ms: item.max_queue_wait_ms ?? null,
  over_300ms_rate_pct: item.over_300ms_rate_pct ?? null,
  overdue_waiting: item.overdue_waiting ?? 0,
  overdue_dispatched: item.overdue_dispatched ?? 0,
  max_bypass: item.max_bypass ?? 0,
  fairness_starvation_rate_pct: item.fairness_starvation_rate_pct ?? null,
  jain_fairness_on_slowdown: item.jain_fairness_on_slowdown ?? null,
  queue_wait_distribution_pct: distribution,
  prediction_error: item.prediction_error ?? null,
  avg_prediction_latency_ms: item.avg_prediction_latency_ms ?? 0,
  avg_inference_latency_ms: item.avg_inference_latency_ms ?? 0,
  metric_samples: item.metric_samples ?? item.completed_requests ?? 0,
  queue_wait_samples: measuredWaits.samples,
  avg_backend_utilization_pct: item.avg_backend_utilization_pct ?? 0,
  config: item.config ?? {},
  });
};

export const experimentService = {
  async getFaultRecoveryLatest(useDemo = false) {
    if (useDemo) return { run_id: null, observations: [] };
    try {
      const response = await apiClient.get('/api/fault-recovery/latest');
      return response.data;
    } catch (error) {
      throw handleAxiosError(error);
    }
  },
  async getExperimentsList(useDemo = false) {
    if (useDemo) {
      return [...localHistory];
    }
    try {
      const response = await apiClient.get('/api/experiments');
      return (response.data.data || []).map(toUiExperiment);
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async createExperiment(config, useDemo = false) {
    if (useDemo) {
      const newId = `exp-d07-${Math.floor(1000 + Math.random() * 9000)}`;
      localDemoExperiment = {
        ...DEMO_EXPERIMENT,
        experiment_id: newId,
        name: config.name || `${config.profile} - ${config.request_count} reqs`,
        status: 'running',
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        elapsed_seconds: 0,
        policy: config.scheduling_policy,
        config: config,
        total_requests: config.request_count,
        completed_requests: 0,
        failed_requests: 0,
        cancelled_requests: 0,
        queued_requests: config.request_count,
        active_backends: config.initial_backend_count,
        current_throughput_rps: 0,
        current_p95_latency_ms: 0,
        recent_requests: [],
        recent_events: [
          {
            id: `evt-${Date.now()}-0`,
            timestamp: new Date().toISOString(),
            relative_time_sec: 0,
            event_type: 'request_queued',
            message: `Experiment initialized: ${config.request_count} requests queued under ${String(config.scheduling_policy).toUpperCase()} policy.`,
            severity: 'info',
          },
        ],
      };

      // Add to history
      localHistory.unshift({
        experiment_id: newId,
        name: localDemoExperiment.name,
        status: 'running',
        policy: config.scheduling_policy,
        created_at: localDemoExperiment.created_at,
        elapsed_seconds: 0,
        total_requests: config.request_count,
        completed_requests: 0,
        failed_requests: 0,
        p95_latency_ms: 0,
        avg_ttft_ms: 0,
        throughput_rps: 0,
      });

      return { experiment_id: newId, status: 'running', message: 'Experiment started in demo mode' };
    }

    try {
      const profile = ['short_interactive', 'mixed', 'long_context', 'high_output', 'burst', 'sustained'].includes(config.profile)
        ? config.profile
        : 'mixed';
      const paired = await apiClient.post('/api/experiments/paired', {
        name: config.name || `${profile} workload`,
        workload_profile: profile,
        request_count: config.request_count,
        backend_count: config.max_concurrency_per_backend,
        max_requests_per_backend: 1,
        model: config.model_id || 'gemma4:12b',
      });
      return {
        experiment_id: paired.data.active_experiment_id,
        status: paired.data.status,
        paired_experiment_ids: {
          fifo: paired.data.fifo_experiment_id,
          token_aware: paired.data.token_aware_experiment_id,
        },
      };
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async getExperiment(experimentId, useDemo = false) {
    if (useDemo) {
      if (localDemoExperiment.experiment_id === experimentId) {
        return { ...localDemoExperiment };
      }
      const hist = localHistory.find((h) => h.experiment_id === experimentId);
      if (hist) {
        return {
          ...DEMO_EXPERIMENT,
          experiment_id: hist.experiment_id,
          name: hist.name,
          status: hist.status,
          policy: hist.policy,
          total_requests: hist.total_requests,
          completed_requests: hist.completed_requests,
          failed_requests: hist.failed_requests,
          current_p95_latency_ms: hist.p95_latency_ms,
          avg_ttft_ms: hist.avg_ttft_ms,
          current_throughput_rps: hist.throughput_rps,
        };
      }
      return { ...localDemoExperiment };
    }

    try {
      const response = await apiClient.get(`/api/experiments/${experimentId}`);
      return toUiExperiment(response.data);
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async cancelExperiment(experimentId, useDemo = false) {
    if (useDemo) {
      if (localDemoExperiment.experiment_id === experimentId) {
        localDemoExperiment.status = 'cancelled';
        localDemoExperiment.recent_events?.unshift({
          id: `evt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          relative_time_sec: localDemoExperiment.elapsed_seconds,
          event_type: 'request_dispatched',
          message: 'Experiment execution cancelled by operator',
          severity: 'warning',
        });
      }
      const hist = localHistory.find((h) => h.experiment_id === experimentId);
      if (hist) {
        hist.status = 'cancelled';
      }
      return { success: true, message: 'Experiment cancelled successfully' };
    }

    try {
      const response = await apiClient.post(`/api/experiments/${experimentId}/cancel`);
      return response.data;
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async getExperimentReport(experimentId, useDemo = false) {
    if (useDemo) {
      return {
        experiment_id: experimentId,
        metadata: {
          generated_at: new Date().toISOString(),
          version: '1.0',
        },
        summary: DEMO_EXPERIMENT,
        comparison: {
          policy: DEMO_EXPERIMENT.policy,
          baseline_fifo_comparison: {
            p95_latency_improvement_pct: 43.1,
            ttft_improvement_pct: 55.6,
            starvation_reduction_pct: 92.4,
          },
        },
      };
    }

    try {
      const response = await apiClient.get(`/api/experiments/${experimentId}/report`);
      return response.data;
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  subscribeToEvents(
    experimentId,
    onEvent,
    onRequestUpdate,
    onError,
    useDemo = false
  ) {
    if (useDemo) {
      let tick = 0;
      const interval = setInterval(() => {
        tick++;
        const eventTypes = ['request_dispatched', 'request_queued', 'recovery'];
        const sampleEvent = {
          id: `evt-demo-${Date.now()}-${tick}`,
          timestamp: new Date().toISOString(),
          relative_time_sec: (localDemoExperiment.elapsed_seconds || 0) + tick * 3,
          event_type: eventTypes[tick % eventTypes.length],
          message: `[Live Stream] Request batch #${tick + 50} scheduled with adaptive token weighting.`,
          severity: tick % 4 === 0 ? 'warning' : 'info',
        };
        onEvent(sampleEvent);

        if (onRequestUpdate) {
          const sampleReq = {
            request_id: `req-live-${1000 + tick}`,
            input_tokens: 128 * ((tick % 4) + 1),
            output_tokens: 64 * ((tick % 3) + 1),
            priority: tick % 3 === 0 ? 'high' : tick % 2 === 0 ? 'medium' : 'low',
            assigned_backend: `backend-vllm-0${(tick % 3) + 1}`,
            status: tick % 2 === 0 ? 'completed' : 'processing',
            ttft_ms: 20 + Math.floor(Math.random() * 25),
            completion_latency_ms: 150 + Math.floor(Math.random() * 100),
            queued_at: new Date(Date.now() - 5000).toISOString(),
            dispatched_at: new Date(Date.now() - 2000).toISOString(),
            completed_at: tick % 2 === 0 ? new Date().toISOString() : undefined,
          };
          onRequestUpdate(sampleReq);
        }
      }, 3500);

      return () => clearInterval(interval);
    }

    const sseUrl = `${getApiBaseUrl()}/api/experiments/${experimentId}/events`;
    const eventSource = new EventSource(sseUrl);
    const seenEventIds = new Set();
    let closed = false;

    const receive = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.id && seenEventIds.has(parsed.id)) {
          return;
        }
        if (parsed.id) {
          seenEventIds.add(parsed.id);
        }
        const normalized = {
          ...parsed.data,
          id: parsed.id,
          timestamp: parsed.timestamp,
          event_type: parsed.event,
          relative_time_sec: parsed.data?.relative_time_sec ?? 0,
          message: parsed.data?.message ?? parsed.data?.error ?? parsed.event.replaceAll('_', ' '),
        };
        if (onRequestUpdate && ['request_queued', 'request_calculated', 'request_dispatched', 'backend_selected', 'request_completed', 'request_failed'].includes(parsed.event)) onRequestUpdate(normalized);
        onEvent(normalized);
      } catch (e) {
        console.error('Failed to parse SSE event data', e);
      }
    };
    ['experiment_planning', 'experiment_started', 'request_accepted', 'request_queued', 'request_calculated', 'request_dispatched', 'backend_selected', 'first_token', 'request_completed', 'request_failed', 'request_cancelled', 'backend_retry', 'backend_circuit_opened', 'backend_recovered', 'metrics_update', 'experiment_completed', 'experiment_failed', 'stream_resync_required'].forEach((type) => eventSource.addEventListener(type, receive));

    eventSource.onerror = (err) => {
      if (closed) return;
      if (onError) onError(err);
    };

    return () => {
      closed = true;
      eventSource.close();
      seenEventIds.clear();
    };
  },
};
