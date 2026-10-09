import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ComparisonPage } from '../pages/ComparisonPage';
import { BackendStatusProvider } from '../context/BackendStatusContext';
import { ThemeProvider } from '../context/ThemeContext';

describe('ComparisonPage (JavaScript)', () => {
  const renderPage = () => {
    return render(
      <ThemeProvider>
        <BackendStatusProvider>
          <MemoryRouter>
            <ComparisonPage />
          </MemoryRouter>
        </BackendStatusProvider>
      </ThemeProvider>
    );
  };

  it('renders benchmark comparison metrics and selectors', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Performance Benchmark Comparison')).toBeInTheDocument();
    });
    expect(screen.getByText(/p95 latency reduction/i)).toBeInTheDocument();
    expect(screen.getByText(/avg ttft speedup/i)).toBeInTheDocument();
    expect(screen.getByText(/throughput gain/i)).toBeInTheDocument();
  });
});
