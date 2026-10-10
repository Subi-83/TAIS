import { apiClient, handleAxiosError } from './apiClient';
import { DEMO_BACKENDS } from './demoData';

export const backendService = {
  async submitBulkChats(requests) {
    try {
      const response = await apiClient.post('/api/requests/bulk', { requests });
      return response.data;
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async getBackends(useDemo = false) {
    if (useDemo) {
      return [...DEMO_BACKENDS];
    }
    try {
      const response = await apiClient.get('/api/backends');
      return (response.data.data || []).map((backend) => ({
        ...backend,
        id: backend.backend_id,
        name: backend.backend_id,
        endpoint: backend.base_url,
        status: backend.status || 'unknown',
      }));
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async injectFault(backendId, payload, useDemo = false) {
    if (useDemo) {
      const backend = DEMO_BACKENDS.find((b) => b.id === backendId);
      if (backend) {
        if (payload.action === 'inject_slowdown') {
          backend.status = 'degraded';
          backend.injected_fault = {
            type: 'slowdown',
            slowdown_ms: payload.slowdown_factor_ms || 100,
            injected_at: new Date().toISOString(),
          };
        } else if (payload.action === 'simulate_failure') {
          backend.status = 'unhealthy';
          backend.injected_fault = {
            type: 'failure',
            injected_at: new Date().toISOString(),
          };
        } else {
          backend.status = 'healthy';
          backend.injected_fault = { type: 'none' };
        }
        return {
          success: true,
          message: `Backend ${backendId} updated with ${payload.action}`,
          backend_id: backendId,
          current_status: backend.status,
        };
      }
      return {
        success: false,
        message: 'Backend not found',
        backend_id: backendId,
        current_status: 'unhealthy',
      };
    }

    try {
      const body = payload.action === 'simulate_failure'
        ? { unhealthy: true }
        : payload.action === 'inject_slowdown'
          ? { latency_ms: payload.slowdown_factor_ms || 100 }
          : { unhealthy: false, latency_ms: 0, failure_rate: 0 };
      const response = await apiClient.post(`/api/dev/backends/${backendId}/faults`, body);
      return { success: true, message: `Fault configuration updated for ${backendId}`, ...response.data };
    } catch (error) {
      throw handleAxiosError(error);
    }
  },
};
