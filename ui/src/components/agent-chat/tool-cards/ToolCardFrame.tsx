import React, { useState } from 'react';

export interface ToolCardFrameProps {
  name: string;
  title?: string;
  status: 'running' | 'ok' | 'error' | 'canceled';
  durationMs?: number;
  historical?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusBadgeClasses: Record<ToolCardFrameProps['status'], string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  ok: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  canceled: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

const statusLabel: Record<ToolCardFrameProps['status'], string> = {
  running: 'running',
  ok: 'ok',
  error: 'error',
  canceled: 'canceled',
};

const ToolCardFrame: React.FC<ToolCardFrameProps> = ({
  name,
  title,
  status,
  durationMs,
  historical,
  defaultCollapsed,
  children,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(!!defaultCollapsed);

  const cardClasses = [
    'max-w-[85%] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs',
    historical ? 'opacity-60 italic border-dashed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex justify-start">
      <div className={cardClasses}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left"
          aria-expanded={!collapsed}
        >
          <span
            className={`inline-block transform transition-transform duration-150 ${
              collapsed ? 'rotate-0' : 'rotate-90'
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="font-mono text-gray-900 dark:text-gray-100">{name}</span>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClasses[status]}`}
          >
            {status === 'running' && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            )}
            {statusLabel[status]}
          </span>
          {title && (
            <span className="truncate text-gray-600 dark:text-gray-300 min-w-0 flex-1">
              {title}
            </span>
          )}
          {typeof durationMs === 'number' && (
            <span className="ml-auto text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
        </button>
        {!collapsed && (
          <div className="px-3 pb-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
};

ToolCardFrame.displayName = 'ToolCardFrame';

export default ToolCardFrame;
