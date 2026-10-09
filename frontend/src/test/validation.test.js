import { describe, it, expect } from 'vitest';

describe('Workload Form Validation Logic (JS)', () => {
  const baseValidConfig = {
    profile: 'short_interactive',
    name: 'Validation Test',
    request_count: 500,
    min_input_tokens: 16,
    max_input_tokens: 64,
    min_output_tokens: 32,
    max_output_tokens: 128,
    arrival_rate: 30,
    priority_distribution: { low: 50, medium: 30, high: 20 },
    initial_backend_count: 3,
    min_backends: 2,
    max_backends: 6,
    max_concurrency_per_backend: 32,
    queue_capacity: 500,
    scheduling_policy: 'token_aware',
    latency_target_ms: 150,
  };

  const validateConfig = (cfg) => {
    const errors = {};
    if (!cfg.request_count || cfg.request_count <= 0) errors.request_count = 'Invalid';
    if (cfg.min_input_tokens <= 0) errors.min_input = 'Invalid';
    if (cfg.max_input_tokens < cfg.min_input_tokens) errors.token_bounds = 'Invalid';
    if (cfg.min_output_tokens <= 0) errors.min_output = 'Invalid';
    if (cfg.max_output_tokens < cfg.min_output_tokens) errors.output_bounds = 'Invalid';
    if (cfg.arrival_rate <= 0) errors.arrival = 'Invalid';

    const sum = cfg.priority_distribution.low + cfg.priority_distribution.medium + cfg.priority_distribution.high;
    if (Math.round(sum) !== 100) errors.priority_sum = 'Must sum to 100';

    if (cfg.min_backends < 1) errors.min_backends = 'Invalid';
    if (cfg.max_backends < cfg.min_backends) errors.backend_bounds = 'Invalid';
    if (cfg.initial_backend_count < cfg.min_backends || cfg.initial_backend_count > cfg.max_backends) {
      errors.initial_backends = 'Out of bounds';
    }
    return errors;
  };

  it('validates correct workload configuration without errors', () => {
    const errors = validateConfig(baseValidConfig);
    expect(Object.keys(errors).length).toBe(0);
  });

  it('rejects priority distribution that does not sum to 100%', () => {
    const invalidConfig = {
      ...baseValidConfig,
      priority_distribution: { low: 40, medium: 40, high: 10 },
    };
    const errors = validateConfig(invalidConfig);
    expect(errors.priority_sum).toBeDefined();
  });

  it('rejects inverted token boundaries (min > max)', () => {
    const invalidConfig = {
      ...baseValidConfig,
      min_input_tokens: 1000,
      max_input_tokens: 100,
    };
    const errors = validateConfig(invalidConfig);
    expect(errors.token_bounds).toBeDefined();
  });

  it('rejects initial backend count outside min/max range', () => {
    const invalidConfig = {
      ...baseValidConfig,
      min_backends: 3,
      max_backends: 6,
      initial_backend_count: 2,
    };
    const errors = validateConfig(invalidConfig);
    expect(errors.initial_backends).toBeDefined();
  });
});
