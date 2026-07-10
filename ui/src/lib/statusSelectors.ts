/**
 * statusSelectors — the single shared, PURE selector family for UI status coherence.
 *
 * Per design-ui-status-coherence §1/§3 (epic d5b1ff4e). The left column and the
 * Bridge MUST render identical escalation/worker state at any instant. They achieve
 * this by both reading the *same* store slices through *these same* pure selectors,
 * narrowed by an *explicit* {@link StatusScope}. The only intended difference between
 * a fleet badge and a project zone is the `scope` argument — a deliberate decision,
 * never an accidental drift.
 *
 * INVARIANT: this module is PURE. It does not import or read any store; the caller
 * passes the already-loaded slices (escalation array, session map). That is what
 * makes the coherence guarantee provable: same input slice + same scope + same pure
 * function ⇒ identical output at every render, on both surfaces.
 *
 * Scope narrowing is strict containment: fleet ⊃ project ⊃ session.
 */

import type { Escalation } from '@/stores/supervisorStore';

/**
 * The canonical display scope. Both surfaces operate over the aggregated union of
 * all watched servers/projects, then narrow with one of these. Note: scope does NOT
 * carry a serverId — escalations and liveness are surfaced as a server-stamped union
 * (active-server is used for invoke *routing*, never for deciding what to display).
 */
export type StatusScope =
  | { kind: 'fleet' } // all watched servers + projects
  | { kind: 'project'; project: string } // one project, any watched server
  | { kind: 'session'; project: string; session: string };

/**
 * The liveness fact for one session, as held by `subscriptionStore` (the single
 * source of worker liveness — WS-native, composite-keyed `${serverId}:${project}:${session}`).
 * Declared structurally here so this pure module has no store dependency at runtime.
 */
export interface SessionStatus {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate?: number;
  contextPercent?: number;
  /** Last-known status carried across a reopen, not yet confirmed by a live event. */
  stale?: boolean;
}

/**
 * Options that customize the liveness roll-up. Passed in (never read from a store) so
 * this module remains pure — all state comes from callers.
 */
export interface LivenessOptions {
  /** True when the Orchestrator daemon is building leaves this session owns. Such a
   *  session is quiet on purpose: it is NOT waiting on the human, so it must not be
   *  counted in `needsAttention`. Passed in (never read from a store) — this module
   *  is pure by invariant (see file header). */
  daemonBuilding?: (s: SessionStatus) => boolean;
}

/**
 * A scope-narrowed roll-up of session liveness. `needsAttention` is the
 * status-side "needs you" set (waiting OR permission) — distinct from an open
 * escalation (audit D4); both surfaces read it from here so they cannot disagree.
 */
export interface LivenessView {
  /** The sessions inside the scope (stable order: input map insertion order). */
  sessions: SessionStatus[];
  total: number;
  active: number;
  waiting: number;
  permission: number;
  unknown: number;
  /** Sessions whose last-known status is carried over but unconfirmed. */
  stale: number;
  /** waiting + permission — a human is (likely) blocking these. */
  needsAttention: number;
}

/** True when an escalation is in the live "needs you" set. */
function isOpen(e: Escalation): boolean {
  return e.status === 'open';
}

/** True when escalation `e` falls inside `scope`. */
function escalationInScope(e: Escalation, scope: StatusScope): boolean {
  switch (scope.kind) {
    case 'fleet':
      return true;
    case 'project':
      return e.project === scope.project;
    case 'session':
      return e.project === scope.project && e.session === scope.session;
  }
}

/** True when session `s` falls inside `scope`. */
function sessionInScope(s: SessionStatus, scope: StatusScope): boolean {
  switch (scope.kind) {
    case 'fleet':
      return true;
    case 'project':
      return s.project === scope.project;
    case 'session':
      return s.project === scope.project && s.session === scope.session;
  }
}

/**
 * The open escalations inside `scope` — the one true "needs you" set, consumed
 * identically by the left card badge and the Bridge NeedsYouZone. Tolerant of a
 * non-array input (returns []) so a not-yet-hydrated slice never throws.
 */
export function selectOpenEscalations(open: Escalation[], scope: StatusScope): Escalation[] {
  if (!Array.isArray(open)) return [];
  return open.filter((e) => isOpen(e) && escalationInScope(e, scope));
}

/**
 * Count of open escalations inside `scope`. By construction
 * `selectOpenEscalationCount(open, scope) === selectOpenEscalations(open, scope).length`
 * (parity-tested) — the fleet badge, project rail badge and per-project zone can
 * never diverge because they share this function.
 */
export function selectOpenEscalationCount(open: Escalation[], scope: StatusScope): number {
  if (!Array.isArray(open)) return 0;
  let n = 0;
  for (const e of open) if (isOpen(e) && escalationInScope(e, scope)) n++;
  return n;
}

/**
 * Split the open escalations inside `scope` into the two display buckets the project
 * status surfaces treat DIFFERENTLY:
 *   - `landReady`: kind `'epic-ready-to-land'` — a POSITIVE "ready to ship" prompt. It
 *     never means the project is stuck, so it is shown with a download glyph, NOT red.
 *   - `blockers`: everything else (blocker / decision / assumption-invalidated / …) — a
 *     genuine "paused on a human" item → red.
 * `total === blockers + landReady === selectOpenEscalationCount(open, scope)` (parity).
 */
export function selectEscalationKindCounts(
  open: Escalation[],
  scope: StatusScope,
): { blockers: number; landReady: number; total: number } {
  let blockers = 0;
  let landReady = 0;
  if (Array.isArray(open)) {
    for (const e of open) {
      if (!isOpen(e) || !escalationInScope(e, scope)) continue;
      if (e.kind === 'epic-ready-to-land') landReady++;
      else blockers++;
    }
  }
  return { blockers, landReady, total: blockers + landReady };
}

/**
 * Roll up session liveness inside `scope`. `sessions` is the `subscriptionStore`
 * map (`compositeKey → SessionStatus`); iteration order follows the map's own key
 * order so the result is deterministic for a given input.
 */
export function selectLiveness(
  sessions: Record<string, SessionStatus>,
  scope: StatusScope,
  opts: LivenessOptions = {},
): LivenessView {
  const view: LivenessView = {
    sessions: [],
    total: 0,
    active: 0,
    waiting: 0,
    permission: 0,
    unknown: 0,
    stale: 0,
    needsAttention: 0,
  };
  if (!sessions) return view;
  for (const s of Object.values(sessions)) {
    if (!s || !sessionInScope(s, scope)) continue;
    view.sessions.push(s);
    view.total++;
    switch (s.status) {
      case 'active':
        view.active++;
        break;
      case 'waiting':
        view.waiting++;
        if (!opts.daemonBuilding?.(s)) view.needsAttention++;
        break;
      case 'permission':
        view.permission++;
        view.needsAttention++;
        break;
      case 'unknown':
        view.unknown++;
        break;
    }
    if (s.stale) view.stale++;
  }
  return view;
}

/**
 * Look up one session's status by its full identity. Tries the exact composite key
 * (`${serverId}:${project}:${session}`) first, then falls back to a serverId-agnostic
 * scan on (project, session) — this tolerates the `'local'`-sentinel vs. real-server-id
 * mismatch noted in the audit (D6) so a supervised row keyed under the sentinel still
 * resolves its live status. Returns undefined when no session matches.
 */
export function selectSessionStatus(
  sessions: Record<string, SessionStatus>,
  serverId: string,
  project: string,
  session: string,
): SessionStatus | undefined {
  if (!sessions) return undefined;
  const exact = sessions[`${serverId}:${project}:${session}`];
  if (exact) return exact;
  for (const s of Object.values(sessions)) {
    if (s && s.project === project && s.session === session) return s;
  }
  return undefined;
}
