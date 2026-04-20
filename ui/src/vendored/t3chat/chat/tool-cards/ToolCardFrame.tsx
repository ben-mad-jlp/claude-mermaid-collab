import * as React from 'react';
import { cn } from '../../lib/utils';
import { Badge } from '../../ui/badge';
import { Spinner } from '../../ui/spinner';

export type ToolStatus = 'running' | 'ok' | 'error' | 'canceled';

export interface ToolCardFrameProps {
  name: string;
  title?: string;
  status: ToolStatus;
  durationMs?: number;
  historical?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadge(status: ToolStatus): React.ReactNode {
  switch (status) {
    case 'running':
      return (
        <Badge variant="secondary" className="gap-1">
          <Spinner size={10} />
          running
        </Badge>
      );
    case 'ok':
      return (
        <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
          ok
        </Badge>
      );
    case 'error':
      return <Badge variant="destructive">error</Badge>;
    case 'canceled':
      return <Badge variant="outline">canceled</Badge>;
  }
}

export const ToolCardFrame: React.FC<ToolCardFrameProps> = ({
  name,
  title,
  status,
  durationMs,
  historical,
  defaultCollapsed,
  children,
}) => {
  const [collapsed, setCollapsed] = React.useState<boolean>(!!defaultCollapsed);
  return (
    <div
      data-testid="tool-card-frame"
      data-tool-name={name}
      data-tool-status={status}
      className={cn(
        'w-full max-w-[85%] rounded-lg border bg-card text-card-foreground text-xs shadow-sm',
        historical ? 'opacity-60 italic border-dashed' : '',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={!collapsed}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block transform transition-transform duration-150',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        >
          ▶
        </span>
        <span className="font-mono font-semibold">{name}</span>
        {statusBadge(status)}
        {title && (
          <span className="truncate text-muted-foreground min-w-0 flex-1" title={title}>
            {title}
          </span>
        )}
        {typeof durationMs === 'number' && (
          <span className="ml-auto text-muted-foreground tabular-nums shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="border-t px-3 pb-3 pt-2">{children}</div>
      )}
    </div>
  );
};

ToolCardFrame.displayName = 'ToolCardFrame';

export default ToolCardFrame;
