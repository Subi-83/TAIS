import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { BackendStatusProvider } from './context/BackendStatusContext';
import { Layout } from './components/layout/Layout';

import { DashboardPage } from './pages/DashboardPage';
import { WorkloadTestingPage } from './pages/WorkloadTestingPage';
import { ExperimentMonitorPage } from './pages/ExperimentMonitorPage';
import { BackendsPage } from './pages/BackendsPage';
import { SchedulerConfigPage } from './pages/SchedulerConfigPage';
import { ComparisonPage } from './pages/ComparisonPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

export const App = () => {
  return (
    <ThemeProvider>
      <BackendStatusProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="workload" element={<WorkloadTestingPage />} />
              <Route path="monitor" element={<ExperimentMonitorPage />} />
              <Route path="backends" element={<BackendsPage />} />
              <Route path="scheduler" element={<SchedulerConfigPage />} />
              <Route path="comparison" element={<ComparisonPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BackendStatusProvider>
    </ThemeProvider>
  );
};

export default App;
