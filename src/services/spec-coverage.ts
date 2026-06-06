import {
  approveDecisionRecord,
  supersedeDecisionRecord,
  createDecisionRecord,
  getDecisionRecord,
  type DecisionRecord,
  type RequirementSpec,
} from './decision-record-store';
import { listObjects } from './system-object-store';
import { listTodos, type Todo } from './todo-store';
import type { SystemObject } from './domain-plugin';

/**
 * Spec coverage + requirement-decision seam (design-system-object-ui §5/§8).
 *
 * Coverage answers "is the system covered?" off the cheap, inline `Todo.objectRef`
 * join — NEVER a full-tree walk, NEVER a stored ledger, NEVER a WS channel. A
 * system object is `covered` once a Todo that builds it (Todo.objectRef === obj.id)
 * is done, `partial` while such a Todo exists but is not yet done, and `uncovered`
 * when no Todo references it. (One-red discipline: uncovered is amber, not red —
 * that tint is the UI's call; here we just report the bucket.)
 *
 * `computeCoverage` is pure (objects + todos in → rollup out) so it is unit-testable
 * without a DB; `specCoverage` is the thin per-project wrapper the REST/MCP surface
 * calls. Both are O(objects + todos) — the "cheap, no per-change recompute" P1 bar.
 */

export type CoverageState = 'covered' | 'partial' | 'uncovered';

export interface ObjectCoverage {
  objectId: string;
  name: string;
  typeId: string;
  state: CoverageState;
  /** Todos whose objectRef points at this object. */
  todoCount: number;
  /** …of which are done. */
  doneCount: number;
}

export interface CoverageRollup {
  total: number;
  covered: number;
  partial: number;
  uncovered: number;
  byObject: ObjectCoverage[];
}

/** Pure coverage derivation over the Todo.objectRef → SystemObject join. */
export function computeCoverage(objects: SystemObject[], todos: Todo[]): CoverageRollup {
  // Bucket todos by the object they build (single pass over the join key).
  const byRef = new Map<string, { total: number; done: number }>();
  for (const t of todos) {
    if (!t.objectRef) continue;
    const acc = byRef.get(t.objectRef) ?? { total: 0, done: 0 };
    acc.total += 1;
    if (t.status === 'done') acc.done += 1;
    byRef.set(t.objectRef, acc);
  }

  const byObject: ObjectCoverage[] = objects.map((o) => {
    const acc = byRef.get(o.id) ?? { total: 0, done: 0 };
    const state: CoverageState =
      acc.done > 0 ? 'covered' : acc.total > 0 ? 'partial' : 'uncovered';
    return { objectId: o.id, name: o.name, typeId: o.typeId, state, todoCount: acc.total, doneCount: acc.done };
  });

  const rollup: CoverageRollup = {
    total: byObject.length,
    covered: byObject.filter((c) => c.state === 'covered').length,
    partial: byObject.filter((c) => c.state === 'partial').length,
    uncovered: byObject.filter((c) => c.state === 'uncovered').length,
    byObject,
  };
  return rollup;
}

/** Per-project coverage rollup. Reads the durable objects + all todos (incl. done). */
export function specCoverage(project: string): CoverageRollup {
  return computeCoverage(listObjects(project), listTodos(project, { includeCompleted: true }));
}

export type RequirementDecision = 'approve' | 'reject' | 'edit';

export interface DecideRequirementInput {
  id: string;
  decision: RequirementDecision;
  /** Who signed (approve/edit). Defaults to 'human'. */
  approvedBy?: string;
  /** New machine-checkable spec — required for an `edit` re-sign. */
  spec?: RequirementSpec;
  /** Optional new title for an `edit` re-sign (defaults to the prior title). */
  title?: string;
}

export interface DecideRequirementResult {
  /** The resulting live record: the approved one, the rejected (superseded) one,
   *  or — for an edit — the freshly-proposed replacement. */
  record: DecisionRecord | null;
  /** For an `edit`, the prior record now superseded by `record`. */
  superseded?: DecisionRecord | null;
}

/**
 * Decide a proposed/changed requirement, reusing the decision-record approve /
 * supersede path (§8 "reusing the decision-record approve/supersede path"):
 *  - approve → mark active (one-key sign).
 *  - reject  → supersede with no live replacement (a DIFF that drops the promise).
 *  - edit    → create a fresh `proposed` requirement carrying the new spec and
 *              supersede the old by it (the re-sign DIFF: old chip retired, new
 *              chip re-enters the inbox for signature).
 */
export function decideRequirement(project: string, input: DecideRequirementInput): DecideRequirementResult {
  const signer = input.approvedBy ?? 'human';
  switch (input.decision) {
    case 'approve':
      return { record: approveDecisionRecord(project, input.id, signer) };
    case 'reject':
      // Supersede with a non-null marker so the prior record leaves the inbox
      // without pointing at a live replacement.
      return { record: supersedeDecisionRecord(project, input.id, `rejected:${input.id}`) };
    case 'edit': {
      if (!input.spec) throw new Error('decideRequirement: edit requires a new spec');
      const old = getDecisionRecord(project, input.id);
      const created = createDecisionRecord(project, {
        kind: 'requirement',
        title: input.title ?? old?.title ?? 'requirement',
        epicId: old?.epicId ?? null,
        spec: input.spec,
        rationale: old?.rationale ?? null,
        authorSession: old?.authorSession ?? null,
      });
      const superseded = supersedeDecisionRecord(project, input.id, created.id);
      return { record: created, superseded };
    }
    default:
      throw new Error(`decideRequirement: unknown decision "${(input as { decision: string }).decision}"`);
  }
}
