/**
 * claimability.ts — the SINGLE source of truth for "is this todo claimable?" (epic
 * b2c858d4, de-conflate todo status). The model splits the old `status` column into a
 * stored DECISION (approvedAt / heldAt / claim) and a DERIVED FACT (dependency-readiness),
 * and this module is the ONLY place permitted to decide eligibility. No SQL view re-encodes
 * the rule (the forbidden second copy — the audit already paid for materialized-vs-recomputed
 * `ready` drift). Every reader (daemon, listReadyTodos, UI) renders `claimReason`/`isClaimable`/
 * `derivedStatus` VERBATIM and never re-derives past the daemon-side live probe.
 *
 * Pure + zero new I/O: `byId` is already in-memory at every call site (the work-graph map).
 */
import type { Todo } from './todo-store';

/**
 * The per-project default epic that orphan/triage todos auto-file under
 * (constraint 373a2d52 / every-todo-needs-an-epic). The Inbox is a PLANNING-ONLY
 * staging area: its children must NEVER be auto-executed — they must first be
 * re-homed to a real epic. Matched by this exact title (the epic model is
 * title-based throughout; one shared definition makes it easy to harden later).
 *
 * Defined HERE (the pure predicate module) so both the claim gate below and the
 * approval route can import a SINGLE source of Inbox identity without pulling in
 * the heavy session-todos / todo-store graph (no import cycle: this module only
 * imports the `Todo` type).
 */
export const INBOX_EPIC_TITLE = '[EPIC] Inbox';

/** True for a todo that IS an epic (a root) — by the `[EPIC]` title convention. */
export const isEpicTitle = (title: string | null | undefined): boolean =>
  /^\s*\[EPIC\]/i.test(title ?? '');

/**
 * Convergence-loop MISSION root (Phase 2a). A `[MISSION]` node is a DURABLE
 * top-level container that — unlike an `[EPIC]` — must NEVER auto-close when its
 * descendant epics all complete: a mission outlives hundreds of build/land cycles
 * (each iteration's gaps become transient `[EPIC]` children under it). The
 * behavioral difference lives in todo-store's two rollup paths (the completeTodo
 * event-path loop + sweepEpicRollups), which exempt this prefix. Loop-control
 * state (phase/iteration/criteria) is NOT stored on the todo row — it lives in the
 * sidecar `mission` table (see mission-store.ts) to keep the work-graph aggregate
 * uncoupled. Matched by the same title convention as epics.
 */
export const MISSION_TITLE_PREFIX = '[MISSION]';

/** True for a todo that IS a mission root — by the `[MISSION]` title convention. */
export const isMissionTitle = (title: string | null | undefined): boolean =>
  /^\s*\[MISSION\]/i.test(title ?? '');

/** True iff this todo IS the Inbox epic itself (a top-level root, not a child). */
export const isInboxEpic = (t: Todo | undefined): boolean =>
  !!t && isEpicTitle(t.title) && t.title.trim() === INBOX_EPIC_TITLE;

/** True iff this todo's PARENT is the Inbox epic (i.e. it is a triage child). */
export const parentIsInbox = (t: Todo, byId: Map<string, Todo>): boolean =>
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
  // 'probe-failing' is NOT decided here — the daemon layers the live probe on top at claim time.

/**
 * A dependency counts as satisfied iff it is terminally DONE and was not rejected.
 *
 * NOTE — genuine behavior change vs the legacy todo-store `depSatisfied` (which keyed ONLY on
 * status==='done'): adding the `acceptanceStatus !== 'rejected'` clause newly blocks dependents
 * of rejected-but-done deps. That is precisely the dep-rejected fix (see HARD PARTS #6 / the S3
 * soak in design-todo-model-refactor) — it alters live claim behavior, not just labeling.
 */
export function depSatisfied(dep: Todo | undefined): boolean {
  if (!dep) return false;
  if (dep.acceptanceStatus === 'rejected') return false;
  return dep.status === 'done' || dep.acceptanceStatus === 'accepted';
}

/**
 * The ONE eligibility predicate. Order is load-bearing: terminal/in-flight first (lifecycle),
 * then the decision gates (unapproved, held) which apply to BOTH agent and human todos, then
 * the dependency gates (dep-rejected BEFORE deps-pending so the recoverable blocker surfaces
 * first), and finally the agent-vs-human split LAST (a fully-unblocked human todo is
 * actionable-by-a-human, not auto-claimed).
 */
export function claimReason(t: Todo, byId: Map<string, Todo>): ClaimReason {
  // An ACCEPTED leaf is terminal regardless of the stored `status` enum: completeTodo
  // writes status='done'+acceptanceStatus='accepted' atomically, but a later reset/reaper
  // can reset status to a non-terminal value while leaving acceptanceStatus='accepted'
  // (the 75f7e304 re-claim bug — an accepted L1 re-claimed, re-run, re-rejected). Keying
  // terminality on acceptanceStatus too (symmetric with the 'rejected' branch below) keeps
  // such a leaf OUT of the claimable set so done work never re-enters the pipeline.
  if (t.status === 'done' || t.status === 'dropped' || t.acceptanceStatus === 'accepted') return 'terminal';
  if (t.claim != null) return 'in-flight';
  // A self-rejected completion (gate failed) is NOT done and must NOT be auto-
  // reclaimed — it stays parked for a human to re-open/split/drop. The old hold
  // was completeTodo's unblock-pass skip, deleted in S4; this derives it instead
  // (80f85190 — claimReason previously only checked a DEP's rejection, not its own).
  if (t.acceptanceStatus === 'rejected') return 'rejected';
  // Inbox = planning-only: a triage child of [EPIC] Inbox must NEVER be auto-run,
  // regardless of approval. Placed ABOVE the approval check so the distinct, hard
  // reason surfaces even for already-approved-in-Inbox todos (the backstop that
  // catches any approvedAt path the primary approval block didn't intercept). The
  // Inbox epic ITSELF is a top-level root (parentId null) → unaffected; only its
  // CHILDREN are gated. Re-home to a real epic to make it claimable.
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

/** True iff a daemon may claim this todo (modulo the daemon-side live `claimProbe`). */
export const isClaimable = (t: Todo, byId: Map<string, Todo>): boolean =>
  claimReason(t, byId) === 'claimable';

/**
 * Legacy-shaped DERIVED label for unmigrated UI during the long S5 tail (graft from the
 * orthogonal-flags concept). Lets a site render a sensible derived chip instead of branching
 * on the now-untrusted shadow enum. NOT a stored value — recomputed on read like everything else.
 */
export function derivedStatus(t: Todo, byId: Map<string, Todo>): string {
  if (t.status === 'done' || t.status === 'dropped') return t.status;
  if (t.claim != null) return 'in_progress';
  if (isClaimable(t, byId)) return 'ready';
  if (t.approvedAt == null) return 'planned';
  return 'blocked';
}

/** One split parent whose open children cannot be claimed because they are unapproved. */
export interface BlockedSplit {
  parentId: string;
  parentTitle: string;
  /** count of OPEN (non-done, non-dropped) children */
  children: number;
  /** count of those open children with approvedAt == null */
  unapproved: number;
  unapprovedChildIds: string[];
}

/**
 * A project is BLOCKED-ON-A-DECISION (not idle) when a non-terminal, non-epic todo has open
 * children of which at least one is unapproved: nothing under that parent can ever be claimed
 * without a human/planner approval, and the parent itself is held out by `not-headless:
 * has-children`. Pure; caller passes the full todo list (includeCompleted: true).
 *
 * Epics/missions are EXCLUDED: an `[EPIC]` with planned children is ordinary planning, not a
 * wedge. Only a *leaf that became a container* (splitLeafInto) matches.
 */
export function findBlockedSplits(todos: Todo[]): BlockedSplit[] {
  const isOpen = (t: Todo) => t.status !== 'done' && t.status !== 'dropped';
  const byParent = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId == null) continue;
    const arr = byParent.get(t.parentId);
    if (arr) arr.push(t); else byParent.set(t.parentId, [t]);
  }
  const out: BlockedSplit[] = [];
  for (const p of todos) {
    if (!isOpen(p) || p.acceptanceStatus === 'accepted') continue;
    if (isEpicTitle(p.title) || isMissionTitle(p.title)) continue;
    const open = (byParent.get(p.id) ?? []).filter(isOpen);
    if (open.length === 0) continue;
    const unapproved = open.filter((c) => c.approvedAt == null);
    if (unapproved.length === 0) continue;
    out.push({
      parentId: p.id,
      parentTitle: p.title ?? p.id,
      children: open.length,
      unapproved: unapproved.length,
      unapprovedChildIds: unapproved.map((c) => c.id),
    });
  }
  // deterministic order for snapshot-ish assertions
  return out.sort((a, b) => (b.unapproved - a.unapproved) || a.parentId.localeCompare(b.parentId));
}
