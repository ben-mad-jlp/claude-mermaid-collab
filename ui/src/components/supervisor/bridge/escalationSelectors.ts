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
import { classifyEscalationLifecycle } from '@/lib/escalationLifecycle';

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
  if (!Array.isArray(escalations)) return {};
  return escalations.reduce((m, e) => {
    if (e.status === 'open') m[e.project] = (m[e.project] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>);
}

/** Fleet-wide open-escalation total — `sum(selectOpenEscalationsByProject)`. */
export function selectFleetOpenCount(escalations: Escalation[]): number {
  if (!Array.isArray(escalations)) return 0;
  let n = 0;
  for (const e of escalations) if (e.status === 'open') n++;
  return n;
}

/**
 * Escalation kinds that are machine-generated triage/infrastructure noise
 * and should be hidden from the human-actionable list. Mirrors server originals:
 * 'epic-sweep-triage' (reconcile-pass.ts:54), 'infra-park' / 'leaf-infra-rejected'
 * (orchestrator.ts:133 / leaf-wall-history.ts:48), 'split-proposal', 'base-moved'
 * (conductor-signature.ts:21). Not importable from ui/ — duplicated here per the
 * file's existing header comment style (server originals live in the daemon).
 */
export const MACHINE_HYGIENE_KINDS = new Set<string>([
  'epic-sweep-triage',
  'infra-park',
  'leaf-infra-rejected',
  'split-proposal',
  'base-moved',
]);

/**
 * Open escalations scoped to a single project that require human attention —
 * excludes machine-hygiene noise and AI-handling/AI-suggested states.
 * Sorted: operator-gated rows first, then by createdAt (stable).
 */
export function selectHumanActionableEscalations(escalations: Escalation[], project: string): Escalation[] {
  if (!Array.isArray(escalations)) return [];
  const open = selectOpenEscalations(escalations, project);
  return open
    .filter((e) => !MACHINE_HYGIENE_KINDS.has(e.kind))
    .filter((e) => {
      const lifecycle = classifyEscalationLifecycle(e);
      return lifecycle !== 'ai-handling' && lifecycle !== 'ai-suggested';
    })
    .filter((e) => !e.triageInFlight)
    .sort((a, b) => {
      const aGated = !!a.operatorGated;
      const bGated = !!b.operatorGated;
      if (aGated !== bGated) return aGated ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
}

/**
 * Count of open escalations in a project that are machine-handled (hygiene-kind
 * exclusions only) — the "excluded-but-open" count. Does not apply lifecycle or
 * triageInFlight filters.
 */
export function selectMachineHandledCount(escalations: Escalation[], project: string): number {
  if (!Array.isArray(escalations)) return 0;
  const open = selectOpenEscalations(escalations, project);
  let n = 0;
  for (const e of open) {
    if (MACHINE_HYGIENE_KINDS.has(e.kind)) n++;
  }
  return n;
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
