/**
 * FleetVitals — one card merging the old DaemonVitals + ProgressFunnel
 * (BR-2, design §2/§8).
 *
 * Top row: the coordinator pill (● running · tick / ○ stopped) with an inline
 * Start/Stop — the only daemon affordance. Below it: the segmented work funnel
 * (Backlog ▸ Ready ▸ In-flight ▸ Blocked ▸ Done). Blocked is the only segment
 * allowed to go loud, and only while it has items.
 */

import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { FUNNEL_SEGMENTS, funnelCounts } from './funnel';

export interface FleetVitalsProps {
  running: boolean;
  readyCount: number;
  todos: SessionTodo[];
  onToggle: () => void;
}

export const FleetVitals: React.FC<FleetVitalsProps> = ({ running, readyCount, todos, onToggle }) => {
  const counts = useMemo(() => funnelCounts(todos), [todos]);
  const total = todos.length;
  const stoppedWithWork = !running && readyCount > 0;

  return (
    <div
      data-testid="fleet-vitals"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-3"
    >
      {/* Coordinator pill + Start/Stop */}
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
          stoppedWithWork
            ? 'bg-danger-500 text-white'
            : running
              ? 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
        }`}
      >
        <span className="font-semibold uppercase tracking-wide opacity-70">Coordinator</span>
        <span className="font-medium">
          {stoppedWithWork ? `⛔ STOPPED · ${readyCount} ready` : running ? '● running' : '○ stopped'}
        </span>
        <button
          type="button"
          onClick={onToggle}
          data-testid="coordinator-toggle"
          className={`ml-auto px-2 py-0.5 text-xs font-medium rounded border transition-colors ${
            stoppedWithWork
              ? 'border-white/60 text-white hover:bg-white/20'
              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Segmented funnel */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-semibold uppercase tracking-wide">Progress</span>
          <span>{total} total</span>
        </div>
        <div data-testid="fleet-funnel" className="flex items-stretch gap-0.5 h-7 rounded overflow-hidden">
          {FUNNEL_SEGMENTS.map((seg) => {
            const n = counts[seg.key];
            const loud = seg.loud && n > 0;
            const flex = Math.max(n, 0.4);
            return (
              <div
                key={seg.key}
                style={{ flexGrow: flex, flexBasis: 0 }}
                title={`${seg.label}: ${n}`}
                data-testid={`fleet-funnel-${seg.key}`}
                className={`min-w-[3.5rem] flex flex-col items-center justify-center px-1 text-xs font-semibold ${
                  loud
                    ? 'bg-warning-500 text-white'
                    : seg.bg
                }`}
              >
                <span className="tabular-nums leading-none">{n}</span>
                <span className="leading-none mt-0.5 whitespace-nowrap text-center text-[0.625rem]">{seg.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FleetVitals;
