// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertType, createObject, listObjects, _closeProject } from '../system-object-store';
import {
  satisfy, createEdge, listEdges, markStaleForObject,
} from '../system-object-edges';
import {
  createDecisionRecord, approveDecisionRecord, listDecisionRecords,
} from '../decision-record-store';
import { createTodo } from '../todo-store';
import { specHealth, driftCandidates, inverseCoverage, allCandidates, syncShortlist, SYNC_CAP } from '../cartographer';
import type { SystemObjectType } from '../domain-plugin';

let project: string;
let objId: string;

const T: SystemObjectType = {
  id: 'demo:Thing', version: 1, domain: 'demo', attributeSchema: {},
  allowedChildTypes: [], requiredArtifacts: [], gateBinding: null, agentProfile: null,
};

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'cartographer-'));
  await upsertType(project, T);
  const o = await createObject(project, { typeId: 'demo:Thing', name: 'thing', attributes: { v: 1 } });
  objId = o.id;
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

/** Author an APPROVED (active) requirement scoped to an epic. */
function activeRequirement(epicId: string | null, title: string): string {
  const r = createDecisionRecord(project, {
    kind: 'requirement', title, epicId,
    spec: { metric: 'm', op: '>=', target: 1 },
  });
  approveDecisionRecord(project, r.id, 'tester');
  return r.id;
}

/** A done todo that built `objectRef`, optionally under an epic parent. */
async function doneObjectTodo(objectRef: string, parentId: string | null) {
  return createTodo(project, {
    ownerSession: 's', title: 'build it', status: 'done', objectRef, parentId,
  });
}

describe('inverse coverage — the satisfy-edge KEY (aboutObjectId, not srcId)', () => {
  test('a done object-todo with EXACTLY ONE epic requirement proposes a satisfy edge', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    const reqId = activeRequirement(epic.id, 'req-A');
    await doneObjectTodo(objId, epic.id);

    const cands = inverseCoverage(project);
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('missing-satisfy-edge');
    expect(cands[0].provenance).toContain(`requirement=${reqId}`);
    expect(cands[0].confidence).toBeGreaterThan(0.5);
  });

  test('an ACTIVE satisfy edge keyed on aboutObjectId clears the gap', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    const reqId = activeRequirement(epic.id, 'req-A');
    await doneObjectTodo(objId, epic.id);

    satisfy(project, objId, reqId); // aboutObjectId === objId
    expect(inverseCoverage(project)).toHaveLength(0);
  });

  test('an edge whose srcId is the object but aboutObjectId is ANOTHER object does NOT count as proof', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    const reqId = activeRequirement(epic.id, 'req-A');
    await doneObjectTodo(objId, epic.id);

    // Mis-keyed edge: source is our object, but aboutObjectId points elsewhere.
    // Keying coverage on srcId (the bug) would falsely clear the gap; keying on
    // aboutObjectId (correct) leaves it open.
    createEdge(project, 'satisfy', objId, reqId, 'some-other-object');
    expect(inverseCoverage(project)).toHaveLength(1);
  });

  test('zero active requirements → downgrade to an uncovered-requirement QUESTION (no guess)', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    await doneObjectTodo(objId, epic.id); // epic has NO requirement

    const cands = inverseCoverage(project);
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('uncovered-requirement');
    expect(cands[0].question).toBeTruthy();
    expect(cands[0].confidence).toBeLessThan(0.5);
  });

  test('many active requirements → also a question, never a guessed satisfy', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    activeRequirement(epic.id, 'req-A');
    activeRequirement(epic.id, 'req-B');
    await doneObjectTodo(objId, epic.id);

    const cands = inverseCoverage(project);
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('uncovered-requirement');
  });

  test('a NON-done object-todo is not a coverage gap', async () => {
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    activeRequirement(epic.id, 'req-A');
    await createTodo(project, { ownerSession: 's', title: 'wip', status: 'planned', objectRef: objId, parentId: epic.id });
    expect(inverseCoverage(project)).toHaveLength(0);
  });
});

describe('drift candidates (stale-proof)', () => {
  test('a stale, un-reauthored proof yields a stale-proof candidate keyed on its requirement', () => {
    const reqId = 'req:A';
    satisfy(project, objId, reqId);
    markStaleForObject(project, objId);

    const cands = driftCandidates(project);
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('stale-proof');
    expect(cands[0].provenance).toContain(`object=${objId}`);
    expect(cands[0].provenance).toContain(`requirement=${reqId}`);
  });

  test('a re-authored proof is NOT drift', () => {
    satisfy(project, objId, 'req:A');
    markStaleForObject(project, objId);
    satisfy(project, objId, 'req:A'); // re-author → fresh active edge clears drift
    expect(driftCandidates(project)).toHaveLength(0);
  });
});

describe('specHealth summary', () => {
  test('counts uncovered requirements, orphan objects, and stale edges', async () => {
    const reqId = activeRequirement(null, 'project-req'); // project-level, uncovered
    // objId has no satisfy edge → orphan + its requirement uncovered.
    let h = specHealth(project);
    expect(h.uncoveredRequirements).toBe(1);
    expect(h.orphanObjects).toBe(1);
    expect(h.staleEdges).toBe(0);

    // Cover it, then stale it.
    satisfy(project, objId, reqId);
    h = specHealth(project);
    expect(h.uncoveredRequirements).toBe(0);
    expect(h.orphanObjects).toBe(0);

    markStaleForObject(project, objId);
    h = specHealth(project);
    expect(h.staleEdges).toBe(1);
    expect(h.uncoveredRequirements).toBe(1); // proof gone stale → uncovered again
    expect(h.orphanObjects).toBe(1);
  });
});

describe('syncShortlist — rank / dedupe / cap (cartographer_sync payload)', () => {
  test('quiet-by-default: nothing drifted → inSync with empty shortlist', () => {
    const r = syncShortlist(project);
    expect(r.inSync).toBe(true);
    expect(r.message).toBe('spec in sync');
    expect(r.shortlist).toEqual([]);
    expect(r.total).toBe(0);
  });

  test('drift outranks inverse-coverage, and same-object candidates dedupe', async () => {
    // Inverse-coverage gap on objId (done todo, one epic requirement, no satisfy).
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    activeRequirement(epic.id, 'req-A');
    await doneObjectTodo(objId, epic.id);
    // Drift on the SAME object (a stale proof to a different requirement).
    satisfy(project, objId, 'req:stale');
    markStaleForObject(project, objId);

    const r = syncShortlist(project);
    expect(r.inSync).toBe(false);
    // Both detectors fire for objId; dedupe collapses to one, drift wins (ranked first).
    expect(r.total).toBe(1);
    expect(r.shortlist).toHaveLength(1);
    expect(r.shortlist[0].kind).toBe('stale-proof');
    expect(r.shortlist[0].objectRef).toBe(objId);
    // Serializable payload carries no `write` thunk.
    expect('write' in r.shortlist[0]).toBe(false);
  });

  test('caps at SYNC_CAP and reports "N more, lower confidence"', async () => {
    // Build SYNC_CAP + 2 independent drift candidates (distinct objects).
    const extra = SYNC_CAP + 2;
    for (let i = 0; i < extra; i++) {
      const o = await createObject(project, { typeId: 'demo:Thing', name: `o${i}`, attributes: { i } });
      satisfy(project, o.id, `req:${i}`);
      markStaleForObject(project, o.id);
    }
    const r = syncShortlist(project);
    expect(r.total).toBe(extra);
    expect(r.shortlist).toHaveLength(SYNC_CAP);
    expect(r.more).toBe(extra - SYNC_CAP);
    expect(r.message).toContain(`${extra - SYNC_CAP} more`);
  });

  test('cartographer_health payload mirrors specHealth (read-only counts)', () => {
    // The verb returns { health: specHealth(project) } — assert the shape directly.
    const health = specHealth(project);
    expect(health).toEqual({ uncoveredRequirements: 0, orphanObjects: 1, staleEdges: 0 });
  });
});

describe('ZERO-WRITE contract', () => {
  test('no detector mutates edges, decision records, or objects; writes are unexecuted thunks', async () => {
    // Set up every signal at once.
    const epic = await createTodo(project, { ownerSession: 's', title: '[EPIC]' });
    activeRequirement(epic.id, 'req-A');
    await doneObjectTodo(objId, epic.id);
    satisfy(project, objId, 'req:stale');
    markStaleForObject(project, objId);

    const snapshot = () => JSON.stringify({
      edges: listEdges(project),
      records: listDecisionRecords(project),
      objects: listObjects(project),
    });
    const before = snapshot();

    const cands = allCandidates(project);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(typeof c.write).toBe('function');

    // Running the detectors changed nothing.
    expect(snapshot()).toBe(before);
  });
});
