import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MetricCard } from '../components/common/MetricCard';
import { StatusBadge } from '../components/common/StatusBadge';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmModal } from '../components/common/ConfirmModal';

describe('Common UI Components (JavaScript)', () => {
  it('renders MetricCard with title, value, unit and subtext', () => {
    render(
      <MetricCard
        title="Throughput"
        value="48.6"
        unit="req/s"
        subtext="Live Rate"
      />
    );
    expect(screen.getByText('Throughput')).toBeInTheDocument();
    expect(screen.getByText('48.6')).toBeInTheDocument();
    expect(screen.getByText('req/s')).toBeInTheDocument();
    expect(screen.getByText('Live Rate')).toBeInTheDocument();
  });

  it('renders StatusBadge with appropriate text', () => {
    render(<StatusBadge status="healthy" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    render(<StatusBadge status="token_aware" />);
    expect(screen.getByText('Token-Aware')).toBeInTheDocument();
  });

  it('renders EmptyState and triggers action callback', () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        title="No Experiments"
        description="Launch an experiment to see data"
        actionText="Create Workload"
        onAction={handleAction}
      />
    );

    expect(screen.getByText('No Experiments')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /create workload/i });
    fireEvent.click(button);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('renders ConfirmModal and fires confirmation callback', () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="Destructive Action"
        message="Are you sure?"
        confirmText="Yes, Fail"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );

    expect(screen.getByText('Destructive Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /yes, fail/i }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });
});
