/**
 * ProgressFunnel — segmented Backlog ▸ Ready ▸ In-flight ▸ Blocked ▸ Done bar
 * (Control-UI vision §4, KPI #3). The Blocked segment is danger-toned and loud
 * while > 0. Clicking a segment reveals its filtered todo list below.
 */

import React, { useMemo, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { FUNNEL_SEGMENTS, funnelCounts, todosInSegment, type FunnelKey } from './funnel';

export interface ProgressFunnelProps {
  todos: SessionTodo[];
  /** Open the DrillDock on the clicked segment (Bridge); local list still toggles. */
  onDrill?: (segment: FunnelKey) => void;
}

export const ProgressFunnel: React.FC<ProgressFunnelProps> = ({ todos, onDrill }) => {
  const counts = useMemo(() => funnelCounts(todos), [todos]);
  const [selected, setSelected] = useState<FunnelKey | null>(null);

  const total = todos.length;
  const selectedTodos = selected ? todosInSegment(todos, selected) : [];

  return (
    <div data-testid="progress-funnel" className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Progress
        </span>
        <span className="text-2xs text-gray-400 dark:text-gray-500">{total} total</span>
      </div>

      {/* Segmented bar */}
      <div className="flex items-stretch gap-0.5 h-6 rounded overflow-hidden">
        {FUNNEL_SEGMENTS.map((seg) => {
          const n = counts[seg.key];
          const loud = seg.loud && n > 0;
          const isSel = selected === seg.key;
          // Give every segment a minimum width so empty buckets stay clickable.
          const flex = Math.max(n, 0.4);
          return (
            <button
              key={seg.key}
              type="button"
              onClick={() => {
                setSelected((cur) => (cur === seg.key ? null : seg.key));
                onDrill?.(seg.key);
              }}
              style={{ flexGrow: flex, flexBasis: 0 }}
              title={`${seg.label}: ${n}`}
              data-testid={`funnel-segment-${seg.key}`}
              className={`min-w-[2.5rem] flex flex-col items-center justify-center px-1 text-3xs font-semibold transition-colors ${
                loud
                  ? 'bg-danger-500 text-white animate-pulse'
                  : isSel
                    ? 'bg-accent-200 dark:bg-accent-800 text-accent-800 dark:text-accent-100'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="tabular-nums leading-none">{n}</span>
              <span className="leading-none mt-0.5 truncate w-full text-center">{seg.label}</span>
            </button>
          );
        })}
      </div>

      {/* Filtered list for the clicked segment */}
      {selected && (
        <div data-testid="funnel-filtered-list" className="space-y-1 max-h-40 overflow-y-auto">
          {selectedTodos.length === 0 ? (
            <p className="text-2xs text-gray-400 dark:text-gray-500 italic px-1">No todos in this stage.</p>
          ) : (
            selectedTodos.map((t) => (
              <div
                key={t.id}
                className="px-2 py-1 rounded border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-2xs text-gray-700 dark:text-gray-200 leading-tight"
              >
                {t.title}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
