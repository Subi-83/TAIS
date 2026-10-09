import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { WorkloadTestingPage } from '../pages/WorkloadTestingPage';
import { BackendStatusProvider } from '../context/BackendStatusContext';
import { ThemeProvider } from '../context/ThemeContext';

describe('WorkloadTestingPage (JavaScript)', () => {
  const renderPage = () => {
    return render(
      <ThemeProvider>
        <BackendStatusProvider>
          <MemoryRouter>
            <WorkloadTestingPage />
          </MemoryRouter>
        </BackendStatusProvider>
      </ThemeProvider>
    );
  };

  it('renders presets and form fields', () => {
    renderPage();
    expect(screen.getByText('Workload Testing & Profiling Engine')).toBeInTheDocument();
    expect(screen.getByText('Short Interactive')).toBeInTheDocument();
    expect(screen.getByText('Long Generation')).toBeInTheDocument();
    expect(screen.getByText('Mixed Workload')).toBeInTheDocument();
    expect(screen.getByText('Burst Workload')).toBeInTheDocument();
    expect(screen.getByText('Custom Workload')).toBeInTheDocument();
  });

  it('switches preset values when clicked', () => {
    renderPage();
    const burstPreset = screen.getByText('Burst Workload');
    fireEvent.click(burstPreset);

    expect(screen.getByDisplayValue('Burst Workload Benchmark Run')).toBeInTheDocument();
  });

  it('renders start experiment button and reset button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /start experiment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});
