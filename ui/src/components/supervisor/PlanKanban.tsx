/**
 * PlanKanban — the Plan surface, organized as EPIC SWIMLANES (G6, restored).
 *
 *  - ROWS are epics (kind === 'epic'): each epic is a horizontal lane (header = epic title + a
 *    per-bucket rollup), and its child todos flow LEFT→RIGHT by dependency wave
 *    (computeWaveMap depth) inside the lane. A childless epic still renders as an empty lane.
 *    A leaf with children (auto-split) is never a lane — it renders as an expandable card.
 *    Independent epics never share a column, so they can't look coupled by a shared wave depth.
 *  - Orphan todos (no epic parent) get their own "No epic" lane.
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
import { liveBucketTodo, FUNNEL_SEGMENTS, type FunnelKey } from './bridge/funnel';
import { CopyId } from '@/components/CopyId';
import { buildTodoHierarchy } from '@/lib/todoHierarchy';
import { isMission } from '@/lib/todoKind';
import { isBucketEpicUI, bucketTypeOfTodo, TRIAGE_TAGS, BUCKET_LANE_LABEL, BUCKET_TYPE_ORDER, type BucketType, type TriageTag } from '@/lib/bucketRegistry';

export interface PlanKanbanProps {
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
  /** Controlled by the parent (PlanPanel) so Kanban/List/Graph share one toggle. */
  showCompleted: boolean;
  /** Clear (hard-delete) a lane's completed children — Inbox/orphan housekeeping.
   *  `epicId === null` ⇒ the synthetic "No epic" (orphan) lane. */
  onClearCompleted?: (epicId: string | null) => void;
  inflightLeafIds?: Set<string>;
  onPromoteToEpic?: (todo: SessionTodo) => void;
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

// Dropped todos get their OWN distinct, faded look — clearly different from backlog
// (gray, live) and from the funnel buckets: a muted rose with reduced opacity signals
// "cancelled / not coming back".
const DROPPED_CARD = 'border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 opacity-60';

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
  byId,
  inflightLeafIds,
  subtasks,
}: {
  todo: SessionTodo;
  unblocks: number;
  onSelect?: (t: SessionTodo) => void;
  byId?: Map<string, SessionTodo>;
  inflightLeafIds?: Set<string>;
  subtasks?: SessionTodo[];
}) {
  const [open, setOpen] = useState(false);
  const bucket = liveBucketTodo(todo, byId, inflightLeafIds) ?? 'backlog';
  const isDropped = todo.status === 'dropped';
  const cardColor = isDropped ? DROPPED_CARD : BUCKET_CARD[bucket];
  const depCount = todo.dependsOn?.length ?? 0;
  return (
    <div className="w-56 shrink-0">
      <button
        type="button"
        data-testid="plan-card"
        data-dropped={isDropped || undefined}
        data-todo-id={todo.id}
        onClick={onSelect ? () => onSelect(todo) : undefined}
        className={`w-full text-left rounded-md border px-3 py-2.5 space-y-1.5 transition-colors hover:brightness-95 ${cardColor} ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className={`text-xs leading-tight break-words ${isDropped ? 'line-through text-gray-500 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'}`}>{todo.title}</div>
        <div className="flex items-center gap-1.5 text-3xs text-gray-500 dark:text-gray-400">
          <CopyId id={todo.id} />
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
      {subtasks && subtasks.length > 0 && (
        <>
          <button
            type="button"
            data-testid="subtask-toggle"
            data-todo-id={todo.id}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            className="w-full text-left px-3 py-1 text-3xs text-gray-500 dark:text-gray-400 hover:underline"
          >
            {open ? '▾' : '▸'} {subtasks.length} sub-task{subtasks.length === 1 ? '' : 's'}
          </button>
          {open && (
            <ul data-testid="subtask-list" className="pl-4 pr-1 pb-1 space-y-0.5">
              {subtasks.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid="subtask-item"
                    data-todo-id={s.id}
                    onClick={onSelect ? () => onSelect(s) : undefined}
                    className="w-full text-left text-3xs truncate text-gray-600 dark:text-gray-300 hover:underline"
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** A swimlane: an epic (or the synthetic "No epic" bucket) + its ordered todos. */
interface Lane {
  key: string;
  title: string;
  epic: SessionTodo | null;
  group: 'epic' | 'mission' | 'orphan';
  items: SessionTodo[];
  /** leaf id → its auto-split sub-tasks, for the expandable sub-task row. */
  subtasks: ReadonlyMap<string, SessionTodo[]>;
  counts: Record<FunnelKey, number>;
  completed: boolean; // every child terminal (done/dropped) — a "completed epic"
  rank: number; // min child wave, for lane ordering
}

export const PlanKanban: React.FC<PlanKanbanProps> = ({ todos, onSelectTodo, showCompleted, onClearCompleted, inflightLeafIds, onPromoteToEpic }) => {

  const waveMap = useMemo(() => computeWaveMap(todos as PlanItem[]), [todos]);
  const unblocks = useMemo(() => unblocksCount(todos), [todos]);
  const byId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);

  // Build epic swimlanes: one lane per declared epic (kind === 'epic'),
  // plus a synthetic "No epic" lane for orphans. Children go in their epic's lane.
  // A leaf with children (auto-split) stays as an item in its parent epic's lane
  // and is exposed separately via subtasksByParent. Within a lane, todos flow
  // left→right by wave then plan order. Lanes order by their min child wave.
  const lanes = useMemo<Lane[]>(() => {
    const h = buildTodoHierarchy(todos);

    const byWaveOrder = (a: SessionTodo, b: SessionTodo) => {
      const wa = waveMap.get(a.id) ?? 0;
      const wb = waveMap.get(b.id) ?? 0;
      if (wa !== wb) return wa - wb;
      return (a.order ?? 0) - (b.order ?? 0);
    };
    const tally = (items: SessionTodo[]): Record<FunnelKey, number> => {
      const c: Record<FunnelKey, number> = { backlog: 0, ready: 0, inflight: 0, blocked: 0, done: 0 };
      for (const t of items) c[liveBucketTodo(t, byId, inflightLeafIds) ?? 'backlog']++;
      return c;
    };
    const minWave = (items: SessionTodo[]) =>
      items.length ? Math.min(...items.map((t) => waveMap.get(t.id) ?? 0)) : 0;

    const out: Lane[] = [];

    // One lane per declared epic (sorted children).
    for (const epicId of h.epicIds) {
      const epic = h.byId.get(epicId)!;
      if (isBucketEpicUI(epic)) continue; // buckets render in the Triage section, not plan lanes
      if (epic.status === 'dropped') continue;
      const items = (h.childrenByEpic.get(epicId) ?? []).slice().sort(byWaveOrder);
      const nonDroppedChildCount = items.filter((t) => t.status !== 'dropped').length;
      if (nonDroppedChildCount === 0) continue;
      out.push({
        key: `epic:${epicId}`,
        title: epic.title,
        epic,
        group: 'epic',
        items,
        subtasks: h.subtasksByParent,
        counts: tally(items),
        completed: items.length > 0 && items.every((t) => TERMINAL.has(t.status)),
        rank: minWave(items),
      });
    }

    // Missions lane: orphans that are missions.
    const missions = h.orphans.filter((t) => isMission(t)).slice().sort(byWaveOrder);
    if (missions.length > 0) {
      out.push({
        key: 'missions',
        title: 'Missions',
        epic: null,
        group: 'mission',
        items: missions,
        subtasks: h.subtasksByParent,
        counts: tally(missions),
        completed: missions.every((t) => TERMINAL.has(t.status)),
        rank: minWave(missions),
      });
    }

    // "No epic" lane: non-mission orphans.
    const orphans = h.orphans.filter((t) => !isMission(t)).slice().sort(byWaveOrder);
    if (orphans.length > 0) {
      out.push({
        key: 'orphans',
        title: 'No epic',
        epic: null,
        group: 'orphan',
        items: orphans,
        subtasks: h.subtasksByParent,
        counts: tally(orphans),
        completed: orphans.every((t) => TERMINAL.has(t.status)),
        rank: minWave(orphans),
      });
    }

    return out.sort((a, b) => a.rank - b.rank);
  }, [todos, waveMap, inflightLeafIds, byId]);

  const triageLanes = useMemo(() => {
    const h = buildTodoHierarchy(todos);
    const byType = new Map<BucketType, SessionTodo[]>();
    for (const epicId of h.epicIds) {
      const epic = h.byId.get(epicId)!;
      if (epic.status === 'dropped' || !isBucketEpicUI(epic)) continue;
      const type = bucketTypeOfTodo(epic);
      if (!type) continue;
      const kids = (h.childrenByEpic.get(epicId) ?? []).filter((t) => !TERMINAL.has(t.status));
      byType.set(type, [...(byType.get(type) ?? []), ...kids]);
    }
    const byWaveOrder = (a: SessionTodo, b: SessionTodo) => {
      const wa = waveMap.get(a.id) ?? 0, wb = waveMap.get(b.id) ?? 0;
      return wa !== wb ? wa - wb : (a.order ?? 0) - (b.order ?? 0);
    };
    return BUCKET_TYPE_ORDER
      .filter((t) => byType.has(t))
      .map((t) => ({ type: t, label: BUCKET_LANE_LABEL[t], items: byType.get(t)!.slice().sort(byWaveOrder) }));
  }, [todos, waveMap]);

  const [triageFilter, setTriageFilter] = useState<TriageTag | 'all'>('all');

  const visibleLanes = useMemo(
    () =>
      lanes
        // "Show completed" gates only fully-completed lanes (a done epic, or the
        // orphan group when all terminal).
        .filter((l) => showCompleted || !l.completed)
        .map((l) => {
          // A cohesive ACTIVE epic always shows its completed children (progress) —
          // never trimmed. The orphan ("No epic") group AND catch-all BUCKET epics
          // (Inbox) instead obey Show completed: their done items are just history.
          if (l.epic && !l.completed && !l.epic.isBucket) return l;
          if (showCompleted) return l;
          return { ...l, items: l.items.filter((t) => !TERMINAL.has(t.status)) };
        })
        .filter((l) => l.items.length > 0 || l.epic !== null),
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
      {/* The Plan progress chart + totals now live in PlanPanel's shared sub-header
          (shown on every tab), so the Kanban surface is just the swimlanes. */}

      {/* Vertical stack of swimlanes (epics as rows). */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {/* Epic swimlanes. */}
        {visibleLanes.map((lane) => (
          <section
            key={lane.key}
            data-testid={
              lane.group === 'epic'
                ? `epic-lane-${lane.epic!.id}`
                : lane.group === 'mission'
                  ? 'missions-lane'
                  : 'orphan-lane'
            }
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
              {lane.epic && <CopyId id={lane.epic.id} className="text-xs text-gray-400 dark:text-gray-500 mr-1 shrink-0" />}
              <button
                type="button"
                onClick={lane.epic && onSelectTodo ? () => onSelectTodo(lane.epic!) : undefined}
                className={`text-xs font-semibold text-left truncate ${
                  lane.epic && onSelectTodo ? 'hover:underline cursor-pointer' : 'cursor-default'
                } text-gray-700 dark:text-gray-200`}
                title={lane.epic ? `${lane.epic.id} — ${lane.title}` : lane.title}
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
              {/* Housekeeping: clear finished ad-hoc items from bucket (Inbox) epics and
                  the synthetic orphan ("No epic") lane. Cohesive epics are not clearable. */}
              {(() => {
                const clearableEpicId =
                  lane.epic && lane.epic.isBucket ? lane.epic.id
                  : lane.group === 'orphan' ? null
                  : undefined;
                const canClear = onClearCompleted && clearableEpicId !== undefined && lane.counts.done > 0;
                return canClear ? (
                  <button
                    type="button"
                    data-testid={lane.epic ? 'clear-completed-bucket' : 'clear-completed-orphans'}
                    onClick={() => onClearCompleted!(clearableEpicId!)}
                    title={`Permanently delete the ${lane.counts.done} completed item(s) in this lane`}
                    className="shrink-0 px-1.5 py-0.5 text-3xs rounded text-gray-500 dark:text-gray-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-300 transition-colors"
                  >
                    Clear completed ({lane.counts.done})
                  </button>
                ) : null;
              })()}
            </header>
            <div className="overflow-x-auto p-1.5">
              <div className="flex gap-2 items-start">
                {lane.items.map((t) => (
                  <PlanCard key={t.id} todo={t} unblocks={unblocks.get(t.id) ?? 0} onSelect={onSelectTodo} byId={byId} inflightLeafIds={inflightLeafIds} subtasks={lane.subtasks.get(t.id)} />
                ))}
              </div>
            </div>
          </section>
        ))}

        {triageLanes.length > 0 && (
          <section data-testid="triage-section" className="rounded-lg border bg-gray-50/60 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700">
            <header className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Triage</span>
            </header>
            <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 flex gap-1 flex-wrap">
              <button
                type="button"
                data-testid="triage-filter-all"
                onClick={() => setTriageFilter('all')}
                className={`text-3xs px-2 py-0.5 rounded transition-colors ${
                  triageFilter === 'all'
                    ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                all
              </button>
              {TRIAGE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-testid={`triage-filter-${tag}`}
                  onClick={() => setTriageFilter(tag)}
                  className={`text-3xs px-2 py-0.5 rounded transition-colors capitalize ${
                    triageFilter === tag
                      ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 font-semibold'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="space-y-2 p-1.5">
              {triageLanes.map((lane) => (
                <div key={lane.type} data-testid={`triage-lane-${lane.type}`} className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-hidden">
                  <header className="px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700">
                    {lane.label}
                  </header>
                  <div className="flex flex-wrap gap-1.5 p-1.5">
                    {lane.items
                      .filter((t) => triageFilter === 'all' || t.triageTag === triageFilter)
                      .map((t) => (
                        <div key={t.id} className="space-y-1 w-56">
                          <PlanCard todo={t} unblocks={unblocks.get(t.id) ?? 0} onSelect={onSelectTodo} byId={byId} inflightLeafIds={inflightLeafIds} subtasks={undefined} />
                          <button
                            type="button"
                            data-testid="promote-to-epic"
                            data-todo-id={t.id}
                            disabled={!onPromoteToEpic}
                            title={onPromoteToEpic ? 'Promote to a deliverable epic' : 'Promote to epic — not available yet'}
                            onClick={onPromoteToEpic ? () => onPromoteToEpic(t) : undefined}
                            className="w-full text-left px-3 py-1 text-3xs rounded text-accent-700 dark:text-accent-300 hover:bg-accent-50 dark:hover:bg-accent-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Promote to epic
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default PlanKanban;
