import * as React from 'react';
import { cn } from '../lib/utils';

export interface ContextWindowMeterProps {
  used: number;
  total: number;
  className?: string;
  costUsd?: number;
  onCostClick?: () => void;
}

export const ContextWindowMeter: React.FC<ContextWindowMeterProps> = ({ used, total, className, costUsd, onCostClick }) => {
  const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  const color =
    pct < 60 ? 'bg-primary' : pct < 85 ? 'bg-amber-500' : 'bg-destructive';
  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)} role="status" aria-label={`Context ${pct.toFixed(0)}% used`}>
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full transition-[width]', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{Math.round(used / 1000)}k / {Math.round(total / 1000)}k</span>
      {costUsd != null && onCostClick && (
        <button
          type="button"
          onClick={onCostClick}
          aria-label="View session cost details"
          className="tabular-nums rounded-full px-2 py-0.5 bg-muted hover:bg-muted/70 text-[10px] font-medium"
          data-testid="cost-badge"
        >
          ${costUsd.toFixed(4)}
        </button>
      )}
    </div>
  );
};

ContextWindowMeter.displayName = 'ContextWindowMeter';
