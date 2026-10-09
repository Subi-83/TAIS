import { apiClient, getApiBaseUrl, handleAxiosError } from './apiClient';
import { DEMO_EXPERIMENT, DEMO_EXPERIMENT_HISTORY } from './demoData';

let localDemoExperiment = { ...DEMO_EXPERIMENT };
let localHistory = [...DEMO_EXPERIMENT_HISTORY];

const toUiExperiment = (item) => ({
  ...item,
  policy: item.scheduler_policy || item.policy,
  total_requests: item.request_count ?? item.total_requests ?? 0,
  completed_requests: item.completed_requests ?? 0,
  failed_requests: item.failed_requests ?? 0,
  current_p95_latency_ms: item.current_p95_latency_ms ?? 0,
  avg_ttft_ms: item.avg_ttft_ms ?? 0,
  current_throughput_rps: item.current_throughput_rps ?? 0,
});

export const experimentService = {
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
      const created = await apiClient.post('/api/experiments', {
        name: config.name || `${profile} workload`,
        scheduler_policy: config.scheduling_policy || 'token_aware',
        workload_profile: profile,
        request_count: config.request_count,
        model: config.model_id || 'mock-echo-1',
        random_seed: config.random_seed || 42,
      });
      const started = await apiClient.post(`/api/experiments/${created.data.experiment_id}/start`);
      return started.data;
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

    const receive = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.id && seenEventIds.has(parsed.id)) {
          return;
        }
        if (parsed.id) {
          seenEventIds.add(parsed.id);
        }
        const normalized = { ...parsed.data, id: parsed.id, timestamp: parsed.timestamp, event_type: parsed.event };
        if (onRequestUpdate && ['request_queued', 'request_dispatched', 'request_completed'].includes(parsed.event)) onRequestUpdate(normalized);
        onEvent(normalized);
      } catch (e) {
        console.error('Failed to parse SSE event data', e);
      }
    };
    ['experiment_started', 'request_accepted', 'request_queued', 'request_dispatched', 'first_token', 'request_completed', 'request_failed', 'request_cancelled', 'metrics_update', 'experiment_completed', 'experiment_failed', 'stream_resync_required'].forEach((type) => eventSource.addEventListener(type, receive));

    eventSource.onerror = (err) => {
      if (onError) onError(err);
    };

    return () => {
      eventSource.close();
      seenEventIds.clear();
    };
  },
};
