/**
 * PlanKanban (Bridge P6) — the Plan surface, replacing the mermaid graph/waves.
 *
 * A flex/grid wave-kanban (NOT React Flow, NOT mermaid):
 *  - COLUMNS are dependency waves (computeWaveMap depth) — left→right is "what
 *    unblocks what". Within a wave, cards keep plan order.
 *  - A PINNED "Startable" lane (sticky, first) surfaces the highest-value set:
 *    todos whose dependsOn are all done AND that are unclaimed — start these.
 *    (Named "Startable", a capability concept — NOT the status-Ready bucket.)
 *  - CARDS are colored by the SAME funnel.ts bucket as the FleetGraph nodes
 *    (one palette across the app) and carry the same click-to-navigate.
 *  - A segmented PROGRESS header is built from funnelCounts.
 *  - An ACCENT (not red) `unblocks N` tag flags bottlenecks — N = the count of
 *    todos that transitively depend on this one (BFS over the inverse dep graph).
 */

import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import type { PlanItem } from '@/types/planItem';
import { computeWaveMap } from './roadmapToMermaid';
import { bucketTodo, funnelCounts, FUNNEL_SEGMENTS, type FunnelKey } from './bridge/funnel';

export interface PlanKanbanProps {
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
}

/** Card fill/border/text per funnel bucket — one palette with the FleetGraph. */
const BUCKET_CARD: Record<FunnelKey, string> = {
  backlog: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50',
  ready: 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20',
  inflight: 'border-info-300 dark:border-info-700 bg-info-50 dark:bg-info-900/20',
  blocked: 'border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20',
  done: 'border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20',
};

/** Segment fill for the progress bar (bg) per bucket. */
const BUCKET_BAR: Record<FunnelKey, string> = {
  backlog: 'bg-gray-300 dark:bg-gray-600',
  ready: 'bg-indigo-400 dark:bg-indigo-500',
  inflight: 'bg-info-500',
  blocked: 'bg-danger-500',
  done: 'bg-success-500',
};

/**
 * Transitive-dependents count per todo (the bottleneck weight): how many todos
 * would be unblocked downstream if this one completed. BFS over the inverse
 * dependsOn graph.
 */
function unblocksCount(todos: SessionTodo[]): Map<string, number> {
  const ids = new Set(todos.map((t) => t.id));
  const dependents = new Map<string, string[]>(); // dep id → ids that depend on it
  for (const t of todos) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) continue;
      const arr = dependents.get(dep) ?? [];
      arr.push(t.id);
      dependents.set(dep, arr);
    }
  }
  const out = new Map<string, number>();
  for (const t of todos) {
    const seen = new Set<string>();
    const queue = [...(dependents.get(t.id) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of dependents.get(id) ?? []) if (!seen.has(next)) queue.push(next);
    }
    out.set(t.id, seen.size);
  }
  return out;
}

const TERMINAL = new Set(['done', 'dropped']);

function PlanCard({
  todo,
  unblocks,
  onSelect,
}: {
  todo: SessionTodo;
  unblocks: number;
  onSelect?: (t: SessionTodo) => void;
}) {
  const bucket = bucketTodo(todo) ?? 'backlog';
  const depCount = todo.dependsOn?.length ?? 0;
  return (
    <button
      type="button"
      data-testid="plan-card"
      data-todo-id={todo.id}
      onClick={onSelect ? () => onSelect(todo) : undefined}
      className={`w-full text-left rounded-md border px-2 py-1.5 space-y-1 transition-colors hover:brightness-95 ${BUCKET_CARD[bucket]} ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="text-xs leading-tight text-gray-800 dark:text-gray-100">{todo.title}</div>
      <div className="flex items-center gap-1.5 text-3xs text-gray-500 dark:text-gray-400">
        {depCount > 0 && <span className="font-mono" title={`${depCount} dependencies`}>⊸{depCount}</span>}
        {unblocks > 0 && (
          <span
            data-testid="bottleneck-tag"
            title={`Unblocks ${unblocks} downstream todo${unblocks === 1 ? '' : 's'}`}
            className="font-medium px-1 rounded bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300"
          >
            unblocks {unblocks}
          </span>
        )}
        {todo.assigneeSession && (
          <span className="ml-auto px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 truncate max-w-[10rem]">
            {todo.assigneeSession}
          </span>
        )}
      </div>
    </button>
  );
}

export const PlanKanban: React.FC<PlanKanbanProps> = ({ todos, onSelectTodo }) => {
  const waveMap = useMemo(() => computeWaveMap(todos as PlanItem[]), [todos]);
  const unblocks = useMemo(() => unblocksCount(todos), [todos]);
  const counts = useMemo(() => funnelCounts(todos), [todos]);
  const total = todos.length;

  // Startable: deps all done (or none) AND unclaimed AND not terminal. This is a
  // CAPABILITY bucket ("can start now"), distinct from the status-Ready funnel
  // bucket — so it is NOT labelled "Ready" (G4: status-vocab collision removed).
  const startable = useMemo(() => {
    const byId = new Map(todos.map((t) => [t.id, t]));
    return todos.filter((t) => {
      if (TERMINAL.has(t.status) || t.claimedBy) return false;
      return (t.dependsOn ?? []).every((d) => {
        const dep = byId.get(d);
        return !dep || dep.status === 'done';
      });
    });
  }, [todos]);

  // Columns by wave (ascending depth); plan order within a wave.
  const waves = useMemo(() => {
    const byWave = new Map<number, SessionTodo[]>();
    for (const t of todos) {
      const w = waveMap.get(t.id) ?? 0;
      const arr = byWave.get(w) ?? [];
      arr.push(t);
      byWave.set(w, arr);
    }
    return Array.from(byWave.keys())
      .sort((a, b) => a - b)
      .map((w) => ({ wave: w, items: byWave.get(w)!.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
  }, [todos, waveMap]);

  if (total === 0) {
    return (
      <div data-testid="plan-kanban" className="flex items-center justify-center h-full">
        <p className="text-xs text-gray-400 dark:text-gray-500">No plan items for this project.</p>
      </div>
    );
  }

  return (
    <div data-testid="plan-kanban" className="flex flex-col h-full min-h-0">
      {/* Segmented progress header. */}
      <div className="shrink-0 px-1 pb-2 space-y-1">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          {FUNNEL_SEGMENTS.map((seg) =>
            counts[seg.key] > 0 ? (
              <div
                key={seg.key}
                data-testid={`progress-seg-${seg.key}`}
                className={BUCKET_BAR[seg.key]}
                style={{ width: `${(counts[seg.key] / total) * 100}%` }}
                title={`${seg.label}: ${counts[seg.key]}`}
              />
            ) : null,
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-3xs">
          {FUNNEL_SEGMENTS.map((seg) => (
            <span key={seg.key} className={seg.tint}>
              {seg.label} {counts[seg.key]}
            </span>
          ))}
        </div>
      </div>

      {/* Lanes: pinned Ready-Now, then one column per wave. Horizontal scroll. */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-2 items-stretch">
          {/* PINNED Startable lane (capability: deps satisfied + unclaimed). */}
          <section
            data-testid="startable-lane"
            className="sticky left-0 z-10 shrink-0 w-56 flex flex-col rounded-lg border border-accent-300 dark:border-accent-700 bg-accent-50/60 dark:bg-accent-900/20"
          >
            <header className="shrink-0 px-2 py-1.5 text-xs font-semibold text-accent-700 dark:text-accent-300 border-b border-accent-200 dark:border-accent-800">
              ⚡ Startable <span className="font-normal opacity-70">{startable.length}</span>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
              {startable.length === 0 ? (
                <p className="text-3xs text-gray-500 dark:text-gray-400 px-1 py-2">
                  ✓ Nothing startable right now.
                </p>
              ) : (
                startable.map((t) => (
                  <PlanCard key={`startable:${t.id}`} todo={t} unblocks={unblocks.get(t.id) ?? 0} onSelect={onSelectTodo} />
                ))
              )}
            </div>
          </section>

          {waves.map(({ wave, items }) => (
            <section
              key={`wave-${wave}`}
              data-testid={`wave-col-${wave}`}
              className="shrink-0 w-56 flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/30"
            >
              <header className="shrink-0 px-2 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                Wave {wave} <span className="font-normal text-gray-400 dark:text-gray-500">{items.length}</span>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
                {items.map((t) => (
                  <PlanCard key={t.id} todo={t} unblocks={unblocks.get(t.id) ?? 0} onSelect={onSelectTodo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PlanKanban;
