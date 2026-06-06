/**
 * requirementSelectors — the ONE project-scoped selector for the RequirementsInbox
 * (design-system-object-ui §3, P0). Mirrors `escalationSelectors.selectOpenEscalations`
 * so the inbox list, the Proposed(N) badge depth and any future surfaces derive
 * from a single source and can never disagree.
 *
 * Inbox states are `proposed` (new promise) and `changed` (a DIFF re-entered for
 * re-sign); `approved`/superseded promises have left the inbox. `changed` items
 * sort to the TOP so a re-sign is never buried (§3 "changed items always jump to top").
 */

import type { Requirement } from '@/stores/supervisorStore';

/** Statuses that belong in the confirm-loop inbox (awaiting a signature). */
export const INBOX_STATUSES: ReadonlySet<string> = new Set(['proposed', 'changed']);

/** Lower rank floats to the top: changed (re-sign) before proposed. */
function inboxRank(r: Requirement): number {
  return r.status === 'changed' ? 0 : 1;
}

/**
 * The requirements awaiting a signature for this project, changed-first.
 * Accepts the full (or already project-scoped) list and filters defensively by
 * project so callers can pass either shape.
 */
export function selectInboxRequirements(requirements: Requirement[], project: string): Requirement[] {
  return requirements
    .filter((r) => r.project === project && INBOX_STATUSES.has(r.status))
    .sort((a, b) => inboxRank(a) - inboxRank(b) || b.updatedAt - a.updatedAt);
}

/**
 * Statuses of a CONFIRMED promise — one that has left the inbox and is now an
 * active commitment. These are the requirements surfaced as constraint-PEER chips
 * in the planner orientation (the literal rendering of getActiveRequirements
 * beside active constraints). Excludes inbox states (proposed/changed).
 */
export const CONFIRMED_STATUSES: ReadonlySet<string> = new Set(['approved', 'active']);

/**
 * The confirmed requirements for a project — the constraint-peer chip set. Sorted
 * newest-first so the freshest commitment reads first. Superseded promises are
 * excluded. Read-only guides (the rail guides, the kanban authors —
 * anti-duplication wall); no mutation here.
 */
export function selectConfirmedRequirements(requirements: Requirement[], project: string): Requirement[] {
  return requirements
    .filter((r) => r.project === project && CONFIRMED_STATUSES.has(r.status) && !r.supersededBy)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The predecessor a `changed` requirement supersedes (for the was→now DIFF), if present. */
export function predecessorOf(requirement: Requirement, all: Requirement[]): Requirement | undefined {
  return all.find((r) => r.supersededBy === requirement.id);
}
