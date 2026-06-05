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

/** The escalation a "focus" affordance should jump to first (most recent open). */
export function highestPriorityEscalation(open: Escalation[]): Escalation | null {
  if (open.length === 0) return null;
  return open.reduce((best, e) => (e.createdAt > best.createdAt ? e : best), open[0]);
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
