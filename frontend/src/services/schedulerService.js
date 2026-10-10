import { apiClient, handleAxiosError } from './apiClient';
import { DEMO_SCHEDULER_CONFIG } from './demoData';

let localDemoConfig = { ...DEMO_SCHEDULER_CONFIG };

const toUiConfig = (config) => ({
  ...DEMO_SCHEDULER_CONFIG,
  policy: config.policy,
  token_aware_settings: {
    ...DEMO_SCHEDULER_CONFIG.token_aware_settings,
    max_waiting_time_sec: config.max_wait_seconds,
    aging_factor: config.aging_weight,
  },
  max_queue: config.max_queue,
});

export const schedulerService = {
  async getConfig(useDemo = false) {
    if (useDemo) {
      return { ...localDemoConfig };
    }
    try {
      const response = await apiClient.get('/api/scheduler/config');
      return toUiConfig(response.data);
    } catch (error) {
      throw handleAxiosError(error);
    }
  },

  async updateConfig(payload, useDemo = false) {
    if (useDemo) {
      localDemoConfig = {
        ...localDemoConfig,
        policy: payload.policy,
        token_aware_settings: {
          ...localDemoConfig.token_aware_settings,
          ...payload.token_aware_settings,
        },
        scaling_config: {
          ...localDemoConfig.scaling_config,
          ...payload.scaling_config,
        },
        last_updated: new Date().toISOString(),
      };
      return { ...localDemoConfig };
    }

    try {
      const response = await apiClient.put('/api/scheduler/config', {
        policy: payload.policy,
        max_wait_seconds: payload.token_aware_settings?.max_waiting_time_sec || 30,
        max_queue: payload.max_queue || 1000,
        aging_weight: payload.token_aware_settings?.aging_factor ?? 1,
      });
      return toUiConfig(response.data);
    } catch (error) {
      throw handleAxiosError(error);
    }
  },
};
