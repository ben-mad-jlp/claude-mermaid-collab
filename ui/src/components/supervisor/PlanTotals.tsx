/**
 * PlanTotals — the Plan's at-a-glance progress chart + per-bucket counts, shown as
 * a shared sub-header BELOW the Plan header on every tab (Kanban / List / Graph),
 * not just inside the Kanban surface.
 *
 * Totals reflect ONLY unfinished epics (a fully-completed epic — every child
 * terminal — is excluded), so the bar tracks the work actually left. This is the
 * same rollup the Kanban swimlanes used; computePlanTotals is the pure extraction.
 */
import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { bucketTodo, FUNNEL_SEGMENTS, STATUS_STYLE, type FunnelKey } from './bridge/funnel';

const TERMINAL = new Set(['done', 'dropped']);

export interface PlanTotals {
  counts: Record<FunnelKey, number>;
  total: number;
}

/** Roll up bucket counts across UNFINISHED epics + the (unfinished) orphan group. */
export function computePlanTotals(todos: SessionTodo[]): PlanTotals {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const childrenByEpic = new Map<string, SessionTodo[]>();
  for (const t of todos) {
    if (t.parentId != null && byId.has(t.parentId)) {
      const arr = childrenByEpic.get(t.parentId) ?? [];
      arr.push(t);
      childrenByEpic.set(t.parentId, arr);
    }
  }
  const epicIds = new Set(childrenByEpic.keys());
  const counts: Record<FunnelKey, number> = { backlog: 0, ready: 0, inflight: 0, blocked: 0, done: 0 };
  let total = 0;

  const addLane = (items: SessionTodo[]) => {
    if (items.length === 0) return;
    if (items.every((t) => TERMINAL.has(t.status))) return; // completed lane → excluded
    for (const t of items) counts[bucketTodo(t, byId) ?? 'backlog']++;
    total += items.length;
  };

  for (const epicId of epicIds) addLane(childrenByEpic.get(epicId) ?? []);
  const orphans = todos.filter((t) => !epicIds.has(t.id) && !(t.parentId != null && byId.has(t.parentId)));
  addLane(orphans);

  return { counts, total };
}

export const PlanTotalsBar: React.FC<{ todos: SessionTodo[] }> = ({ todos }) => {
  const { counts, total } = useMemo(() => computePlanTotals(todos), [todos]);
  if (total === 0) return null;
  return (
    <div data-testid="plan-totals" className="px-3 py-1.5 space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        {FUNNEL_SEGMENTS.map((seg) =>
          counts[seg.key] > 0 ? (
            <div
              key={seg.key}
              data-testid={`progress-seg-${seg.key}`}
              className={STATUS_STYLE[seg.key].dot}
              style={{ width: `${(counts[seg.key] / total) * 100}%` }}
              title={`${seg.label}: ${counts[seg.key]}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-3xs">
        <span className="text-gray-500 dark:text-gray-400 font-medium">{total} open</span>
        {FUNNEL_SEGMENTS.map((seg) => (
          <span key={seg.key} className={seg.tint}>
            {seg.label} {counts[seg.key]}
          </span>
        ))}
      </div>
    </div>
  );
};

export default PlanTotalsBar;
