import React from 'react';
import { Database } from 'lucide-react';

export const EmptyState = ({
  icon,
  title,
  description,
  actionText,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-10 text-center">
      <div className="rounded-full bg-gray-100 p-3 text-gray-500 dark:bg-slate-800 dark:text-slate-400">
        {icon || <Database className="h-6 w-6" />}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="mt-1 max-w-sm text-xs text-gray-500 dark:text-slate-400">
        {description}
      </p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="mt-4 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
