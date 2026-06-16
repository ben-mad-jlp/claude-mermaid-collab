/**
 * PlanKanban — the Plan surface, organized as EPIC SWIMLANES (G6, restored).
 *
 *  - ROWS are epics: each epic is a horizontal lane (header = epic title + a
 *    per-bucket rollup), and its child todos flow LEFT→RIGHT by dependency wave
 *    (computeWaveMap depth) inside the lane. Independent epics never share a
 *    column, so they can't look coupled by a shared wave depth.
 *  - Orphan todos (no epic) get their own "No epic" lane.
 *  - A PINNED "⚡ Startable" strip sits on top as a cross-cutting highlight: todos
 *    whose dependsOn are all done AND that are unclaimed — start these. (A
 *    capability concept, NOT the status-Ready funnel bucket — G4.)
 *  - A "Show completed" toggle hides/shows completed epics (a lane whose children
 *    are all terminal) and completed orphan todos, to de-clutter the plan.
 *  - CARDS are colored by the SAME funnel.ts bucket as the FleetGraph nodes
 *    (one palette across the app) and carry the same click-to-navigate.
 */

import React, { useMemo, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import type { PlanItem } from '@/types/planItem';
import { computeWaveMap } from './roadmapToMermaid';
import { bucketTodo, FUNNEL_SEGMENTS, STATUS_STYLE, type FunnelKey } from './bridge/funnel';

export interface PlanKanbanProps {
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
  /** Controlled by the parent (PlanPanel) so Kanban/List/Graph share one toggle. */
  showCompleted: boolean;
}

/**
 * Card fill/border/text per funnel bucket — HUES sourced from the canonical
 * funnel.ts palette (ready=violet, inflight=info, blocked=warning(amber, NOT
 * red — one-red), done=success, backlog=gray). The card keeps its own
 * border + faint `-50` fill SHAPE; only the hues are unified.
 */
const BUCKET_CARD: Record<FunnelKey, string> = {
  backlog: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50',
  ready: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20',
  inflight: 'border-info-300 dark:border-info-700 bg-info-50 dark:bg-info-900/20',
  blocked: 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20',
  done: 'border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20',
};

const TERMINAL = new Set(['done', 'dropped']);

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
      className={`w-56 shrink-0 text-left rounded-md border px-3 py-2.5 space-y-1.5 transition-colors hover:brightness-95 ${BUCKET_CARD[bucket]} ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="text-xs leading-tight text-gray-800 dark:text-gray-100">{todo.title}</div>
      <div className="flex items-center gap-1.5 text-3xs text-gray-500 dark:text-gray-400">
        <span className="font-mono text-gray-400 dark:text-gray-500" title={todo.id}>#{todo.id.slice(-4)}</span>
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

/** A swimlane: an epic (or the synthetic "No epic" bucket) + its ordered todos. */
interface Lane {
  key: string;
  title: string;
  epic: SessionTodo | null;
  items: SessionTodo[];
  counts: Record<FunnelKey, number>;
  completed: boolean; // every child terminal (done/dropped) — a "completed epic"
  rank: number; // min child wave, for lane ordering
}

export const PlanKanban: React.FC<PlanKanbanProps> = ({ todos, onSelectTodo, showCompleted }) => {

  const waveMap = useMemo(() => computeWaveMap(todos as PlanItem[]), [todos]);
  const unblocks = useMemo(() => unblocksCount(todos), [todos]);

  // Build epic swimlanes: an epic is any todo that is some other todo's parent.
  // Children go in their epic's lane; everything else (no epic parent, not an
  // epic itself) falls into a synthetic "No epic" lane. Within a lane, todos
  // flow left→right by wave then plan order. Lanes order by their min child wave.
  const lanes = useMemo<Lane[]>(() => {
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

    const byWaveOrder = (a: SessionTodo, b: SessionTodo) => {
      const wa = waveMap.get(a.id) ?? 0;
      const wb = waveMap.get(b.id) ?? 0;
      if (wa !== wb) return wa - wb;
      return (a.order ?? 0) - (b.order ?? 0);
    };
    const tally = (items: SessionTodo[]): Record<FunnelKey, number> => {
      const c: Record<FunnelKey, number> = { backlog: 0, ready: 0, inflight: 0, blocked: 0, done: 0 };
      for (const t of items) c[bucketTodo(t) ?? 'backlog']++;
      return c;
    };
    const minWave = (items: SessionTodo[]) =>
      items.length ? Math.min(...items.map((t) => waveMap.get(t.id) ?? 0)) : 0;

    const out: Lane[] = [];

    // One lane per epic (sorted children).
    for (const epicId of epicIds) {
      const epic = byId.get(epicId)!;
      const items = (childrenByEpic.get(epicId) ?? []).slice().sort(byWaveOrder);
      out.push({
        key: `epic:${epicId}`,
        title: epic.title,
        epic,
        items,
        counts: tally(items),
        completed: items.length > 0 && items.every((t) => TERMINAL.has(t.status)),
        rank: minWave(items),
      });
    }

    // "No epic" lane: todos that are neither an epic nor a child of one.
    const orphans = todos
      .filter((t) => !epicIds.has(t.id) && !(t.parentId != null && byId.has(t.parentId)))
      .sort(byWaveOrder);
    if (orphans.length > 0) {
      out.push({
        key: 'orphans',
        title: 'No epic',
        epic: null,
        items: orphans,
        counts: tally(orphans),
        completed: orphans.every((t) => TERMINAL.has(t.status)),
        rank: minWave(orphans),
      });
    }

    return out.sort((a, b) => a.rank - b.rank);
  }, [todos, waveMap]);

  const completedLaneCount = useMemo(() => lanes.filter((l) => l.completed).length, [lanes]);

  // PLAN totals reflect ONLY unfinished epics (a finished epic — every child terminal —
  // is excluded entirely), so the progress header tracks the work that's actually left.
  const { counts, total } = useMemo(() => {
    const c: Record<FunnelKey, number> = { backlog: 0, ready: 0, inflight: 0, blocked: 0, done: 0 };
    let tot = 0;
    for (const l of lanes) {
      if (l.completed) continue;
      for (const k of Object.keys(c) as FunnelKey[]) c[k] += l.counts[k];
      tot += l.items.length;
    }
    return { counts: c, total: tot };
  }, [lanes]);
  const visibleLanes = useMemo(
    () =>
      lanes
        .filter((l) => showCompleted || !l.completed)
        // Within a kept lane, also drop terminal orphan/child cards when hiding
        // completed — keeps a partially-done epic but trims its finished cards.
        .map((l) =>
          showCompleted ? l : { ...l, items: l.items.filter((t) => !TERMINAL.has(t.status)) },
        )
        .filter((l) => l.items.length > 0),
    [lanes, showCompleted],
  );

  if (todos.length === 0) {
    return (
      <div data-testid="plan-kanban" className="flex items-center justify-center h-full">
        <p className="text-xs text-gray-400 dark:text-gray-500">No plan items for this project.</p>
      </div>
    );
  }

  return (
    <div data-testid="plan-kanban" className="flex flex-col h-full min-h-0">
      {/* Segmented progress header (the Show-completed toggle lives in PlanPanel). */}
      <div className="shrink-0 px-1 pb-2 space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            {FUNNEL_SEGMENTS.map((seg) =>
              counts[seg.key] > 0 ? (
                <div
                  key={seg.key}
                  data-testid={`progress-seg-${seg.key}`}
                  className={STATUS_STYLE[seg.key].dot}
                  style={{ width: `${total > 0 ? (counts[seg.key] / total) * 100 : 0}%` }}
                  title={`${seg.label}: ${counts[seg.key]}`}
                />
              ) : null,
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-3xs">
          {FUNNEL_SEGMENTS.map((seg) => (
            <span key={seg.key} className={seg.tint}>
              {seg.label} {counts[seg.key]}
            </span>
          ))}
        </div>
      </div>

      {/* Vertical stack of swimlanes (epics as rows). */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {/* Epic swimlanes. */}
        {visibleLanes.map((lane) => (
          <section
            key={lane.key}
            data-testid={lane.epic ? `epic-lane-${lane.epic.id}` : 'orphan-lane'}
            className={`rounded-lg border bg-gray-50/60 dark:bg-gray-800/30 ${
              lane.completed
                ? 'border-success-300 dark:border-success-800'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <header
              className={`flex items-center gap-2 px-2 py-1.5 border-b ${
                lane.completed
                  ? 'border-success-200 dark:border-success-800'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <button
                type="button"
                onClick={lane.epic && onSelectTodo ? () => onSelectTodo(lane.epic!) : undefined}
                className={`text-xs font-semibold text-left truncate ${
                  lane.epic && onSelectTodo ? 'hover:underline cursor-pointer' : 'cursor-default'
                } text-gray-700 dark:text-gray-200`}
                title={lane.title}
              >
                {lane.title}
              </button>
              <span className="text-3xs text-gray-400 dark:text-gray-500">{lane.items.length}</span>
              {/* per-lane bucket rollup */}
              <span className="ml-auto flex flex-wrap gap-x-2 text-3xs">
                {FUNNEL_SEGMENTS.map((seg) =>
                  lane.counts[seg.key] > 0 ? (
                    <span key={seg.key} className={seg.tint} title={`${seg.label}: ${lane.counts[seg.key]}`}>
                      {seg.label} {lane.counts[seg.key]}
                    </span>
                  ) : null,
                )}
                {lane.completed && (
                  <span className="text-success-600 dark:text-success-400 font-medium">✓ complete</span>
                )}
              </span>
            </header>
            <div className="overflow-x-auto p-1.5">
              <div className="flex gap-2 items-start">
                {lane.items.map((t) => (
                  <PlanCard key={t.id} todo={t} unblocks={unblocks.get(t.id) ?? 0} onSelect={onSelectTodo} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default PlanKanban;
