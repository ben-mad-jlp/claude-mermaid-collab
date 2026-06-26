/**
 * Shared work-graph funnel logic (Control-UI vision §4).
 *
 * Buckets a project's todos into the Backlog ▸ Ready ▸ In-flight ▸ Blocked ▸
 * Done progression. Mirrors CoordinatorView's lane predicates so the Bridge
 * funnel and the Coordinator lanes never disagree.
 */

import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';
import { claimReason, buildById } from '@/lib/claimability';

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
  /**
   * Bucket predicate. `byId` (the work-graph map) is passed so the predicate can
   * call `claimReason` — the SINGLE source of truth for ready/blocked/in-flight
   * (epic b2c858d4). It is OPTIONAL so legacy single-arg callers still compile;
   * when absent the predicate falls back to a `byId`-free best effort (no dep
   * resolution available), which is acceptable for unmigrated call sites.
   */
  match: (t: SessionTodo, byId?: Map<string, SessionTodo>) => boolean;
}

// A terminal status (done/dropped) must win over a stale claim: completeTodo
// marks status='done' but does NOT clear claimedBy, so without this guard a
// finished todo's lingering claimedBy would mis-bucket it as In-flight.
const isInflight = (s: TodoStatus, t: SessionTodo) =>
  s === 'in_progress' || (!!t.claim || !!t.claimedBy) && s !== 'done' && s !== 'dropped';

export const FUNNEL_SEGMENTS: FunnelSegment[] = [
  {
    key: 'backlog',
    label: 'Backlog',
    tint: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
    match: (t) => (t.status === 'backlog' || t.status === 'planned' || t.status === 'todo') && !t.heldAt,
  },
  {
    key: 'ready',
    label: 'Ready',
    // Ready=violet (claimable/queued) so it reads distinctly from backlog gray.
    tint: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
    // Derived "ready" = the predicate says it is actionable now: an agent todo
    // the daemon can claim, or a fully-unblocked human todo. Rendered VERBATIM
    // from claimReason — never re-derived. When `byId` is absent (an unmigrated
    // single-todo caller that can't resolve deps) fall back to the legacy enum
    // read so those sites keep their prior behavior until they thread `byId`.
    match: (t, byId) => {
      if (byId == null) return t.status === 'ready' && !t.claim && !t.claimedBy;
      const r = claimReason(t, byId);
      return r === 'claimable' || r === 'human-assignee';
    },
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
    // Derived "blocked" = held, dep-rejected, deps-pending, or self-rejected (the
    // needs-a-human states), read VERBATIM from claimReason. Legacy fallback (no
    // byId) reads the old enum so unmigrated callers are unchanged.
    match: (t, byId) => {
      if (t.heldAt != null) return true;
      if (byId == null) return t.status === 'blocked';
      const r = claimReason(t, byId);
      return r === 'held' || r === 'dep-rejected' || r === 'deps-pending' || r === 'rejected';
    },
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

/**
 * First matching segment wins, so each todo lands in exactly one bucket. Pass
 * `byId` (the work-graph map) so the ready/blocked/in-flight buckets resolve via
 * `claimReason`; omit it only at legacy single-todo call sites (then those
 * derived buckets are skipped and the todo falls through to backlog/done).
 */
export function bucketTodo(t: SessionTodo, byId?: Map<string, SessionTodo>): FunnelKey | null {
  for (const seg of FUNNEL_SEGMENTS) {
    if (seg.match(t, byId)) return seg.key;
  }
  return null;
}

/**
 * The LIVE status bucket: the daemon-ledger ∪ local-status union. A todo the
 * leaf-executor daemon reports as running (id ∈ inflightLeafIds) is `inflight`
 * even though its stored status never flips claimedBy/in_progress (headless runs);
 * otherwise it falls back to the stored-status bucket via bucketTodo(t, byId).
 * This is the SINGLE selector every Plan surface (list, kanban, plan graph,
 * fleet graph) reads, so their status colors can never drift apart.
 */
export function liveBucketTodo(
  t: SessionTodo,
  byId?: Map<string, SessionTodo>,
  inflightLeafIds?: ReadonlySet<string>,
): FunnelKey | null {
  if (inflightLeafIds?.has(t.id)) return 'inflight';
  return bucketTodo(t, byId);
}

/** Live status style (color set) — liveBucketTodo + STATUS_STYLE. */
export function liveStatusStyle(
  t: SessionTodo,
  byId?: Map<string, SessionTodo>,
  inflightLeafIds?: ReadonlySet<string>,
): StatusStyle | null {
  const k = liveBucketTodo(t, byId, inflightLeafIds);
  return k ? STATUS_STYLE[k] : null;
}

/**
 * An epic's OWN status bucket, for tinting the epic node header (distinct from the
 * child-rollup bar). An epic isn't a claimable leaf, so it has no `claimReason`
 * bucket of its own — we read its live state from the child rollup first (what the
 * epic is actually DOING dominates), then fall back to the epic todo's own derived
 * status. Precedence: any child in-flight → inflight; else any child blocked →
 * blocked; else all children done → done; else the epic is approved/ready → ready;
 * else backlog. Reuses the canonical FunnelKey palette — no new tokens.
 */
export function epicBucket(counts: Record<FunnelKey, number>, ownStatus: string): FunnelKey {
  const total = counts.backlog + counts.ready + counts.inflight + counts.blocked + counts.done;
  if (counts.inflight > 0) return 'inflight';
  if (counts.blocked > 0) return 'blocked';
  // `done` keys off the epic's OWN status too: the graph hides done children, so an
  // all-done epic has no visible children to count (counts.done would be 0).
  if (ownStatus === 'done' || (total > 0 && counts.done === total)) return 'done';
  if (ownStatus === 'ready') return 'ready';
  return 'backlog';
}

/** Resolve a todo straight to its canonical status style (null if unbucketed). */
export function statusStyle(t: SessionTodo, byId?: Map<string, SessionTodo>): StatusStyle | null {
  const k = bucketTodo(t, byId);
  return k ? STATUS_STYLE[k] : null;
}

/**
 * Drop EPIC/container todos so the progress funnel counts only WORK todos. An
 * epic is emergent — a todo that is the `parentId` of another todo in the set
 * (same definition useFleetGraph / BridgeDashboard use). Counting epics
 * double-counts (the epic + its children) and, worse, a container left
 * `in_progress` after its children finish sticks forever in the In-flight bucket.
 */
export function excludeEpics(todos: SessionTodo[]): SessionTodo[] {
  const parentIds = new Set<string>();
  for (const t of todos) if (t.parentId) parentIds.add(t.parentId);
  return todos.filter((t) => !parentIds.has(t.id));
}

export function funnelCounts(todos: SessionTodo[]): Record<FunnelKey, number> {
  const counts: Record<FunnelKey, number> = {
    backlog: 0,
    ready: 0,
    inflight: 0,
    blocked: 0,
    done: 0,
  };
  const byId = buildById(todos);
  for (const t of todos) {
    const key = bucketTodo(t, byId);
    if (key) counts[key] += 1;
  }
  return counts;
}

export function todosInSegment(todos: SessionTodo[], key: FunnelKey): SessionTodo[] {
  const byId = buildById(todos);
  return todos.filter((t) => bucketTodo(t, byId) === key);
}
