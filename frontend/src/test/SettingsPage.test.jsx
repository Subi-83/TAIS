import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../pages/SettingsPage';
import { BackendStatusProvider } from '../context/BackendStatusContext';
import { ThemeProvider } from '../context/ThemeContext';

describe('SettingsPage (JavaScript)', () => {
  const renderPage = () => {
    return render(
      <ThemeProvider>
        <BackendStatusProvider>
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </BackendStatusProvider>
      </ThemeProvider>
    );
  };

  it('renders API base URL and connection controls', () => {
    renderPage();
    expect(screen.getByText('System Settings & Preferences')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/localhost:8000/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
  });

  it('allows editing settings and saving', () => {
    renderPage();
    const input = screen.getByDisplayValue(/localhost:8000/i);
    fireEvent.change(input, { target: { value: 'http://custom-api:8080' } });
    expect(screen.getByDisplayValue('http://custom-api:8080')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveButton);
    expect(screen.getByText(/settings updated and saved/i)).toBeInTheDocument();
  });
});
