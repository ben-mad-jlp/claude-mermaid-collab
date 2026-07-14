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
// One-directional as of stage C: this module imports the `isEpic`/`stripLabel` values
// from todo-kind.ts, and todo-kind.ts imports only `import type { TodoKind }` back —
// a type-only edge, erased at compile time. The stage-B runtime cycle existed solely
// because todo-kind.ts's `kindOf` fallback needed `kindFromTitle` from here; that
// fallback and that function are both gone. Do not add a value import in todo-kind.ts
// from this module — it would re-form the cycle.
import { isEpic, isMission, stripLabel } from './todo-kind.ts';
import { isBucketEpic as registryIsBucketEpic } from './bucket-registry.ts';

/** The per-project default epic that orphan/triage todos auto-file under
 *  (constraint 373a2d52). Planning-only: its children must never be auto-executed.
 *
 *  This is the POST-STRIP stored title. Stage C's migration removed the `[EPIC] `
 *  prefix from every stored title, this row included — the Inbox's identity is the
 *  word, not the bracket. `isInboxEpicTitle` below still accepts the legacy
 *  `'[EPIC] Inbox'` literal so a Todo built before the migration ran (a replayed WS
 *  frame, an old fixture) still resolves to the same singleton. */
export const INBOX_EPIC_TITLE = 'Inbox';

/** Identity check on the named singleton — NOT a role decision (role comes from `kind`).
 *  Tolerates the legacy prefixed literal via `stripLabel`, and PREFIX-matches so a real
 *  suffixed row ("Inbox — …") still resolves to the singleton; mirrors
 *  land-authority.ts:90-92. Do NOT revert to exact match. */
export const isInboxEpicTitle = (title: string | null | undefined): boolean =>
  stripLabel(title).toLowerCase().startsWith(INBOX_EPIC_TITLE.toLowerCase());

/** The role a work-graph node plays. This is the stored `kind` column's domain —
 *  the type-only pivot that lets `todo-kind.ts` import `TodoKind` from this module
 *  without forming a runtime edge (the import is erased at compile time). */
export type TodoKind = 'mission' | 'epic' | 'land' | 'leaf' | 'gate';

/** True iff this todo IS the Inbox epic itself (a top-level root, not a child).
 *  ROLE comes from `kind`; the title compare is an IDENTITY check on a named
 *  singleton, not a role decision. Tolerates the pre-migration prefixed literal
 *  via `isInboxEpicTitle`. */
export const isInboxEpic = (t: Todo | undefined): boolean =>
  !!t && isEpic(t) && isInboxEpicTitle(t.title);

/** True iff this todo's PARENT is the Inbox epic (i.e. it is a triage child). */
export const parentIsInbox = (t: Todo, byId: Map<string, Todo>): boolean =>
  // R1: the planning-only gate now consults the ONE bucket predicate (any bucket parent,
  // not just the Inbox). The claim reason stays 'inbox-planning' (R3 renames it).
  t.parentId != null && registryIsBucketEpic(byId.get(t.parentId));

/**
 * True iff some EPIC ancestor on this todo's PARENT chain has approvedAt == null.
 * Walks parentId to the root (never dependsOn); a `seen` guard makes a malformed
 * parent cycle terminate instead of spinning.
 *
 * GATES ON kind==='epic' ANCESTORS ONLY — NEVER on has-children. A split leaf HAS
 * children yet is a leaf (live proof 82f1011a: 12 split children, still not-headless:
 * has-children). If has-children gated, every auto-split child would demand its parent
 * LEAF be released and the splitter would wedge every split silently (the da865ab7
 * failure). Role is the `kind` column, read via isEpic — the rule cannot be a title regex.
 *
 * MISSION ancestors do NOT gate: a mission is driven by its phase, never closes, and is
 * not a build container. We keep walking PAST a mission (only epic-ness gates), so a
 * mission never releases and never blocks.
 */
export function hasUnreleasedEpicAncestor(t: Todo, byId: Map<string, Todo>): boolean {
  const seen = new Set<string>();
  let cur = t.parentId != null ? byId.get(t.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isEpic(cur) && cur.approvedAt == null) return true;
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

export type ClaimReason =
  | 'claimable'       // fully unblocked, approved, agent → daemon-claimable
  | 'terminal'        // status done|dropped
  | 'in-flight'       // claim != null
  | 'rejected'        // this todo's OWN acceptanceStatus==='rejected' — ran but failed the gate; held for a human, never auto-reclaimed
  | 'human-assignee'  // fully-unblocked + approved HUMAN todo (incl. [GATE]) → actionable in HumanInbox, NOT daemon-claimed
  | 'inbox-planning'  // parent is the [EPIC] Inbox — planning-only triage; re-home to a real epic to run
  | 'unapproved'      // approvedAt == null
  | 'held'            // heldAt != null
  | 'dep-rejected'    // a dep is acceptanceStatus==='rejected' (DISTINCT, recoverable by reset)
  | 'dep-dropped'     // a dep was DROPPED — permanently unsatisfiable; needs a human (re-point the edge, reset the dep, or drop this todo)
  | 'parent-unreleased' // an EPIC ancestor on the parent chain has approvedAt == null — release the epic (status='ready')
  | 'deps-pending';   // a dep is not yet terminal — recoverable by waiting
  // 'probe-failing' is NOT decided here — the daemon layers the live probe on top at claim time.

/**
 * A dependency counts as satisfied iff it is terminally complete and was not rejected.
 *
 * THE single definition (F3). `todo-store.ts` previously carried a private, divergent copy;
 * it now imports this one. The two axes it disagreed on, and how they are resolved:
 *
 *  - DANGLING dep id (`byId.get(id)` misses): NOT satisfied. A dep id that resolves to no row
 *    is a DATA BUG, not an external/complete dependency. The permissive reading silently made
 *    orphaned work claimable; here the dependent surfaces as `deps-pending`, which is visible
 *    and human-recoverable.
 *  - `accepted` but not `done`: SATISFIED. `claimReason` already treats acceptanceStatus==='accepted'
 *    as terminal for the todo itself (the 75f7e304 reset/reaper path, see below); a dep that is
 *    terminal for itself must satisfy its dependents or the graph contradicts itself.
 *
 * NOTE — genuine behavior change vs the pre-b2c858d4 status-only rule: the `!== 'rejected'`
 * clause blocks dependents of rejected-but-done deps (HARD PARTS #6 / the S3 soak in
 * design-todo-model-refactor). It alters live claim behavior, not just labeling.
 *
 * Takes the narrowest shape it reads so non-graph callers (the deconflate migration backfill,
 * which has only SQL columns in hand) can pass a projection rather than a full `Todo`.
 */
export function depSatisfied(dep: Pick<Todo, 'status' | 'acceptanceStatus'> | undefined): boolean {
  if (!dep) return false;
  if (dep.acceptanceStatus === 'rejected') return false;
  return dep.status === 'done' || dep.acceptanceStatus === 'accepted';
}

/**
 * A dependency is PERMANENTLY unsatisfiable iff it was dropped.
 *
 * Complement of `depSatisfied` on the axis that matters for triage, not its negation:
 * a dep can be unsatisfied because it is still *running* (recoverable by waiting) or
 * because it is *dead* (recoverable only by a human). `status === 'dropped'` is the only
 * terminal-and-never-satisfying state — `done`/`accepted` satisfy, `rejected` is caught
 * earlier by the `dep-rejected` gate, everything else is live work.
 *
 * DERIVED from the dep row, never stored: reset the dep and the dependent silently
 * returns to `deps-pending`/`ready` with no migration and no cleanup pass.
 */
export function depDropped(dep: Pick<Todo, 'status'> | undefined): boolean {
  return dep?.status === 'dropped';
}

/**
 * The ONE eligibility predicate. Order is load-bearing: terminal/in-flight first (lifecycle),
 * then the decision gates (unapproved, held) which apply to BOTH agent and human todos, then
 * the dependency gates, and finally the agent-vs-human split LAST (a fully-unblocked human
 * todo is actionable-by-a-human, not auto-claimed).
 *
 * The dependency gates run most-severe-first, where severity = how much human intervention
 * recovery costs:
 *   1. dep-rejected — reset the dep; the dep row is alive and re-runnable
 *   2. dep-dropped  — a human must re-point the edge, `reset_todo` the dep, or drop this todo
 *   3. deps-pending — wait; no human needed
 * `dep-rejected` stays first even though `dep-dropped` is the *harder* blocker: a rejected dep
 * is a gate failure a human is already being asked to look at, and it is the more actionable
 * signal. A todo blocked by both reports `dep-rejected` — fix that, and it re-reports
 * `dep-dropped` on the next read. Both precede `deps-pending`, the only dep state that
 * resolves without a human.
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
  //
  // WHY THIS GATE IS DISTINCT FROM 'parent-unreleased' (and both must coexist):
  //   1. Buckets are NEVER released: the Inbox epic has no owner; releasing it
  //      would auto-run all triage children, defeating the planning-only rule
  //      (constraint 373a2d52). If deleted, 'parent-unreleased' would surface the
  //      wrong remediation ("release the Inbox") instead of the right one ("re-home").
  //   2. This gate sits ABOVE the approval/release gates (before 'unapproved'). If
  //      an Inbox ever gets approvedAt set (stray approve, replayed frame),
  //      hasUnreleasedEpicAncestor returns false → 'parent-unreleased' does NOT fire
  //      → children would become claimable. This gate still fires and keeps them
  //      gated, so it covers an accidentally-approved bucket that 'parent-unreleased'
  //      cannot (the approved-bucket backstop).
  if (parentIsInbox(t, byId)) return 'inbox-planning';
  if (t.approvedAt == null) return 'unapproved';
  if (t.heldAt != null) return 'held';
  if ((t.dependsOn ?? []).some((id) => byId.get(id)?.acceptanceStatus === 'rejected')) {
    return 'dep-rejected';
  }
  // A DROPPED dep never satisfies (`depSatisfied` requires done|accepted), so without this
  // gate the dependent reads `deps-pending` forever — indistinguishable from one merely
  // waiting on live work (F4). The drop cascade walks `parentId` only and deliberately does
  // NOT follow `dependsOn` (68b8bb09: it is a DAG, blast radius invisible at click time), so
  // stranding OUTSIDE dependents is the accepted cost — this reason is how the cost is paid.
  if ((t.dependsOn ?? []).some((id) => depDropped(byId.get(id)))) {
    return 'dep-dropped';
  }
  // An EPIC ancestor that has not been released (status='ready' → approvedAt) gates the
  // whole subtree: nothing under a `planned` epic can be claimed until a planner releases
  // it. Ancestors ONLY — a todo's own approval is the `unapproved` gate above. In-flight
  // work is protected: the `t.claim != null` check at the top returns 'in-flight' before
  // control ever reaches here, so releasing/un-releasing an epic never revokes a running leaf.
  if (hasUnreleasedEpicAncestor(t, byId)) return 'parent-unreleased';
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
  // A 'dep-dropped' todo (see claimReason) falls through to 'blocked' here — no distinct
  // legacy label. The distinct rendering is claimReason's job, surfaced in the Bridge.
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
    // Containers are skipped by DECLARED kind, never by a title prefix (criterion 1 /
    // decision ea83ac9f). Merge note: this call site arrived from the splitter epic
    // (9b32bdbc) written against isEpicTitle/isMissionTitle, which the kind migration
    // deleted. Text-merged clean; only tsc caught it.
    if (isEpic(p) || isMission(p)) continue;
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
