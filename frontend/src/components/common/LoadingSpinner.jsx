import React from 'react';
import { Loader2 } from 'lucide-react';

export const LoadingSpinner = ({ label = 'Loading...', size = 'md' }) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-8 w-8',
  }[size] || 'h-5 w-5';

  return (
    <div className="flex flex-col items-center justify-center p-6 gap-2">
      <Loader2 className={`${sizeClasses} animate-spin text-blue-600 dark:text-blue-400`} />
      {label && <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">{label}</p>}
    </div>
  );
};
