import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { metricsService } from '../services';
import { getApiBaseUrl } from '../services/apiClient';

const BackendStatusContext = createContext(undefined);

export const BackendStatusProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState(null);
  const [activeExperimentId, setActiveExperimentIdState] = useState(() => localStorage.getItem('d07_active_experiment') || null);

  const setActiveExperimentId = (value) => {
    setActiveExperimentIdState(value);
    if (value) localStorage.setItem('d07_active_experiment', value);
    else localStorage.removeItem('d07_active_experiment');
  };
  const [apiUrl, setApiUrlState] = useState(getApiBaseUrl());

  // Demo mode
  const [useDemoMode, setUseDemoModeState] = useState(() => {
    const saved = localStorage.getItem('d07_demo_mode');
    return saved !== null ? saved === 'true' : true;
  });

  // Settings
  const [pollIntervalSec, setPollIntervalSecState] = useState(() => {
    const saved = localStorage.getItem('d07_poll_interval');
    return saved ? parseInt(saved, 10) : 15;
  });

  const [streamBufferSize, setStreamBufferSizeState] = useState(() => {
    const saved = localStorage.getItem('d07_stream_buffer');
    return saved ? parseInt(saved, 10) : 100;
  });

  const setUseDemoMode = (val) => {
    setUseDemoModeState(val);
    localStorage.setItem('d07_demo_mode', String(val));
  };

  const setApiUrl = (url) => {
    setApiUrlState(url);
    localStorage.setItem('d07_api_url', url);
  };

  const setPollIntervalSec = (val) => {
    setPollIntervalSecState(val);
    localStorage.setItem('d07_poll_interval', String(val));
  };

  const setStreamBufferSize = (val) => {
    setStreamBufferSizeState(val);
    localStorage.setItem('d07_stream_buffer', String(val));
  };

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      await metricsService.getHealth(false);
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    } finally {
      setIsChecking(false);
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, pollIntervalSec * 1000);
    return () => clearInterval(interval);
  }, [checkConnection, pollIntervalSec]);

  return (
    <BackendStatusContext.Provider
      value={{
        isConnected,
        isChecking,
        lastChecked,
        apiUrl,
        setApiUrl,
        useDemoMode,
        setUseDemoMode,
        checkConnection,
        activeExperimentId,
        setActiveExperimentId,
        pollIntervalSec,
        setPollIntervalSec,
        streamBufferSize,
        setStreamBufferSize,
      }}
    >
      {children}
    </BackendStatusContext.Provider>
  );
};

export const useBackendStatus = () => {
  const context = useContext(BackendStatusContext);
  if (!context) {
    throw new Error('useBackendStatus must be used within a BackendStatusProvider');
  }
  return context;
};
