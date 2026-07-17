/**
 * Notification tick (impure wiring) — runs once per project per coordinator tick:
 *   diff todos vs the last snapshot → match active subscriptions → enqueue notifications
 *   → nudge each idle subscriber that has pending items (min-interval throttled).
 *
 * Deps are injectable so the orchestration is unit-testable without the real todo-store /
 * tmux. The pure diff/match is `session-notification-router`; the delivery is
 * `claude-launch.nudgeSession` (idle-gated send-keys).
 */

import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import {
  listAllSubscriptions,
  enqueueNotification,
  pendingCount,
  listPending,
  expireSubscriptionsForTarget,
} from './session-subscriptions';
import { snapshotTodos, diffTodos, planNotifications, type SnapshotMap } from './session-notification-router';
import { nudgeSession } from './claude-launch';
import { fireStamp } from './nudge-stamp';

/** Don't re-nudge a session more often than this (coalesces a burst into one wake). */
export const MIN_NUDGE_INTERVAL_MS = 60_000;
/** How many unseen summaries to carry inline in a nudge (triage without a pull). */
export const NUDGE_SUMMARY_LIMIT = 3;
/** Base delay before an UNCHANGED backlog is re-announced; doubles per re-announce (decay). */
export const REANNOUNCE_BASE_MS = MIN_NUDGE_INTERVAL_MS * 5;

export interface NotificationTickDeps {
  loadTodos?: (project: string) => Todo[];
  nudge?: (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'no-tmux'>;
  now?: () => number;
}

interface NudgeState { count: number; at: number; reannounces: number }

// Per-project last-seen snapshot + per-(project,session) nudge state. In-memory: a
// daemon restart just re-seeds (first tick emits nothing), which is the safe default.
const snapByProject = new Map<string, SnapshotMap>();
const nudgeState = new Map<string, NudgeState>();

/** Test seam: clear the in-memory snapshot + throttle state. */
export function __resetTickState(): void {
  snapByProject.clear();
  nudgeState.clear();
}

export async function runNotificationTick(
  project: string,
  deps: NotificationTickDeps = {},
): Promise<{ enqueued: number; nudged: string[] }> {
  const load = deps.loadTodos ?? ((p) => listTodos(p, { includeCompleted: true }));
  const nudge = deps.nudge ?? nudgeSession;
  const now = deps.now ?? Date.now;

  const subs = listAllSubscriptions().filter((s) => s.project === project);
  if (subs.length === 0) {
    snapByProject.delete(project); // nothing subscribed — don't hold a snapshot
    return { enqueued: 0, nudged: [] };
  }

  // 1. Diff vs the last snapshot, then update it (first pass seeds → emits nothing).
  const todos = load(project);
  const prev = snapByProject.get(project) ?? new Map();
  const changes = diffTodos(prev, todos, project);
  snapByProject.set(project, snapshotTodos(todos));

  // 2. Match → enqueue.
  const planned = planNotifications(changes, subs);
  for (const n of planned) {
    enqueueNotification({ project: n.project, session: n.session, scope: n.scope, targetId: n.targetId, event: n.event, summary: n.summary, ts: now() });
  }

  // 3. Expire todo/epic subs whose target just went terminal (notification already queued).
  for (const c of changes) {
    if (c.event === 'todo_done' || c.event === 'todo_accepted' || c.event === 'todo_dropped') {
      expireSubscriptionsForTarget(project, c.todoId);
    }
  }

  // 4. Nudge subscribers with pending items, throttled. 'busy'/'no-tmux' → leave queued.
  const nudged: string[] = [];
  for (const session of [...new Set(subs.map((s) => s.session))]) {
    const count = pendingCount(project, session);
    if (count === 0) {
      const key = `${project}::${session}`;
      nudgeState.delete(key);
      continue;
    }
    const key = `${project}::${session}`;
    const st = nudgeState.get(key);
    const sinceLast = now() - (st?.at ?? -Infinity);
    if (sinceLast < MIN_NUDGE_INTERVAL_MS) continue;
    const grew = count > (st?.count ?? 0);
    const backoff = REANNOUNCE_BASE_MS * Math.pow(2, st?.reannounces ?? 0);
    const reannounceDue = !!st && sinceLast >= backoff;
    if (!grew && !reannounceDue) continue;
    const label = project.split('/').pop() || project;
    const items = listPending(project, session, NUDGE_SUMMARY_LIMIT);
    const head = `${fireStamp(now())} 📥 ${count} update${count === 1 ? '' : 's'} on ${label} — call inbox()`;
    // Chronic non-drainer: same queue re-announcing means the session is acting on the
    // nudge SUMMARIES without ever draining — the pull is the ACK; say so explicitly
    // instead of silently repeating the same items forever (observed: 35-deep queue).
    const reannounces = st?.reannounces ?? 0;
    const nag = !grew && reannounces >= 1
      ? `\n  ⚠ these updates are RE-ANNOUNCING because inbox() was never called — inbox() is the acknowledgement; drain it FIRST, then act.`
      : '';
    const lines = items.map((n) => `  • ${n.summary}`).join('\n');
    const text = `${head}${nag}${lines ? `\n${lines}` : ''}`;
    const res = await nudge(project, session, text);
    if (res === 'sent') {
      nudgeState.set(key, { count, at: now(), reannounces: grew ? 0 : (st?.reannounces ?? 0) + 1 });
      nudged.push(session);
    }
  }

  return { enqueued: planned.length, nudged };
}
