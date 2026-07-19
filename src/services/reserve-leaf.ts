/**
 * B5 — capped poison-loop leaf re-serve (mission aad41fd5).
 *
 * A "poisoned" leaf is one the daemon rejects repeatedly with the SAME blueprint. A
 * retry reattaches the poisoned blueprint from the ledger (see memory
 * reference_poisoned_leaf_blueprint), so editing the rejected leaf's spec is a no-op —
 * the ONLY escape is a FRESH todo id. This module is the deterministic mechanism that
 * detects the loop and cuts a fresh id, with a HARD CAP so an infinite loop becomes
 * "2 fresh attempts, then a human".
 *
 * Grounding (worker-ledger.ts / ledger-stats.ts): a leaf's run history is a stream of
 * NODE rows (nodeKind ∈ {blueprint, implement, review, …}) terminated by an `outcome`
 * marker row that carries `leafOutcome` ('accepted'|'rejected'|'blocked'|'pending'|
 * 'paused'). There is NO stored `blueprintHash` column — the blueprint's durable content
 * IS the blueprint node's `outputText` (memory: leaf_manifest_source_is_ledger), so a
 * run's blueprint identity is a stable hash of that text. A run boundary is an `outcome`
 * marker that is not the final row, or an idle gap ≥ RUN_GAP_MS (mirrors
 * ledger-stats.latestRunRows — but here we keep EVERY run, not just the latest).
 */
import { createHash } from 'node:crypto';
import { queryLedger } from './worker-ledger';
import { RUN_GAP_MS } from './ledger-stats';
import { createTodo, updateTodo, getTodo, openDb, type Todo } from './todo-store';
import { createEscalation } from './supervisor-store';
import { recordAutonomousMutation } from './autonomy-log';

/** Hard cap: a leaf lineage is re-cut to a fresh id at most this many times, then escalated. */
export const RESERVE_CAP = 2;

/** One resolved run of a leaf, reduced to the two facts B5 needs. */
export interface LeafRunFacts {
  /** Terminal leafOutcome of the run ('rejected' is the only one B5 acts on). null = in-flight/no marker. */
  outcome: string | null;
  /** Stable hash of the run's blueprint-node outputText, or null when the run authored no blueprint. */
  blueprintHash: string | null;
}

/** Injectable seam so tests can drive isPoisonLooped without real ledger rows (though the
 *  shipped default reads the real worker-ledger, and the replay test exercises THAT path). */
export type LoadLeafRuns = (leafTodoId: string) => LeafRunFacts[];

/** Injectable escalation seam (default = supervisor-store.createEscalation). */
export type CreateEscalationFn = typeof createEscalation;

export interface ReserveLeafDeps {
  loadRuns?: LoadLeafRuns;
  createEscalation?: CreateEscalationFn;
}

/** Minimal shape of a ledger row we consume (a structural subset of the LedgerRow). */
interface MinLedgerRow {
  ts: number;
  durationMs?: number | null;
  nodeKind?: string | null;
  leafOutcome?: string | null;
  outputText?: string | null;
}

/** Split a leaf's ledger rows (ASC by ts) into runs, then reduce each run to LeafRunFacts.
 *  A run ends at an `outcome` marker that is not the final row, or before an idle gap
 *  ≥ RUN_GAP_MS (same boundary logic as ledger-stats.latestRunRows). */
function rowsToRuns(ascRows: MinLedgerRow[]): LeafRunFacts[] {
  const runs: MinLedgerRow[][] = [];
  let cur: MinLedgerRow[] = [];
  for (let i = 0; i < ascRows.length; i++) {
    const row = ascRows[i];
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      // Idle gap = wall gap MINUS this row's own duration (ts is stamped at completion).
      const idleGap = row.ts - (row.durationMs ?? 0) - prev.ts;
      if (prev.nodeKind === 'outcome' || idleGap >= RUN_GAP_MS) {
        runs.push(cur);
        cur = [];
      }
    }
    cur.push(row);
  }
  if (cur.length > 0) runs.push(cur);

  return runs.map((run) => {
    // The run's terminal outcome = the leafOutcome on its outcome marker (last one wins).
    const marker = run.filter((r) => r.nodeKind === 'outcome').pop();
    const outcome = marker?.leafOutcome ?? null;
    // Blueprint identity = hash of the LAST blueprint node's outputText in the run.
    const bp = run.filter((r) => r.nodeKind === 'blueprint' && r.outputText != null).pop();
    const blueprintHash =
      bp?.outputText != null && bp.outputText.length > 0
        ? createHash('sha256').update(bp.outputText).digest('hex')
        : null;
    return { outcome, blueprintHash };
  });
}

/** Default run loader: read the real worker-ledger for this leaf and reduce to run facts. */
function defaultLoadRuns(leafTodoId: string): LeafRunFacts[] {
  // queryLedger returns newest-first; reverse to ASC chronological for run splitting.
  const asc = queryLedger({ leafId: leafTodoId, limit: 2000 }).slice().reverse() as MinLedgerRow[];
  return rowsToRuns(asc);
}

/**
 * TRUE iff the leaf is stuck in a poison loop: it has had ≥2 REJECTED runs whose
 * blueprint (by content hash) did NOT change across the two most-recent rejections.
 *
 * A CHANGED blueprintHash on the latest rejection = normal iteration (the plan was
 * revised) and is explicitly NOT poisoned. Fail-safe: any error reading the ledger
 * ⇒ NOT poisoned (never re-cut on unknown state).
 */
export function isPoisonLooped(
  project: string,
  leafTodoId: string,
  deps: ReserveLeafDeps = {},
): boolean {
  try {
    const load = deps.loadRuns ?? defaultLoadRuns;
    const runs = load(leafTodoId);
    // Blueprint hashes of the REJECTED runs, in chronological order.
    const rejectedHashes = runs
      .filter((r) => r.outcome === 'rejected')
      .map((r) => r.blueprintHash);
    if (rejectedHashes.length < 2) return false;
    const latest = rejectedHashes[rejectedHashes.length - 1];
    if (latest == null) return false; // no blueprint on the latest rejection ⇒ can't prove sameness
    // Count trailing rejections that share the latest hash. ≥2 ⇒ same blueprint rejected
    // ≥2 times in a row ⇒ poisoned. A changed hash before them breaks the streak.
    let streak = 0;
    for (let i = rejectedHashes.length - 1; i >= 0; i--) {
      if (rejectedHashes[i] === latest) streak++;
      else break;
    }
    return streak >= 2;
  } catch {
    return false; // fail-safe: unknown state is NOT poisoned
  }
}

export interface ReserveLeafResult {
  /** The fresh todo id minted when the leaf was re-served (only on reason='reserved'). */
  reserved?: string;
  /** True when the cap was hit and a human escalation was created instead of a 3rd id. */
  escalated?: boolean;
  /** Machine reason: 'not-poisoned' | 'reserved' | 'cap-exhausted' | 'old-todo-missing'. */
  reason: string;
  /** The old (dropped) todo id, echoed for observability (reserved / cap-exhausted paths). */
  supersededTodoId?: string;
  /** The escalation id created on the cap-exhausted path. */
  escalationId?: string;
}

/**
 * Re-serve a poisoned leaf: clone its spec to a FRESH todo id (up to RESERVE_CAP times
 * per lineage), abandon the old todo, and record the supersedes link — or, once the cap
 * is exhausted, escalate to a human instead of minting a 3rd id.
 *
 * A graph transaction with four outcomes:
 *   - NOT poisoned                → no-op, {reason:'not-poisoned'}.
 *   - old todo missing            → no-op, {reason:'old-todo-missing'}.
 *   - poisoned & reserveCount < 2 → clone (fresh uuid), drop old, link, {reserved, reason:'reserved'}.
 *   - poisoned & reserveCount ≥ 2 → escalate, {escalated:true, reason:'cap-exhausted'}.
 */
export async function reserveLeaf(
  project: string,
  oldTodoId: string,
  opts: { actor: string; reason: string },
  deps: ReserveLeafDeps = {},
): Promise<ReserveLeafResult> {
  if (!isPoisonLooped(project, oldTodoId, deps)) {
    return { reason: 'not-poisoned' };
  }

  const old = getTodo(project, oldTodoId);
  if (!old) return { reason: 'old-todo-missing' };
  const oldId = old.id; // normalize any short-id input to the full id

  const priorReserves = old.reserveCount ?? 0;
  if (priorReserves >= RESERVE_CAP) {
    // Cap exhausted — never mint a 3rd id. Escalate to a human (converts the infinite
    // loop into "2 attempts then human"). Stamp actor + reason for observability.
    const escalate = deps.createEscalation ?? createEscalation;
    const { escalation } = escalate({
      project,
      session: opts.actor,
      kind: 'poison-loop-cap',
      todoId: oldId,
      questionText:
        `Leaf "${old.title}" (${oldId.slice(0, 8)}) is poison-looped: rejected ≥2 times with an ` +
        `unchanged blueprint, and has already been re-served ${priorReserves} times (cap ${RESERVE_CAP}). ` +
        `Re-serve requested by ${opts.actor} (${opts.reason}). A fresh id will NOT help — the plan ` +
        `itself needs human attention (rescope, split, or abandon).`,
      operatorGated: true,
    });
    // B6 observability — fail-open: a throw in the recorder must NEVER break the reserve path.
    try {
      recordAutonomousMutation({
        kind: 'reserve-leaf',
        actor: opts.actor,
        reason: `cap-exhausted:${opts.reason}`,
        project,
        detail: oldId,
        at: Date.now(),
      });
    } catch { /* fail-open */ }
    return {
      escalated: true,
      reason: 'cap-exhausted',
      supersededTodoId: oldId,
      escalationId: escalation.id,
    };
  }

  // Under the cap → clone the leaf's spec to a FRESH todo id. Copy the structural fields
  // that define the same unit of work; leave run-state (claim/ledger/blueprintId) behind.
  const clone: Todo = await createTodo(project, {
    ownerSession: old.ownerSession,
    assigneeSession: old.assigneeSession,
    assigneeKind: old.assigneeKind,
    title: old.title,
    description: old.description,
    parentId: old.parentId,
    dependsOn: old.dependsOn,
    kind: old.kind ?? 'leaf',
    type: old.type,
    tier: old.tier ?? undefined,
    targetProject: old.targetProject,
    servesCriterionId: old.servesCriterionId,
    servesCriterionIds: old.servesCriterionIds.length > 0 ? old.servesCriterionIds : null,
    // A leaf under an approved epic is already parented; allowOrphan keeps the create
    // from tripping the every-todo-needs-an-epic guard when parentId is unexpectedly null.
    allowOrphan: true,
    // Preserve readiness: if the poisoned leaf was approved, the fresh clone should be
    // claimable by the daemon too (else the re-served work strands unapproved).
    status: old.approvedAt != null ? 'ready' : undefined,
  });

  // Stamp the lineage + observability columns on the fresh clone (bump reserveCount,
  // record supersedes + actor/reason — read by B6). Also record who re-approved it
  // (approvedBy) when the clone was minted ready, mirroring the original's approval.
  const now = new Date().toISOString();
  openDb(project)
    .prepare(
      `UPDATE todos SET reserveCount = ?, supersedes = ?, reservedByActor = ?, reservedReason = ?,
         approvedBy = CASE WHEN approvedAt IS NOT NULL THEN ? ELSE approvedBy END, updatedAt = ? WHERE id = ?`,
    )
    .run(priorReserves + 1, oldId, opts.actor, opts.reason, opts.actor, now, clone.id);

  // Abandon the old todo (status 'dropped') so VERIFY/rollups don't double-count the
  // superseded lineage. force:true releases any lingering claim on the poisoned leaf.
  await updateTodo(project, oldId, { status: 'dropped', force: true });

  // B6 observability — fail-open: a throw in the recorder must NEVER break the reserve path.
  try {
    recordAutonomousMutation({
      kind: 'reserve-leaf',
      actor: opts.actor,
      reason: opts.reason,
      project,
      detail: `${oldId}→${clone.id}`,
      at: Date.now(),
    });
  } catch { /* fail-open */ }

  return { reserved: clone.id, reason: 'reserved', supersededTodoId: oldId };
}
