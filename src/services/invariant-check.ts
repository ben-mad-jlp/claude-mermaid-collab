import type { Todo, TodoStatus } from './todo-store';
import { listTodos, listTodosChunked } from './todo-store';
import { recordSupervisorAudit } from './supervisor-store';
import { isEpic, isLand, isMission } from './todo-kind.ts';
import { yieldToLoop } from './loop-yield.ts';
import { buildEpicBranchStatus, makeGitProbe } from './epic-branch-status.ts';

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
 *  - stranded-epic           [EPIC] whose non-dropped children are all done+accepted
 *                            but landedAt is still null (a383bc2c — every epic that
 *                            looks done must actually land).
 *  - broken-depends-on       dependsOn points at a missing or dropped todo.
 *
 * Epics and land leaves are identified by the `kind` column via the shared predicate
 * module (./todo-kind), not by title prefix. Titles still carry their prefixes; they
 * are simply no longer read to decide a role (stage B of decision e852fb0c).
 */

export type InvariantKind =
  | 'orphan'
  | 'stranded-epic'
  | 'broken-depends-on'
  | 'landed-at-divergence';

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

    // 2. stale-landable-epic — an [EPIC] whose non-dropped children are ALL
    //    done+accepted but landedAt is still null. Replaces the old
    //    [LAND]-descendant requirement (a383bc2c intent unchanged: an epic that
    //    looks done must actually land) now that landedAt is the sole source of
    //    truth (W5 cutover) and no [LAND] leaf is minted to check for.
    if (isEpicTodo(t) && t.landedAt == null) {
      const kids = (childrenOf.get(t.id) ?? []).filter((c) => c.status !== 'dropped');
      if (kids.length > 0 && kids.every((c) => c.status === 'done' && c.acceptanceStatus === 'accepted')) {
        violations.push({
          kind: 'stranded-epic',
          todoId: t.id,
          title: t.title,
          reason: 'epic\'s children are all done+accepted but landedAt is still null (never landed)',
        });
      }
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

/** epicId -> ahead count from the git probe; null/absent = unprobeable (treated as satisfied). */
export type AheadLookup = (epicId: string) => number | null | undefined;

/** landedAt IS NOT NULL iff a done land-leaf child exists (W3 equivalence). Advisory —
 *  a divergent epic is NOT a structural defect the sweep repairs; it just means the
 *  backfill/dual-write missed a row. Pre-column epics converge via the one-shot backfill
 *  in todo-store.ts openDb(); a live divergence AFTER that backfill has run is a real bug.
 *  The `landedAt set, no done [LAND] child` direction only fires when the epic is
 *  genuinely git-stranded (ahead>0 via the injected AheadLookup) — land leaves are no
 *  longer minted post-cutover (mission 48e1a624), so landedAt alone satisfies. */
export function findLandedAtDivergence(todos: Todo[], aheadOf?: AheadLookup): InvariantViolation[] {
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }
  const violations: InvariantViolation[] = [];
  for (const t of todos) {
    if (!isEpicTodo(t)) continue;
    const hasDoneLand = (childrenOf.get(t.id) ?? []).some((c) => isLandTodo(c) && c.status === 'done');
    if (hasDoneLand && t.landedAt == null) {
      violations.push({
        kind: 'landed-at-divergence',
        todoId: t.id,
        title: t.title,
        reason: 'epic has a done [LAND] leaf child but landedAt is null',
      });
      continue;
    }
    if (!hasDoneLand && t.landedAt != null) {
      const ahead = aheadOf?.(t.id) ?? 0;
      if ((ahead ?? 0) > 0) {
        violations.push({
          kind: 'landed-at-divergence',
          todoId: t.id,
          title: t.title,
          reason: `epic has landedAt set but branch is still ahead>0 of master (ahead=${ahead}) — stranded`,
        });
      }
    }
  }
  return violations;
}

/** DB-backed wrapper: load the project's full work-graph and return its violations. */
export function checkInvariants(project: string): InvariantViolation[] {
  const todos = listTodos(project, { includeCompleted: true });
  const branchReport = buildEpicBranchStatus(todos, makeGitProbe(project));
  const aheadById = new Map(branchReport.epics.map((e) => [e.epicId, e.ahead]));
  const aheadOf: AheadLookup = (epicId) => aheadById.get(epicId);
  return [...findViolations(todos), ...findLandedAtDivergence(todos, aheadOf)];
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
 * ALARM half (MAIN-THREAD ONLY): given already-computed violations, console.warn
 * each and record a supervisor audit. This is the sole WRITE side of the assert
 * pass; it is kept separate from the read scan so the scan can be offloaded to a
 * read-only worker (Phase 2) while the writes stay on the main thread. NEVER
 * mutates the work-graph. Best-effort: an audit-write failure never throws.
 */
function alarmClaimViolations(project: string, violations: ClaimInvariantViolation[]): void {
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
}

/**
 * DB-backed S6 assert pass (SYNCHRONOUS, inline) — load the project's work-graph,
 * assert the structural claim/decision invariants, and ALARM (console.warn +
 * supervisor audit) on any violation. NEVER mutates. Returns the violations (also
 * used by tests + as the fail-open fallback of the async variant). In steady state
 * returns []. Best-effort: an audit-write failure never throws.
 *
 * This is the reference (inline) implementation. The daemon reconcile pass calls
 * `assertClaimInvariantsAsync` instead, which offloads the read scan to a worker.
 */
export function assertClaimInvariants(project: string): ClaimInvariantViolation[] {
  const todos = listTodos(project, { includeCompleted: true });
  const violations = findClaimInvariantViolations(todos);
  if (violations.length === 0) return violations;
  alarmClaimViolations(project, violations);
  return violations;
}

/**
 * EVENT-LOOP-FRIENDLY S6 assert pass (Phase 2, mission c4eb4fcc). Identical WORK +
 * RESULTS to `assertClaimInvariants`, but the query-bound read (the monolithic
 * `SELECT * FROM todos … .all()`) is CHUNKED via `listTodosChunked`, which keyset-
 * paginates the same query and cedes the HTTP loop between pages. So the scan no
 * longer starves the shared event loop for its whole duration.
 *
 * WHY chunk on the MAIN thread and NOT a separate-connection worker: `openDb` runs a
 * one-shot migration backfill that CLEARS a claim on any non-`in_progress` row. A
 * worker's fresh connection would re-run that backfill on first open and thereby
 * HEAL-AND-MASK exactly the claim invariants this pass exists to surface — diverging
 * from the (already-migrated) main-thread scan. Chunking on the same connection is
 * byte-identical AND avoids the double-writer WAL coordination a worker would need.
 *
 * FAIL-OPEN: if the chunked read throws for any reason, fall back to the inline
 * single-shot scan — reconcile is never broken. Same violations detected either way.
 */
export async function assertClaimInvariantsAsync(project: string): Promise<ClaimInvariantViolation[]> {
  let todos: Todo[];
  try {
    todos = await listTodosChunked(project, { includeCompleted: true }, { yieldFn: yieldToLoop });
  } catch (err) {
    // Fail-open: any chunked-read error → inline single-shot scan on the main thread.
    console.warn(
      `[invariant-assert] chunked scan failed for ${project}, falling back to inline scan:`,
      err instanceof Error ? err.message : err,
    );
    todos = listTodos(project, { includeCompleted: true });
  }
  const violations = findClaimInvariantViolations(todos);
  if (violations.length === 0) return violations;
  alarmClaimViolations(project, violations);
  return violations;
}
