import type { Todo, TodoStatus } from './todo-store';
import { listTodos } from './todo-store';
import { recordSupervisorAudit } from './supervisor-store';
import { isEpic, isLand, isMission } from './todo-kind.ts';

/**
 * Work-graph invariant checker (read-only health report).
 *
 * Returns the VIOLATIONS of the documented work-graph invariants — never the
 * whole graph. The core is a PURE function (`findViolations`) over a Todo[] so
 * it is trivially unit-testable; `checkInvariants` is the thin DB-backed wrapper
 * the MCP tool calls.
 *
 * Invariants checked (with their decision/constraint ids):
 *  - orphan                  non-epic todo with no [EPIC] ancestor (373a2d52 —
 *                            every work todo must belong to an epic).
 *  - stranded-epic           [EPIC] with no [LAND] leaf among its descendants
 *                            (a383bc2c — every epic ends with a land leaf).
 *  - broken-depends-on       dependsOn points at a missing or dropped todo.
 *
 * Epics and land leaves are identified by the `kind` column via the shared predicate
 * module (./todo-kind), not by title prefix. Titles still carry their prefixes; they
 * are simply no longer read to decide a role (stage B of decision e852fb0c).
 */

export type InvariantKind =
  | 'orphan'
  | 'stranded-epic'
  | 'broken-depends-on';

export interface InvariantViolation {
  kind: InvariantKind;
  todoId: string;
  title: string;
  reason: string;
}

/** True when a todo is an EPIC root. Delegates to the one predicate module (kind
 *  column, title-fallback); re-exported here for `epic-branch-status.ts`. */
export function isEpicTodo(t: Todo): boolean {
  return isEpic(t);
}

/** True when a todo is a LAND → master leaf. Same delegation. */
export function isLandTodo(t: Todo): boolean {
  return isLand(t);
}

/** Terminal states excluded from "active" health checks. */
function isTerminal(status: TodoStatus): boolean {
  return status === 'done' || status === 'dropped';
}

/**
 * Pure invariant checker — judges a Todo[] and returns the violations only.
 * No DB access, so unit tests can feed hand-built graphs.
 */
export function findViolations(todos: Todo[]): InvariantViolation[] {
  const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));
  const violations: InvariantViolation[] = [];

  // Children grouped by parentId, for the stranded-epic + planned-ready-child checks.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  /** Walk parentId ancestry; true if any ancestor (or self) is an [EPIC]. Cycle-safe. */
  const hasEpicAncestor = (t: Todo): boolean => {
    const seen = new Set<string>();
    let cur: Todo | undefined = t;
    while (cur) {
      if (isEpicTodo(cur)) return true;
      if (!cur.parentId || seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  /** Any descendant (transitive) of `epic` that is a [LAND] leaf. Cycle-safe. */
  const hasLandDescendant = (epic: Todo): boolean => {
    const stack = [...(childrenOf.get(epic.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (isLandTodo(node)) return true;
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return false;
  };

  for (const t of todos) {
    if (isTerminal(t.status)) continue;

    // 1. orphan — a non-epic active todo with no epic ancestor. A mission is EXEMPT: it is a
    //    work-graph root by design (epics hang beneath it), so it can have no epic ancestor.
    //    Without this exemption the health check calls every mission broken.
    if (!isEpicTodo(t) && !isMission(t) && !hasEpicAncestor(t)) {
      violations.push({
        kind: 'orphan',
        todoId: t.id,
        title: t.title,
        reason: "non-epic todo with no epic (kind='epic') ancestor (must belong to an epic)",
      });
    }

    // 2. stranded-epic — an [EPIC] with no [LAND] leaf anywhere beneath it.
    if (isEpicTodo(t) && !hasLandDescendant(t)) {
      violations.push({
        kind: 'stranded-epic',
        todoId: t.id,
        title: t.title,
        reason: 'epic has no [LAND] → master leaf among its descendants',
      });
    }

    // 3. broken-depends-on — a dep points at a missing or dropped todo.
    for (const depId of t.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (!dep) {
        violations.push({
          kind: 'broken-depends-on',
          todoId: t.id,
          title: t.title,
          reason: `dependsOn references missing todo ${depId}`,
        });
      } else if (dep.status === 'dropped') {
        violations.push({
          kind: 'broken-depends-on',
          todoId: t.id,
          title: t.title,
          reason: `dependsOn references dropped todo ${depId}`,
        });
      }
    }

    // 4. (S4, epic b2c858d4) blocked-on-nothing — REMOVED. 'blocked' is no longer a
    // materialized readiness state; readiness is derived by claimability, so a 'blocked' enum
    // value whose deps are all done is just legacy noise the predicate ignores, not a violation.
  }

  return violations;
}

/** DB-backed wrapper: load the project's full work-graph and return its violations. */
export function checkInvariants(project: string): InvariantViolation[] {
  const todos = listTodos(project, { includeCompleted: true });
  return findViolations(todos);
}

// ───────────────────────────────────────────────────────────────────────────
// S6 — Sweep-as-net: ASSERT the new-model structural invariants (don't repair).
//
// The de-conflate refactor (epic b2c858d4) moved truth into the stored decisions
// (approvedAt / heldAt / claim) and DERIVES readiness, so the old sweep that
// "fixed missed fan-outs" has nothing to fix. We repurpose the sweep into an
// invariant-ASSERT pass: it surfaces any row whose structural invariants are
// violated and ALARMS (console.warn + a supervisor audit entry) — it NEVER
// mutates/repairs, and it EXPLICITLY does not cosmetically rewrite the shadow
// enum (writing status='ready'/'blocked' would re-create a trustable lying
// value). Unmigrated readers use derivedStatus; in steady state this finds
// nothing.
//
// Invariants asserted (claim/decision structural model):
//  - claim-implies-in-flight : claim != null ⇒ row not terminal (done/dropped).
//  - terminal-with-claim     : status in (done,dropped) ⇒ claim == null.
//  - held-with-claim         : heldAt != null ⇒ claim == null (a held row must
//                              never hold a live claim — it was never auto-claimed).
//  - epic-rollup             : a non-terminal epic whose non-dropped children are
//                              ALL done+accepted should already be rolled up; if it
//                              is not, the real rollup (sweepEpicRollups) missed it
//                              — assert, do not roll up here.
//
// Note: the first two invariants are logically the same edge (claim ⟺ in-flight),
// asserted from both directions so the alarm names the exact failing shape.
// ───────────────────────────────────────────────────────────────────────────

export type ClaimInvariantKind =
  | 'claim-implies-in-flight'
  | 'terminal-with-claim'
  | 'held-with-claim'
  | 'epic-rollup-missed';

export interface ClaimInvariantViolation {
  kind: ClaimInvariantKind;
  todoId: string;
  title: string;
  reason: string;
}

/** Audit kind used for S6 invariant alarms (so they're queryable in the audit trail). */
export const CLAIM_INVARIANT_AUDIT_KIND = 'invariant-assert';

/**
 * Pure assert pass over a Todo[] — returns the structural-invariant violations only.
 * No DB access, no mutation. ASSERT-only: callers ALARM on a non-empty result.
 */
export function findClaimInvariantViolations(todos: Todo[]): ClaimInvariantViolation[] {
  const violations: ClaimInvariantViolation[] = [];

  // children grouped by parentId for the epic-rollup assertion.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  for (const t of todos) {
    const terminal = isTerminal(t.status);
    const hasClaim = t.claim != null;

    // claim ⟺ in-flight, asserted from both directions.
    if (hasClaim && terminal) {
      violations.push({
        kind: 'claim-implies-in-flight',
        todoId: t.id,
        title: t.title,
        reason: `terminal todo (status='${t.status}') still holds a live claim (claim != null)`,
      });
    }
    if (terminal && hasClaim) {
      violations.push({
        kind: 'terminal-with-claim',
        todoId: t.id,
        title: t.title,
        reason: `status in (done,dropped) must imply claim == null, but claim is set`,
      });
    }

    // held-never-auto-claimed: a held row must never hold a live claim.
    if (t.heldAt != null && hasClaim) {
      violations.push({
        kind: 'held-with-claim',
        todoId: t.id,
        title: t.title,
        reason: `held todo (heldAt set, reason='${t.heldReason ?? ''}') holds a live claim — a held row must never be auto-claimed`,
      });
    }

    // epic-rollup consistency: assert the real rollup didn't miss a fully-settled epic.
    // A mission is durable: it has epic children but is never rolled up (todo-store's
    // non-closing guard). Asserting rollup on one would alarm on correct behavior.
    if (!terminal && !isMission(t)) {
      const children = childrenOf.get(t.id)?.filter((c) => c.status !== 'dropped') ?? [];
      if (
        children.length > 0 &&
        children.every((c) => c.status === 'done' && c.acceptanceStatus === 'accepted')
      ) {
        violations.push({
          kind: 'epic-rollup-missed',
          todoId: t.id,
          title: t.title,
          reason: `non-terminal epic whose ${children.length} non-dropped child(ren) are ALL done+accepted — rollup missed it`,
        });
      }
    }
  }

  return violations;
}

/**
 * DB-backed S6 assert pass — load the project's work-graph, assert the structural
 * claim/decision invariants, and ALARM (console.warn + supervisor audit) on any
 * violation. NEVER mutates. Returns the violations (also used by tests). In steady
 * state returns []. Best-effort: an audit-write failure never throws.
 */
export function assertClaimInvariants(project: string): ClaimInvariantViolation[] {
  const todos = listTodos(project, { includeCompleted: true });
  const violations = findClaimInvariantViolations(todos);
  if (violations.length === 0) return violations;

  for (const v of violations) {
    console.warn(`[invariant-assert] ${v.kind} on ${v.todoId} (${v.title}): ${v.reason}`);
    try {
      recordSupervisorAudit({
        kind: CLAIM_INVARIANT_AUDIT_KIND,
        project,
        session: 'coordinator',
        detail: JSON.stringify({
          source: 'invariant-assert',
          invariant: v.kind,
          todoId: v.todoId,
          reason: v.reason,
        }),
      });
    } catch (err) {
      console.warn(
        `[invariant-assert] audit write failed for ${v.todoId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return violations;
}
