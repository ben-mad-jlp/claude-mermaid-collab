/**
 * Notification router (pure core) — turns a todo-state DIFF into the coalesced
 * notifications that subscribed sessions should receive. Separated from all I/O (the DB
 * enqueue, the tick snapshot, the send-keys nudge) so the matching/diff logic is fully
 * unit-testable with no timing/tmux. The impure wiring (snapshot persistence per tick +
 * delivery) lives in the coordinator tick (phase 4).
 *
 * Source of truth: a per-tick snapshot of todo {status, acceptanceStatus} diffed against
 * the current list. The daemon already ticks, so the steward agent never polls — the diff
 * runs server-side and only NOTABLE transitions (terminal / blocked / acceptance) notify.
 */

import { subscriptionMatches, type Subscription, type SubscribableEvent } from './session-subscriptions';
import type { Todo } from './todo-store';
import { isEpic, isMission } from './todo-kind';

export interface TodoSnapshot {
  status: string;
  acceptanceStatus: string | null;
}
export type SnapshotMap = Map<string, TodoSnapshot>;

export interface ChangeEvent {
  project: string;
  todoId: string;
  epicId: string | null;
  missionId: string | null;
  /** lifecycle change kind */
  event:
    | 'todo_new'
    | 'todo_started'
    | 'todo_ready'
    | 'todo_done'
    | 'todo_accepted'
    | 'todo_rejected'
    | 'todo_blocked'
    | 'todo_dropped'
    | 'todo_updated';
  summary: string;
}

export interface PlannedNotification {
  project: string;
  session: string;
  scope: Subscription['scope'];
  targetId: string;
  event: string;
  summary: string;
}

/** Build a {status, acceptanceStatus} snapshot of the current todos, keyed by id. */
export function snapshotTodos(todos: Todo[]): SnapshotMap {
  const m: SnapshotMap = new Map();
  for (const t of todos) m.set(t.id, { status: t.status, acceptanceStatus: t.acceptanceStatus ?? null });
  return m;
}

/** Nearest ancestor (self included) satisfying `pred`, walking parentId. Depth-capped
 *  (50) so a cycle terminates. The ONE ancestor walker — epic and mission both use it. */
function resolveAncestorId(todo: Todo, byId: Map<string, Todo>, pred: (t: Todo) => boolean): string | null {
  let cur: Todo | undefined = todo;
  for (let i = 0; cur && i < 50; i++) {
    if (pred(cur)) return cur.id;
    if (!cur.parentId) return null;
    cur = byId.get(cur.parentId);
  }
  return null;
}

/** Nearest EPIC ancestor id (walks parentId), or null. Kind-based, cycle-safe.
 *  Returns null — NOT the Inbox epic — when there is no epic ancestor; epic-scoped
 *  subscriptions depend on that. A MISSION ancestor is not an epic and does not stop
 *  the walk. */
const resolveEpicId = (t: Todo, byId: Map<string, Todo>) => resolveAncestorId(t, byId, isEpic);

/** Nearest MISSION ancestor id (walks parentId), or null if no mission ancestor.
 *  Self-inclusive, so resolveMissionId(missionNode) returns the mission's own id,
 *  and a change to the mission node itself notifies its subscriber. */
const resolveMissionId = (t: Todo, byId: Map<string, Todo>) => resolveAncestorId(t, byId, isMission);

/** Stored-status → event kind. Anything not listed → 'todo_updated' (generic). */
const STATUS_EVENT: Record<string, ChangeEvent['event']> = {
  in_progress: 'todo_started',
  ready: 'todo_ready',
  done: 'todo_done',
  blocked: 'todo_blocked',
  dropped: 'todo_dropped',
};

/**
 * Diff a prior snapshot against the current todos and emit a ChangeEvent for ANY lifecycle
 * change — a NEW todo, ANY stored-status transition (started/ready/done/blocked/dropped/other),
 * or an acceptance flip (accepted/rejected). The user wants every update surfaced, not just
 * the "needs assistance" ones; coalescing per subscriber (the tick) keeps a burst to one nudge.
 * First-ever run (empty prev) emits nothing — it just seeds the snapshot.
 */
export function diffTodos(prev: SnapshotMap, todos: Todo[], project: string): ChangeEvent[] {
  if (prev.size === 0) return []; // seed pass — no spurious burst on startup
  const byId = new Map(todos.map((t) => [t.id, t]));
  const out: ChangeEvent[] = [];
  for (const t of todos) {
    const before = prev.get(t.id);
    const epicId = resolveEpicId(t, byId);
    const missionId = resolveMissionId(t, byId);
    const title = t.title ?? t.id;
    const short = t.id.slice(0, 8);
    if (!before) {
      out.push({ project, todoId: t.id, epicId, missionId, event: 'todo_new', summary: `${short} new: ${title}` });
      continue;
    }
    // Acceptance transition takes priority (it's the real outcome).
    const acc = t.acceptanceStatus ?? null;
    if (acc !== before.acceptanceStatus && (acc === 'accepted' || acc === 'rejected')) {
      out.push({ project, todoId: t.id, epicId, missionId, event: acc === 'accepted' ? 'todo_accepted' : 'todo_rejected', summary: `${short} ${acc}: ${title}` });
      continue;
    }
    if (t.status !== before.status) {
      out.push({ project, todoId: t.id, epicId, missionId, event: STATUS_EVENT[t.status] ?? 'todo_updated', summary: `${short} ${t.status}: ${title}` });
    }
  }
  return out;
}

/**
 * Match changes against active subscriptions → one PlannedNotification per (change, matching
 * subscriber). `selfActor` (optional) suppresses notifying a session about a change IT caused
 * — a token-waste filter, not a safety guard (daemon-driven changes have no actor → delivered).
 */
export function planNotifications(
  changes: ChangeEvent[],
  subs: Subscription[],
  actorBySession?: Map<string, string>, // todoId → actor session (optional self-suppression)
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (const c of changes) {
    const evt: SubscribableEvent = { project: c.project, todoId: c.todoId, epicId: c.epicId, missionId: c.missionId };
    const actor = actorBySession?.get(c.todoId);
    for (const s of subs) {
      if (actor && actor === s.session) continue; // self-suppression
      if (!subscriptionMatches(s, evt)) continue;
      out.push({ project: s.project, session: s.session, scope: s.scope, targetId: s.targetId, event: c.event, summary: c.summary });
    }
  }
  return out;
}
