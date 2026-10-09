import { describe, it, expect, vi } from 'vitest';
import { experimentService, backendService, schedulerService, metricsService } from '../services';

describe('API Services Layer (JavaScript)', () => {
  it('retrieves backend instances correctly in demo mode', async () => {
    const backends = await backendService.getBackends(true);
    expect(backends.length).toBeGreaterThan(0);
    expect(backends[0]).toHaveProperty('endpoint');
    expect(backends[0]).toHaveProperty('status');
  });

  it('triggers fault injection on a backend in demo mode', async () => {
    const res = await backendService.injectFault(
      'backend-vllm-01',
      { action: 'inject_slowdown', slowdown_factor_ms: 200 },
      true
    );
    expect(res.success).toBe(true);
    expect(res.current_status).toBe('degraded');
  });

  it('retrieves and updates scheduler configuration', async () => {
    const config = await schedulerService.getConfig(true);
    expect(config).toHaveProperty('token_aware_settings');

    const updated = await schedulerService.updateConfig(
      {
        policy: 'fifo',
        token_aware_settings: { prompt_tokens_weight: 0.5 },
      },
      true
    );
    expect(updated.policy).toBe('fifo');
    expect(updated.token_aware_settings.prompt_tokens_weight).toBe(0.5);
  });

  it('creates an experiment and handles cancellation in demo mode', async () => {
    const createRes = await experimentService.createExperiment(
      {
        profile: 'short_interactive',
        name: 'Service Test Exp',
        request_count: 100,
        min_input_tokens: 16,
        max_input_tokens: 32,
        min_output_tokens: 16,
        max_output_tokens: 32,
        arrival_rate: 10,
        priority_distribution: { low: 50, medium: 30, high: 20 },
        initial_backend_count: 2,
        min_backends: 1,
        max_backends: 4,
        max_concurrency_per_backend: 16,
        queue_capacity: 100,
        scheduling_policy: 'token_aware',
        latency_target_ms: 200,
        slowdown_config: { enabled: false, slowdown_ms: 0, start_after_sec: 0, duration_sec: 0 },
        failure_config: { enabled: false, fail_after_sec: 0, duration_sec: 0 },
      },
      true
    );

    expect(createRes.experiment_id).toBeDefined();

    const exp = await experimentService.getExperiment(createRes.experiment_id, true);
    expect(exp.experiment_id).toBe(createRes.experiment_id);

    const cancelRes = await experimentService.cancelExperiment(createRes.experiment_id, true);
    expect(cancelRes.success).toBe(true);
  });

  it('subscribes to events with clean teardown', () => {
    const callback = vi.fn();
    const unsubscribe = experimentService.subscribeToEvents('exp-d07-9481', callback, undefined, undefined, true);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('queries health and system metrics successfully', async () => {
    const health = await metricsService.getHealth(true);
    expect(health.status).toBe('healthy');

    const metrics = await metricsService.getMetrics(true);
    expect(metrics.total_requests).toBeGreaterThan(0);
    expect(metrics.throughput_series.length).toBeGreaterThan(0);
  });
});
