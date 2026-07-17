/**
 * Enumeration/equivalence proof + staleness regression for checkLandDeps' derived
 * barrier (constraint 856840e6): the satisfaction check is re-derived from live
 * epic-sibling state instead of the land leaf's stored `dependsOn` edges, because
 * a sibling added AFTER the land leaf is minted has no entry in `dependsOn` and the
 * old stored-edge walk was blind to it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'land-derived-deps-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { checkLandDeps } from '../land-authority';
import { createTodo, updateTodo, listTodos, _closeProject, type Todo } from '../todo-store';
import { upsertMission } from '../mission-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { _closeLedgerDb } from '../worker-ledger';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

/**
 * Pre-image of the OLD (pre-change) checkLandDeps satisfaction check: walks the
 * land leaf's stored `dependsOn` edges only, blind to any sibling not in that list.
 * Mirrors land-authority.ts:247-263 before this leaf's change.
 */
function oldSatisfied(todos: Todo[], epicId: string): boolean {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const landLeaf = todos.find((t) => t.parentId === epicId && t.kind === 'land' && t.status !== 'dropped');
  if (!landLeaf) return false;
  for (const depId of landLeaf.dependsOn) {
    const dep = byId.get(depId);
    if (!dep || dep.status !== 'done' || dep.acceptanceStatus === 'rejected') return false;
  }
  return true;
}

function newSatisfied(todos: Todo[], epicId: string): boolean {
  return checkLandDeps(todos, epicId) === null;
}

describe('checkLandDeps — derived land barrier (constraint 856840e6)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'land-derived-repo-'));
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    _closeLedgerDb();
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('fixture 1 — mission-homed epic, single done+accepted dep, no other siblings: both agree satisfied', async () => {
    const m1 = (await createTodo(project, { allowOrphan: true, title: '[MISSION] m1', kind: 'mission', ownerSession: 'sess-A' })) as Todo;
    const epic = (await createTodo(project, { title: '[EPIC] e1', kind: 'epic', parentId: m1.id, ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land e1', kind: 'land', parentId: epic.id, dependsOn: [leafA.id], ownerSession: 'sess-A' });
    upsertMission(project, m1.id);

    const todos = listTodos(project, { includeCompleted: true });
    expect(oldSatisfied(todos, epic.id)).toBe(true);
    expect(newSatisfied(todos, epic.id)).toBe(true);
  });

  it('fixture 2 — root epic, two done+accepted deps: both agree satisfied', async () => {
    const epic = (await createTodo(project, { allowOrphan: true, title: '[EPIC] root', kind: 'epic', ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    let leafB = (await createTodo(project, { title: 'b', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafB = (await updateTodo(project, leafB.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land root', kind: 'land', parentId: epic.id, dependsOn: [leafA.id, leafB.id], ownerSession: 'sess-A' });

    const todos = listTodos(project, { includeCompleted: true });
    expect(oldSatisfied(todos, epic.id)).toBe(true);
    expect(newSatisfied(todos, epic.id)).toBe(true);
  });

  it('fixture 3 — dropped sibling not in dependsOn and not done: both agree satisfied (dropped never gates)', async () => {
    const epic = (await createTodo(project, { allowOrphan: true, title: '[EPIC] withdropped', kind: 'epic', ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land withdropped', kind: 'land', parentId: epic.id, dependsOn: [leafA.id], ownerSession: 'sess-A' });
    const leafC = (await createTodo(project, { title: 'c', parentId: epic.id, ownerSession: 'sess-A' })) as Todo;
    await updateTodo(project, leafC.id, { status: 'dropped' });

    const todos = listTodos(project, { includeCompleted: true });
    expect(oldSatisfied(todos, epic.id)).toBe(true);
    expect(newSatisfied(todos, epic.id)).toBe(true);
  });

  it('fixture 4 — DIVERGENCE: sibling added after land leaf minted, never healed into dependsOn', async () => {
    const epic = (await createTodo(project, { allowOrphan: true, title: '[EPIC] stale', kind: 'epic', ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land stale', kind: 'land', parentId: epic.id, dependsOn: [leafA.id], ownerSession: 'sess-A' });

    // leafB is created AFTER the land leaf, under the same epic, and is never added
    // to the land leaf's dependsOn — simulating a leaf added post-mint that the
    // stored edge list was never healed to include. Not done (planned), which is
    // enough to prove the divergence — 'in_progress' is a derived status that
    // createTodo rejects (ManualInProgressError), so it isn't used here.
    const leafB = (await createTodo(project, {
      title: 'b',
      parentId: epic.id,
      ownerSession: 'sess-A',
    })) as Todo;

    const todos = listTodos(project, { includeCompleted: true });

    // OLD reimplementation is blind to leafB (not in dependsOn) → reports satisfied.
    expect(oldSatisfied(todos, epic.id)).toBe(true);

    // NEW code derives from live siblings → blocks on leafB.
    const blocker = checkLandDeps(todos, epic.id);
    expect(blocker).not.toBeNull();
    expect(blocker?.code).toBe('land-deps-unsatisfied');
    expect(blocker?.message).toContain(leafB.id.slice(0, 8));
  });

  it('fixture 5 — rejected sibling not in dependsOn: both OLD blind (satisfied), NEW blocks', async () => {
    const epic = (await createTodo(project, { allowOrphan: true, title: '[EPIC] rejectedsib', kind: 'epic', ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land rejectedsib', kind: 'land', parentId: epic.id, dependsOn: [leafA.id], ownerSession: 'sess-A' });

    let leafC = (await createTodo(project, { title: 'c', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafC = (await updateTodo(project, leafC.id, { acceptanceStatus: 'rejected' })) as Todo;

    const todos = listTodos(project, { includeCompleted: true });

    expect(oldSatisfied(todos, epic.id)).toBe(true);
    const blocker = checkLandDeps(todos, epic.id);
    expect(blocker).not.toBeNull();
    expect(blocker?.message).toContain(leafC.id.slice(0, 8));
  });

  it('read-only comparison against the live project store (report artifact, non-asserting)', () => {
    const liveProject = process.env.MERMAID_PROJECT;
    if (!liveProject) {
      console.log('[land-derived-deps] MERMAID_PROJECT not set — skipping live comparison');
      return;
    }
    try {
      const liveTodos = listTodos(liveProject, { includeCompleted: true });
      const epicIds = new Set(
        liveTodos.filter((t) => t.kind === 'land').map((t) => t.parentId).filter((id): id is string => !!id),
      );
      for (const epicId of epicIds) {
        console.log(
          `[land-derived-deps] epic=${epicId.slice(0, 8)} OLD-satisfied=${oldSatisfied(liveTodos, epicId)} NEW-satisfied=${newSatisfied(liveTodos, epicId)}`,
        );
      }
    } catch (err) {
      console.log(`[land-derived-deps] live comparison unavailable: ${(err as Error).message}`);
    }
  });
});

describe('checkLandDeps — staleness regression (Test group B)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'land-derived-repo-b-'));
    _closeProject(project);
  });

  afterEach(() => {
    _closeProject(project);
    _closeLedgerDb();
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('flips satisfied → unsatisfied when a sibling is added after the land leaf, then back to satisfied once done+accepted', async () => {
    const epic = (await createTodo(project, { allowOrphan: true, title: '[EPIC] regress', kind: 'epic', ownerSession: 'sess-A' })) as Todo;
    let leafA = (await createTodo(project, { title: 'a', parentId: epic.id, status: 'done', ownerSession: 'sess-A' })) as Todo;
    leafA = (await updateTodo(project, leafA.id, { acceptanceStatus: 'accepted' })) as Todo;
    await createTodo(project, { title: '[LAND] land regress', kind: 'land', parentId: epic.id, dependsOn: [leafA.id], ownerSession: 'sess-A' });

    // Land succeeds before leafB exists.
    let todos = listTodos(project, { includeCompleted: true });
    expect(checkLandDeps(todos, epic.id)).toBeNull();

    // leafB added AFTER the land leaf, not done.
    let leafB = (await createTodo(project, { title: 'b', parentId: epic.id, ownerSession: 'sess-A' })) as Todo;
    todos = listTodos(project, { includeCompleted: true });
    const blocker = checkLandDeps(todos, epic.id);
    expect(blocker).not.toBeNull();
    expect(blocker?.code).toBe('land-deps-unsatisfied');

    // Complete + accept leafB → satisfied again.
    leafB = (await updateTodo(project, leafB.id, { status: 'done', acceptanceStatus: 'accepted' })) as Todo;
    todos = listTodos(project, { includeCompleted: true });
    expect(checkLandDeps(todos, epic.id)).toBeNull();
  });
});
