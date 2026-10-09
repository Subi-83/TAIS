import React from 'react';
import { HelpCircle } from 'lucide-react';

export const MetricCard = ({
  title,
  value,
  unit,
  subtext,
  icon,
  definition,
  trend,
  variant = 'default',
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'warning':
        return 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20';
      case 'danger':
        return 'border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20';
      case 'highlight':
        return 'border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20';
      default:
        return 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900';
    }
  };

  return (
    <div className={`rounded-lg border p-4 shadow-2xs transition-colors ${getVariantStyles()}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-slate-400">
          <span>{title}</span>
          {definition && (
            <div className="group relative cursor-help">
              <HelpCircle className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300" />
              <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-slate-200 shadow-md group-hover:block w-48 text-center font-normal">
                {definition}
              </div>
            </div>
          )}
        </div>
        {icon && (
          <div className="rounded p-1.5 text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-800/80">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-normal text-gray-500 dark:text-slate-400">
            {unit}
          </span>
        )}
      </div>

      {(subtext || trend) && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
          {subtext && <span>{subtext}</span>}
          {trend && (
            <span
              className={`font-medium ${
                trend.isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {trend.value} {trend.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
