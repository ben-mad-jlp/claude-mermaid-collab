/**
 * The single source of "what needs a human" for a project (Bridge P1).
 *
 * The CommandBarBadge, the NeedsYou/Z-rail, the FleetGraph TodoNode danger ring
 * and the focal DecisionCard MUST all derive their "open escalation" set from
 * THIS one selector so they can never disagree. The load-bearing invariant is:
 *
 *     selectOpenEscalations(...).length > 0  ⟺  ≥1 graph node has data.danger
 *
 * (every open escalation belongs to a worker session that claims/owns a todo,
 * and that todo's node is tinted danger — see useFleetGraph `dangerFor`).
 */

import type { Escalation } from '@/stores/supervisorStore';

/** Open escalations scoped to a single project — the one true "needs you" set. */
export function selectOpenEscalations(escalations: Escalation[], project: string): Escalation[] {
  return escalations.filter((e) => e.project === project && e.status === 'open');
}

/**
 * Open-escalation counts per project — the SOLE roll-up path for the multi-project
 * Bridge (design-tabbed-bridge §3d). One reduce over the global flat `escalations`
 * list feeds every count: each Project Rail row badge (`counts[p] ?? 0`), the FLEET
 * row badge and the global CommandBarBadge (`sum(counts)`). By construction
 * `selectOpenEscalations(escalations, p).length === counts[p]`, so the rail badge,
 * the per-project NeedsYouZone and the FleetGraph danger ring can never diverge —
 * enforced by a parity unit test.
 */
export function selectOpenEscalationsByProject(escalations: Escalation[]): Record<string, number> {
  return escalations.reduce((m, e) => {
    if (e.status === 'open') m[e.project] = (m[e.project] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>);
}

/** Fleet-wide open-escalation total — `sum(selectOpenEscalationsByProject)`. */
export function selectFleetOpenCount(escalations: Escalation[]): number {
  let n = 0;
  for (const e of escalations) if (e.status === 'open') n++;
  return n;
}

/** The escalation a "focus" affordance should jump to first (most recent open). */
export function highestPriorityEscalation(open: Escalation[]): Escalation | null {
  if (open.length === 0) return null;
  return open.reduce((best, e) => (e.createdAt > best.createdAt ? e : best), open[0]);
}

/**
 * Steward provenance (Steward P3): true when the steward triaged this escalation
 * and routed it on to the human (`routedTo === 'steward'`). The NeedsYouZone card
 * shows a "steward sent this to you" tag for these so a person can tell a
 * triaged-and-deferred item from one the steward never saw. Absent routedTo
 * (legacy / steward-auto OFF) reads as 'human' → not steward-routed.
 */
export function isStewardRouted(e: Escalation): boolean {
  return e.routedTo === 'steward';
}

/** The steward-deferred subset of an already-open escalation set. */
export function selectStewardDeferred(open: Escalation[]): Escalation[] {
  return open.filter(isStewardRouted);
}

/**
 * Map an escalation to the FleetGraph node id it should frame: the todo claimed
 * by / assigned to / owned by the escalation's worker session. Todo node ids ARE
 * the todo id (see useFleetGraph), so we return that id directly. Null when no
 * todo matches (e.g. the worker holds no todo) — caller skips the focus.
 */
export function nodeIdForEscalation(
  esc: Escalation,
  todos: { id: string; claimedBy?: string | null; assigneeSession?: string | null; sessionName?: string | null }[],
): string | null {
  const match = todos.find(
    (t) => t.claimedBy === esc.session || t.assigneeSession === esc.session || t.sessionName === esc.session,
  );
  return match ? match.id : null;
}
