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
  /**
   * Tailwind segment FILL (background + readable text) — the SINGLE source of
   * each bucket's color, so the funnel bar, the worker roster and the graph
   * nodes can't disagree. inflight=info, done=success, blocked=warning (amber,
   * NOT red — one-red: danger is reserved for open escalations), ready/backlog=
   * neutral.
   */
  bg: string;
  /** Whether this segment is "loud" while it has items (blocked → solid amber). */
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
    bg: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
    match: (t) => t.status === 'backlog' || t.status === 'planned' || t.status === 'todo',
  },
  {
    key: 'ready',
    label: 'Ready',
    // Ready=violet (claimable/queued) so it reads distinctly from backlog gray.
    tint: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
    match: (t) => t.status === 'ready' && !t.claimedBy,
  },
  {
    key: 'inflight',
    label: 'In-flight',
    tint: 'text-info-600 dark:text-info-400',
    bg: 'bg-info-100 dark:bg-info-900/40 text-info-700 dark:text-info-300',
    match: (t) => isInflight(t.status, t),
  },
  {
    key: 'blocked',
    label: 'Blocked',
    // One-red: blocked is amber (warning), not red — danger is reserved for
    // open escalations only.
    tint: 'text-warning-600 dark:text-warning-400',
    bg: 'bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300',
    loud: true,
    match: (t) => t.status === 'blocked',
  },
  {
    key: 'done',
    label: 'Done',
    tint: 'text-success-600 dark:text-success-400',
    bg: 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300',
    match: (t) => t.status === 'done',
  },
];

/**
 * The SINGLE status-bucket label vocabulary. Every surface that shows a status
 * bucket name — the Bridge funnel, the Plan progress header, the FleetGraph
 * TodoNode pills — reads its label from here, so the words can never drift apart
 * (e.g. a node calling it "inflight" while the funnel says "In-flight"). NOTE:
 * these are STATUS-bucket labels; the Plan "Startable" lane is a separate
 * CAPABILITY concept (deps-satisfied + unclaimed) and deliberately does NOT
 * reuse the status word "Ready".
 */
export const FUNNEL_LABELS: Record<FunnelKey, string> = FUNNEL_SEGMENTS.reduce(
  (acc, seg) => {
    acc[seg.key] = seg.label;
    return acc;
  },
  {} as Record<FunnelKey, string>,
);

/** How long a DONE todo stays counted in the Bridge progress funnel. Past this,
 *  a completed todo drops out of the bar so the Done bucket reflects RECENT
 *  throughput, not all-time history. Override via the helper's `maxAgeMs` arg. */
export const DONE_RECENT_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Drop DONE todos whose `completedAt` is older than `maxAgeMs` (default 1 day) so
 * they no longer show in the Bridge progress funnel. Non-done todos and done todos
 * with no/recent completedAt are kept. Pure (now injected for testability).
 */
export function withRecentDoneOnly(
  todos: SessionTodo[],
  maxAgeMs: number = DONE_RECENT_MS,
  now: number = Date.now(),
): SessionTodo[] {
  return todos.filter((t) => {
    if (t.status !== 'done') return true;
    if (!t.completedAt) return true; // no timestamp → can't age it out; keep
    const ts = new Date(t.completedAt).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts <= maxAgeMs;
  });
}

/**
 * Canonical per-bucket color styles — the SINGLE source every status-color
 * surface reads from. `dot` (status dots), `pill` (chips/badges), `tint` (text),
 * `bg` (fills). One distinct hue per status: backlog=gray, ready=violet,
 * inflight=info(blue), blocked=warning(amber, NEVER red), done=success(green).
 * danger/red is reserved EXCLUSIVELY for open escalations.
 */
export interface StatusStyle { dot: string; pill: string; tint: string; bg: string; }
export const STATUS_STYLE: Record<FunnelKey, StatusStyle> = {
  backlog:  { dot: 'bg-gray-400',    pill: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',       tint: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
  ready:    { dot: 'bg-violet-500',  pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', tint: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
  inflight: { dot: 'bg-info-500',    pill: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',    tint: 'text-info-600 dark:text-info-400',       bg: 'bg-info-100 dark:bg-info-900/40 text-info-700 dark:text-info-300' },
  blocked:  { dot: 'bg-warning-500', pill: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300', tint: 'text-warning-600 dark:text-warning-400', bg: 'bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300' },
  done:     { dot: 'bg-success-500', pill: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300', tint: 'text-success-600 dark:text-success-400', bg: 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300' },
};

/** First matching segment wins, so each todo lands in exactly one bucket. */
export function bucketTodo(t: SessionTodo): FunnelKey | null {
  for (const seg of FUNNEL_SEGMENTS) {
    if (seg.match(t)) return seg.key;
  }
  return null;
}

/** Resolve a todo straight to its canonical status style (null if unbucketed). */
export function statusStyle(t: SessionTodo): StatusStyle | null {
  const k = bucketTodo(t);
  return k ? STATUS_STYLE[k] : null;
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
