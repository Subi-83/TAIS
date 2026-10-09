import axios from 'axios';

export const getApiBaseUrl = () => {
  return localStorage.getItem('d07_api_url') || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
};

export const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
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
