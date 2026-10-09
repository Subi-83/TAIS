import React from 'react';

export const StatusBadge = ({ status = '', size = 'md', showDot = true }) => {
  const norm = String(status).toLowerCase();

  const getStyles = () => {
    switch (norm) {
      case 'healthy':
      case 'completed':
        return {
          bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
          dot: 'bg-emerald-500',
          label: norm === 'healthy' ? 'Healthy' : 'Completed',
        };
      case 'degraded':
      case 'warning':
        return {
          bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800',
          dot: 'bg-amber-500',
          label: 'Degraded',
        };
      case 'unhealthy':
      case 'failed':
        return {
          bg: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800',
          dot: 'bg-rose-500',
          label: norm === 'unhealthy' ? 'Unhealthy' : 'Failed',
        };
      case 'running':
      case 'processing':
        return {
          bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800',
          dot: 'bg-blue-500 animate-pulse',
          label: norm === 'running' ? 'Running' : 'Processing',
        };
      case 'starting':
      case 'queued':
      case 'pending':
        return {
          bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
          dot: 'bg-indigo-500',
          label: norm === 'starting' ? 'Starting' : norm === 'queued' ? 'Queued' : 'Pending',
        };
      case 'stopped':
      case 'cancelled':
        return {
          bg: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 border-gray-200 dark:border-slate-700',
          dot: 'bg-gray-400',
          label: norm === 'stopped' ? 'Stopped' : 'Cancelled',
        };
      case 'token_aware':
        return {
          bg: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 border-teal-200 dark:border-teal-800',
          dot: 'bg-teal-600',
          label: 'Token-Aware',
        };
      case 'fifo':
        return {
          bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
          dot: 'bg-blue-600',
          label: 'FIFO',
        };
      case 'high':
        return {
          bg: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800',
          dot: 'bg-purple-500',
          label: 'High',
        };
      case 'medium':
        return {
          bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
          dot: 'bg-blue-500',
          label: 'Medium',
        };
      case 'low':
        return {
          bg: 'bg-gray-50 text-gray-600 dark:bg-slate-800/60 dark:text-slate-400 border-gray-200 dark:border-slate-700',
          dot: 'bg-gray-400',
          label: 'Low',
        };
      default:
        return {
          bg: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 border-gray-200 dark:border-slate-700',
          dot: 'bg-gray-400',
          label: status,
        };
    }
  };

  const style = getStyles();
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-0.5 text-xs font-medium';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${style.bg} ${sizeClasses} font-mono tracking-tight`}
    >
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />}
      {style.label}
    </span>
  );
};
