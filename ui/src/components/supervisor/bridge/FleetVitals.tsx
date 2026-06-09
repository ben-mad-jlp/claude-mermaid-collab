/**
 * FleetVitals — the project's work funnel (Backlog ▸ Ready ▸ In-flight ▸ Blocked
 * ▸ Done) + spec-coverage glance. The coordinator on/off now lives in the
 * CommandBar role-switch line, so this is just Progress — no card chrome.
 * Blocked is the only segment allowed to go loud, and only while it has items.
 */

import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import type { CoverageRollup } from '@/stores/supervisorStore';
import { FUNNEL_SEGMENTS, funnelCounts, withRecentDoneOnly } from './funnel';
import { SpecCoverageCard } from './SpecCoverageCard';

export interface FleetVitalsProps {
  todos: SessionTodo[];
  /** Spec coverage rollup (design §5). Absent/empty → the card self-hides. */
  coverage?: CoverageRollup;
}

export const FleetVitals: React.FC<FleetVitalsProps> = ({ todos, coverage }) => {
  // Age out done todos older than ~1 day so the progress bar shows RECENT
  // throughput, not all-time done history.
  const funnelTodos = useMemo(() => withRecentDoneOnly(todos), [todos]);
  const counts = useMemo(() => funnelCounts(funnelTodos), [funnelTodos]);
  const total = funnelTodos.length;

  return (
    <div data-testid="fleet-vitals" className="space-y-3">
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

      {/* Spec coverage glance (§5) — self-hides when the project has no spec objects. */}
      <SpecCoverageCard coverage={coverage} />
    </div>
  );
};

export default FleetVitals;
