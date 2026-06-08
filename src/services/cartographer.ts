import { coverage, listEdges, staleObjectIds, satisfy } from './system-object-edges';
import { getActiveRequirements, supersedeDecisionRecord } from './decision-record-store';
import { listObjects } from './system-object-store';
import { listTodos, type Todo } from './todo-store';

/**
 * Cartographer — deterministic spec/coverage drift detectors (design-cartographer
 * §4/§8, Phase 1). NO LLM, NO daemon, NO new gate. PURE read-only functions over
 * the existing system-object + decision-record + todo stores.
 *
 * THE ZERO-WRITE CONTRACT (§4): every detector here is a pure read. The proposals
 * they emit carry their eventual mutation as a `write` THUNK that is NEVER executed
 * in this module — a later (Phase 2) component decides whether to apply it. A
 * detector that mutates is a bug; the unit tests assert zero rows change.
 *
 * THE SATISFY-EDGE KEY (§4 + top-risk #1): a satisfy edge stores the built object on
 * `aboutObjectId` (NOT srcId). Coverage matches the requirement on dstId with
 * status='active' (stale excluded). The inverse-coverage query therefore keys
 * "does this object have a live proof?" on `e.aboutObjectId === todo.objectRef &&
 * e.kind === 'satisfy' && e.status === 'active'`. Keying on srcId silently
 * mis-reports orphans.
 */

export type ProposalKind = 'stale-proof' | 'missing-satisfy-edge' | 'uncovered-requirement';

export interface ProposalCandidate {
  kind: ProposalKind;
  /** How this candidate was derived (detector + the ids it keyed on). */
  provenance: string;
  /** 0..1 — how confident the detector is that the `write` is the right fix.
   *  A downgraded "question" (couldn't pick a single target) carries low confidence. */
  confidence: number;
  /** Human-readable framing — set when the candidate is a QUESTION the detector
   *  refused to guess (zero/many active requirements), not an auto-applyable write. */
  question?: string;
  /** The eventual mutation, captured but NOT executed here. A Phase-2 component
   *  applies it after review. For a pure question it is a no-op. */
  write: () => unknown;
}

export interface SpecHealth {
  /** Active requirements with NO active satisfy/verify edge (coverage gap). */
  uncoveredRequirements: number;
  /** Durable objects with NO active satisfy edge claiming them (unproven). */
  orphanObjects: number;
  /** Objects whose traceability proof drifted stale and was not re-authored. */
  staleEdges: number;
}

/** The active-requirement ids in scope for the whole project (epic-level + project-level). */
function activeRequirementIds(project: string): string[] {
  return getActiveRequirements(project).map((r) => r.id);
}

/** Object ids that currently hold an ACTIVE satisfy edge (keyed on aboutObjectId). */
function provenObjectIds(project: string): Set<string> {
  const ids = new Set<string>();
  for (const e of listEdges(project, { kind: 'satisfy', status: 'active' })) {
    if (e.aboutObjectId) ids.add(e.aboutObjectId);
  }
  return ids;
}

/**
 * §8 spec-health summary: three deterministic drift counts derived from the
 * coverage LEFT JOIN, the durable object set, and the stale-object signal. Pure
 * read; zero writes.
 */
export function specHealth(project: string): SpecHealth {
  const reqIds = activeRequirementIds(project);
  const uncoveredRequirements = coverage(project, reqIds).uncovered.length;

  const proven = provenObjectIds(project);
  const orphanObjects = listObjects(project).filter((o) => !proven.has(o.id)).length;

  const staleEdges = staleObjectIds(project).length;

  return { uncoveredRequirements, orphanObjects, staleEdges };
}

/**
 * §4 drift detector: every object whose proof went stale (a content-hash bump
 * staled its satisfy/verify edge without re-authoring) is a SUPERSEDE candidate.
 * We do NOT call supersedeDecisionRecord here — the candidate carries it as an
 * unexecuted thunk keyed on the stale edge's requirement (dstId). Tagged
 * 'stale-proof'. Pure read.
 */
export function driftCandidates(project: string): ProposalCandidate[] {
  const staleByObject = new Map<string, string[]>();
  for (const e of listEdges(project, { status: 'stale' })) {
    if ((e.kind === 'satisfy' || e.kind === 'verify') && e.aboutObjectId) {
      const reqs = staleByObject.get(e.aboutObjectId) ?? [];
      reqs.push(e.dstId);
      staleByObject.set(e.aboutObjectId, reqs);
    }
  }
  // staleObjectIds() is the authoritative "drifted and not re-authored" set — a
  // stale edge whose requirement is re-covered by a fresh active edge is NOT drift.
  const drifted = new Set(staleObjectIds(project));

  const candidates: ProposalCandidate[] = [];
  for (const objectId of drifted) {
    for (const reqId of staleByObject.get(objectId) ?? []) {
      candidates.push({
        kind: 'stale-proof',
        provenance: `drift:object=${objectId},requirement=${reqId}`,
        confidence: 0.8,
        // Eventual mutation: retire the drifted proof's requirement record. NOT
        // executed here — captured for a Phase-2 reviewer to apply.
        write: () => supersedeDecisionRecord(project, reqId, `stale-proof:${objectId}`),
      });
    }
  }
  return candidates;
}

/** Root-ancestor (epic) id for a todo: walk parentId up; an unparented todo is its
 *  own epic. Cycle-guarded against malformed parent chains. */
function epicIdFor(todo: Todo, byId: Map<string, Todo>): string {
  const seen = new Set<string>();
  let cur: Todo = todo;
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

/**
 * §4 inverse coverage: a `done` todo that built an object (objectRef != null) whose
 * object has NO active satisfy edge is a 'missing-satisfy-edge' gap. If the todo's
 * epic has EXACTLY ONE active requirement we propose satisfy(object, req) as the
 * write thunk; with zero or many requirements we DON'T guess — we downgrade to an
 * 'uncovered-requirement' QUESTION with a no-op write. Pure read.
 */
export function inverseCoverage(project: string): ProposalCandidate[] {
  const todos = listTodos(project, { includeCompleted: true });
  const byId = new Map(todos.map((t) => [t.id, t]));
  const proven = provenObjectIds(project);

  const candidates: ProposalCandidate[] = [];
  for (const todo of todos) {
    if (todo.status !== 'done' || !todo.objectRef) continue;
    if (proven.has(todo.objectRef)) continue; // already has a live proof

    const epicId = epicIdFor(todo, byId);
    const reqs = getActiveRequirements(project, epicId);

    if (reqs.length === 1) {
      const reqId = reqs[0].id;
      candidates.push({
        kind: 'missing-satisfy-edge',
        provenance: `inverse-coverage:todo=${todo.id},object=${todo.objectRef},epic=${epicId},requirement=${reqId}`,
        confidence: 0.9,
        // Eventual mutation: author the missing satisfy edge. NOT executed here.
        write: () => satisfy(project, todo.objectRef!, reqId),
      });
    } else {
      // Zero or many active requirements → ambiguous. Refuse to guess; surface a
      // question instead so a human/planner picks (or authors) the requirement.
      candidates.push({
        kind: 'uncovered-requirement',
        provenance: `inverse-coverage:todo=${todo.id},object=${todo.objectRef},epic=${epicId},activeRequirements=${reqs.length}`,
        confidence: 0.3,
        question: reqs.length === 0
          ? `Object ${todo.objectRef} (built by done todo ${todo.id}) has no requirement to satisfy — which requirement does it cover?`
          : `Object ${todo.objectRef} (built by done todo ${todo.id}) could satisfy ${reqs.length} active requirements — which one?`,
        write: () => undefined, // no-op: nothing to apply without a chosen requirement
      });
    }
  }
  return candidates;
}

/** Convenience: every proposal candidate from all drift detectors, plus the health
 *  summary. Pure read; the returned `write` thunks are NEVER executed here. */
export function allCandidates(project: string): ProposalCandidate[] {
  return [...driftCandidates(project), ...inverseCoverage(project)];
}
