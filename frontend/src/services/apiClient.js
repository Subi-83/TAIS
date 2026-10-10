import axios from 'axios';

export const getApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  const savedUrl = localStorage.getItem('d07_api_url');

  // Older builds stored the mock backend's port as the gateway address. Migrate
  // that value automatically so existing browsers reach the FastAPI gateway.
  if (savedUrl === 'http://localhost:8001' || savedUrl === 'http://127.0.0.1:8001') {
    localStorage.setItem('d07_api_url', configuredUrl);
    return configuredUrl;
  }
  return savedUrl || configuredUrl;
};

export const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // Local LLMs can need extra time for their first model load.
  timeout: 130000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Dynamically use current configured URL
apiClient.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}`;
  return config;
});

export function handleAxiosError(error) {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return {
        message: error.response.data?.detail || error.response.data?.message || `Server error ${error.response.status}`,
        statusCode: error.response.status,
        details: error.response.data,
      };
    } else if (error.request) {
      return {
        message: `Cannot reach backend at ${getApiBaseUrl()}. Check if FastAPI is running or switch to Demo Mode.`,
        statusCode: 0,
      };
    }
  }
  return {
    message: error instanceof Error ? error.message : 'An unknown network error occurred',
  };
}
