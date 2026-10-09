import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  PlayCircle,
  Activity,
  Server,
  Sliders,
  Scale,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Cpu,
} from 'lucide-react';

export const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { to: '/dashboard', label: 'Overview Dashboard', icon: <LayoutDashboard className="h-4 w-4 shrink-0" /> },
    { to: '/workload', label: 'Workload Testing', icon: <PlayCircle className="h-4 w-4 shrink-0" />, badge: 'Main' },
    { to: '/monitor', label: 'Live Monitor', icon: <Activity className="h-4 w-4 shrink-0" /> },
    { to: '/backends', label: 'Backend Workers', icon: <Server className="h-4 w-4 shrink-0" /> },
    { to: '/scheduler', label: 'Scheduler Config', icon: <Sliders className="h-4 w-4 shrink-0" /> },
    { to: '/comparison', label: 'Performance Compare', icon: <Scale className="h-4 w-4 shrink-0" /> },
    { to: '/reports', label: 'Experiment Reports', icon: <FileText className="h-4 w-4 shrink-0" /> },
    { to: '/settings', label: 'System Settings', icon: <Settings className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <aside
      className={`relative flex flex-col border-r border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-150 shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-14 items-center border-b border-gray-200 dark:border-slate-800 px-3.5">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-600 text-white">
            <Cpu className="h-4 w-4" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-xs tracking-tight text-gray-900 dark:text-white truncate">
                  Token-Aware Scheduler
                </span>
                <span className="rounded bg-blue-50 dark:bg-blue-950/60 px-1 py-0.2 font-mono text-[9px] font-semibold text-blue-700 dark:text-blue-300">
                  D07
                </span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
                Inference Gateway
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 space-y-1 p-2.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={isCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded px-2.5 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 font-semibold'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800/60 hover:text-gray-900 dark:hover:text-slate-200'
              } ${isCollapsed ? 'justify-center px-0' : ''}`
            }
          >
            {item.icon}
            {!isCollapsed && (
              <div className="flex flex-1 items-center justify-between overflow-hidden">
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span className="rounded bg-gray-100 dark:bg-slate-800 px-1 py-0.2 text-[9px] font-semibold text-gray-600 dark:text-slate-300">
                    {item.badge}
                  </span>
                )}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-gray-200 dark:border-slate-800 p-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-center rounded border border-gray-200 dark:border-slate-800 py-1.5 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : (
            <div className="flex items-center gap-1.5">
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Collapse Menu</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
