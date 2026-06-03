/**
 * Shared work-graph funnel logic (Control-UI vision §4).
 *
 * Buckets a project's todos into the Backlog ▸ Ready ▸ In-flight ▸ Blocked ▸
 * Done progression. Mirrors CoordinatorView's lane predicates so the Bridge
 * funnel and the Coordinator lanes never disagree.
 */

import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';

export type FunnelKey = 'backlog' | 'ready' | 'inflight' | 'blocked' | 'done';

export interface FunnelSegment {
  key: FunnelKey;
  label: string;
  /** Tailwind text tint for the count label. */
  tint: string;
  /** Whether this segment is "loud" (danger-toned) while it has items. */
  loud?: boolean;
  match: (t: SessionTodo) => boolean;
}

// A terminal status (done/dropped) must win over a stale claim: completeTodo
// marks status='done' but does NOT clear claimedBy, so without this guard a
// finished todo's lingering claimedBy would mis-bucket it as In-flight.
const isInflight = (s: TodoStatus, t: SessionTodo) =>
  s === 'in_progress' || (!!t.claimedBy && s !== 'done' && s !== 'dropped');

export const FUNNEL_SEGMENTS: FunnelSegment[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    tint: 'text-gray-500 dark:text-gray-400',
    match: (t) => t.status === 'backlog' || t.status === 'planned' || t.status === 'todo',
  },
  {
    key: 'ready',
    label: 'Ready',
    tint: 'text-gray-600 dark:text-gray-300',
    match: (t) => t.status === 'ready' && !t.claimedBy,
  },
  {
    key: 'inflight',
    label: 'In-flight',
    tint: 'text-info-600 dark:text-info-400',
    match: (t) => isInflight(t.status, t),
  },
  {
    key: 'blocked',
    label: 'Blocked',
    tint: 'text-danger-600 dark:text-danger-400',
    loud: true,
    match: (t) => t.status === 'blocked',
  },
  {
    key: 'done',
    label: 'Done',
    tint: 'text-success-600 dark:text-success-400',
    match: (t) => t.status === 'done',
  },
];

/** First matching segment wins, so each todo lands in exactly one bucket. */
export function bucketTodo(t: SessionTodo): FunnelKey | null {
  for (const seg of FUNNEL_SEGMENTS) {
    if (seg.match(t)) return seg.key;
  }
  return null;
}

export function funnelCounts(todos: SessionTodo[]): Record<FunnelKey, number> {
  const counts: Record<FunnelKey, number> = {
    backlog: 0,
    ready: 0,
    inflight: 0,
    blocked: 0,
    done: 0,
  };
  for (const t of todos) {
    const key = bucketTodo(t);
    if (key) counts[key] += 1;
  }
  return counts;
}

export function todosInSegment(todos: SessionTodo[], key: FunnelKey): SessionTodo[] {
  return todos.filter((t) => bucketTodo(t) === key);
}
