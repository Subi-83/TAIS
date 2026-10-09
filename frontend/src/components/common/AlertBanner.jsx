import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

export const AlertBanner = ({ type = 'info', title, message, onClose }) => {
  const configs = {
    info: {
      bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900',
      icon: <Info className="h-4 w-4 text-blue-600" />,
      text: 'text-blue-900 dark:text-blue-200',
    },
    success: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      text: 'text-emerald-900 dark:text-emerald-200',
    },
    warning: {
      bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      text: 'text-amber-900 dark:text-amber-200',
    },
    error: {
      bg: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900',
      icon: <AlertCircle className="h-4 w-4 text-rose-600" />,
      text: 'text-rose-900 dark:text-rose-200',
    },
  };

  const current = configs[type] || configs.info;

  return (
    <div className={`flex items-start gap-2.5 rounded-md border p-3 ${current.bg}`}>
      <div className="shrink-0 pt-0.5">{current.icon}</div>
      <div className="flex-1 text-xs">
        {title && <h4 className={`font-semibold ${current.text}`}>{title}</h4>}
        <p className={`mt-0.5 leading-normal ${current.text} opacity-95`}>{message}</p>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
