/**
 * claimability.ts (UI mirror) — the SINGLE predicate the UI is allowed to use to
 * answer "is this todo claimable / what is its derived status?" (epic b2c858d4,
 * de-conflate todo status). Every reader renders `claimReason`/`derivedStatus`
 * VERBATIM and NEVER inlines `status==='ready'|'blocked'|'in_progress'`.
 *
 * This is a byte-faithful mirror of the backend source of truth
 * `src/services/claimability.ts`. It exists separately ONLY because the backend
 * module imports `Todo` from `todo-store`, which pulls in `bun:sqlite` and does
 * not typecheck under the UI's `include: ["src"]` config. The function BODIES are
 * identical; keep them in lockstep with the backend if the rule ever changes.
 */
import type { SessionTodo } from '@/types/sessionTodo';
import { isEpic, stripLabel } from '@/lib/todoKind';

/** Single source of Inbox identity (byte-mirror of backend claimability.ts).
 *  The Inbox is a planning-only triage staging area: its children must NEVER be
 *  auto-run — re-home to a real epic first. The epic ROLE comes from the `kind`
 *  column via `todoKind.ts`; only the Inbox's IDENTITY (which specific epic) is
 *  still title-based (bare, post-strip; matched via `stripLabel` to tolerate
 *  pre-strip rows). */
export const INBOX_EPIC_TITLE = 'Inbox';
/** True iff this todo IS the Inbox epic itself (a top-level root, not a child).
 *  ROLE comes from `kind` (isEpic); the `stripLabel(...) === INBOX_EPIC_TITLE` half
 *  is an IDENTITY check naming one specific node, not a title-role predicate — it
 *  survives stage C. */
export const isInboxEpic = (t: SessionTodo | undefined): boolean =>
  !!t && isEpic(t) && stripLabel(t.title) === INBOX_EPIC_TITLE;
/** True iff this todo's PARENT is the Inbox epic (i.e. it is a triage child). */
export const parentIsInbox = (t: SessionTodo, byId: Map<string, SessionTodo>): boolean =>
  t.parentId != null && isInboxEpic(byId.get(t.parentId));

export type ClaimReason =
  | 'claimable'       // fully unblocked, approved, agent → daemon-claimable
  | 'terminal'        // status done|dropped
  | 'in-flight'       // claim != null
  | 'rejected'        // this todo's OWN acceptanceStatus==='rejected' — ran but failed the gate; held for a human, never auto-reclaimed
  | 'human-assignee'  // fully-unblocked + approved HUMAN todo (incl. [GATE]) → actionable in HumanInbox, NOT daemon-claimed
  | 'inbox-planning'  // parent is the [EPIC] Inbox — planning-only triage; re-home to a real epic to run
  | 'unapproved'      // approvedAt == null
  | 'held'            // heldAt != null
  | 'dep-rejected'    // a dep is acceptanceStatus==='rejected' (DISTINCT, recoverable)
  | 'deps-pending';   // a dep is not yet terminal

/** A dependency counts as satisfied iff it is terminally DONE and was not rejected. */
export function depSatisfied(dep: SessionTodo | undefined): boolean {
  return !!dep && dep.status === 'done' && dep.acceptanceStatus !== 'rejected';
}

/** The ONE eligibility predicate. Order is load-bearing (see backend doc). */
export function claimReason(t: SessionTodo, byId: Map<string, SessionTodo>): ClaimReason {
  if (t.status === 'done' || t.status === 'dropped') return 'terminal';
  if (t.claim != null) return 'in-flight';
  // Self-rejected (gate failed) — held for a human, never auto-reclaimed (80f85190).
  if (t.acceptanceStatus === 'rejected') return 'rejected';
  // Inbox = planning-only: a triage child of [EPIC] Inbox must NEVER be auto-run,
  // regardless of approval. ABOVE the approval check so the hard reason surfaces
  // even for approved-in-Inbox todos. The Inbox epic itself (root) is unaffected.
  if (parentIsInbox(t, byId)) return 'inbox-planning';
  if (t.approvedAt == null) return 'unapproved';
  if (t.heldAt != null) return 'held';
  if ((t.dependsOn ?? []).some((id) => byId.get(id)?.acceptanceStatus === 'rejected')) {
    return 'dep-rejected';
  }
  if (!(t.dependsOn ?? []).every((id) => depSatisfied(byId.get(id)))) {
    return 'deps-pending';
  }
  if (t.assigneeKind === 'human') return 'human-assignee';
  return 'claimable';
}

/** True iff a daemon may claim this todo (modulo the daemon-side live probe). */
export const isClaimable = (t: SessionTodo, byId: Map<string, SessionTodo>): boolean =>
  claimReason(t, byId) === 'claimable';

/** Legacy-shaped DERIVED label for UI chips. NOT a stored value — recomputed on read. */
export function derivedStatus(t: SessionTodo, byId: Map<string, SessionTodo>): string {
  if (t.status === 'done' || t.status === 'dropped') return t.status;
  if (t.claim != null) return 'in_progress';
  if (isClaimable(t, byId)) return 'ready';
  if (t.approvedAt == null) return 'planned';
  return 'blocked';
}

/** Build the `byId` map a predicate call needs from a flat todo list. */
export const buildById = (todos: SessionTodo[]): Map<string, SessionTodo> =>
  new Map(todos.map((t) => [t.id, t]));
