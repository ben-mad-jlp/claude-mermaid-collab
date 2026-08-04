// Hermetic tests for terminalizeLandedEpics — git-proof gating + in-flight guard + gated stamp + idempotency
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, getTodo, listTodos, updateTodo, claimTodo, _closeProject,
} from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { terminalizeLandedEpics, gcEpicBranches, type BranchGcRunner } from '../landed-epic-sweep';
import type { EpicLandCommit } from '../epic-landedness';
import { isEpic } from '../todo-kind';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-terminalize-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Seed an epic with completed leaf children. Create a [LAND] leaf to prevent epic auto-completion. */
async function seedEpicWithCompletedLeaves(epicTitle = '[EPIC] land me') {
  const epic = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: epicTitle,
    kind: 'epic',
    status: 'todo',
  });

  // Create the [LAND] leaf BEFORE completing impl leaves (prevents epic auto-completion)
  const land = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: '[LAND] land me → master',
    parentId: epic.id,
    kind: 'land',
    status: 'todo',
  });

  const leaf1 = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: '[LEAF] impl 1',
    parentId: epic.id,
    kind: 'leaf',
    status: 'todo',
  });

  const leaf2 = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: '[LEAF] impl 2',
    parentId: epic.id,
    kind: 'leaf',
    status: 'todo',
  });

  // Complete both impl leaves (epic won't auto-complete because [LAND] leaf is still todo)
  await completeTodo(project, leaf1.id, 'accepted');
  await completeTodo(project, leaf2.id, 'accepted');

  return { epic: getTodo(project, epic.id)!, leaf1, leaf2, land };
}

function probeFor(epicId: string): GitProbe {
  const branch = epicBranchName(epicId);
  return async (b) =>
    b === branch
      ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 }
      : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };
}

function branchGcRunnerFor(epicId: string): BranchGcRunner {
  const branch = epicBranchName(epicId);
  return {
    revParse: async (b) => (b === branch ? 'abc123def456' : null),
    deleteBranch: async (b) => b === branch,
    listEpicBranches: async () => [branch],
    aheadCount: async (b) => (b === branch ? 0 : -1),
    newCount: async (b) => (b === branch ? 0 : -1),
    pruneWorktreeFor: async () => {},
  };
}

describe('terminalizeLandedEpics', () => {
  test('basic: leaf completion sets status to done', async () => {
    const leaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] test',
      kind: 'leaf',
      status: 'todo',
    });

    await completeTodo(project, leaf.id, 'accepted');
    const reloaded = getTodo(project, leaf.id)!;
    expect(reloaded.status).toBe('done');
    expect(reloaded.acceptanceStatus).toBe('accepted');
  });

  test('completed epic is included in listTodos with includeCompleted', async () => {
    const { epic: seedEpic } = await seedEpicWithCompletedLeaves();
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    const probe = probeFor(seedEpic.id);
    await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    const allTodos = listTodos(project, { includeCompleted: true });
    const epic = allTodos.find((t) => t.id === seedEpic.id);
    expect(epic).toBeDefined();
    expect(epic!.status).toBe('done');
    expect(isEpic(epic)).toBe(true);
  });

  test('epic with all leaves done and a landed commit is terminalized (done+accepted+landedAt) and its branch is GC\'d', async () => {
    const { epic } = await seedEpicWithCompletedLeaves();
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    const probe = probeFor(epic.id);
    const result = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    expect(result.terminalized).toContain(epic.id);
    const reloaded = getTodo(project, epic.id)!;
    expect(reloaded.status).toBe('done');
    expect(reloaded.acceptanceStatus).toBe('accepted');
    expect(reloaded.landedAt).toBe(fakeCommitDate);

    // Verify the branch is now eligible for GC
    const runner = branchGcRunnerFor(epic.id);
    const gcResult = await gcEpicBranches(project, { probe, runner, baseRef: 'master' });
    expect(gcResult.deleted).toContain(epicBranchName(epic.id));
  });

  test('not-landed git status makes zero writes to the epic row', async () => {
    const { epic } = await seedEpicWithCompletedLeaves();
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'not-landed',
      sha: null,
      committedAtIso: null,
    });

    const before = getTodo(project, epic.id)!;

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const after = getTodo(project, epic.id)!;
    expect(after.status).toBe(before.status);
    expect(after.acceptanceStatus).toBe(before.acceptanceStatus);
    expect(after.landedAt).toBe(before.landedAt);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  test('indeterminate git status makes zero writes to the epic row', async () => {
    const { epic } = await seedEpicWithCompletedLeaves();
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'indeterminate',
      sha: null,
      committedAtIso: null,
    });

    const before = getTodo(project, epic.id)!;

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const after = getTodo(project, epic.id)!;
    expect(after.status).toBe(before.status);
    expect(after.acceptanceStatus).toBe(before.acceptanceStatus);
    expect(after.landedAt).toBe(before.landedAt);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  test('second pass over an already-terminalized epic is a no-op', async () => {
    const { epic: seedEpic } = await seedEpicWithCompletedLeaves();
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    const probe = probeFor(seedEpic.id);

    // First pass
    const result1 = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });
    expect(result1.terminalized).toContain(seedEpic.id);
    expect(result1.terminalized.length).toBe(1);

    const afterFirstPass = getTodo(project, seedEpic.id)!;
    expect(afterFirstPass.status).toBe('done');

    // Manually verify the epic is still returned by listTodos in the second pass's context
    const allTodosBeforeSecondPass = listTodos(project, { includeCompleted: true });
    const epicInList = allTodosBeforeSecondPass.find((t) => t.id === seedEpic.id);
    expect(epicInList).toBeDefined();
    expect(epicInList!.status).toBe('done');

    // Second pass
    const result2 = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    expect(result2.terminalized).toEqual([]);
    expect(result2.skipped).toBeGreaterThanOrEqual(1);

    const afterSecondPass = getTodo(project, seedEpic.id)!;
    // Prove idempotency: updatedAt is unchanged from first pass
    expect(afterSecondPass.updatedAt).toBe(afterFirstPass.updatedAt);
  });

  test('epic with in-flight child leaves is skipped (not terminalized)', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] has inflight',
      kind: 'epic',
      status: 'todo',
    });

    const inFlightLeaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] still building',
      parentId: epic.id,
      kind: 'leaf',
      status: 'todo',
    });

    const completedLeaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] done',
      parentId: epic.id,
      kind: 'leaf',
      status: 'todo',
    });

    // Complete only one leaf; leave the other in_progress via a claim
    await completeTodo(project, completedLeaf.id, 'accepted');

    // Claim the in-flight leaf to mark it as in-flight. This must be a PERSISTED claim:
    // assigning claimedBy on the reloaded row only mutates a detached object, so the guard
    // under test never saw an in-flight child and the case passed for the wrong reason.
    await updateTodo(project, inFlightLeaf.id, { approvedAt: '2026-08-03T12:00:00Z', approvedBy: 's1' });
    await claimTodo(project, inFlightLeaf.id, 's1', 30_000);

    const before = getTodo(project, epic.id)!;
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: '2026-08-03T12:34:56Z',
    });

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const after = getTodo(project, epic.id)!;
    // Verify no writes occurred
    expect(after.status).toBe(before.status);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  test('bucket epics are filtered out', async () => {
    const bucket = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[INBOX]',
      kind: 'epic',
      status: 'todo',
      isBucket: true,
    });

    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: '2026-08-03T12:34:56Z',
    });

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(bucket.id);
  });

  test('already-done epics are filtered out', async () => {
    const done = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] already done',
      kind: 'epic',
      status: 'done',
    });

    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: '2026-08-03T12:34:56Z',
    });

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(done.id);
  });

  test('dropped epics are filtered out', async () => {
    const dropped = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] dropped',
      kind: 'epic',
      status: 'dropped',
    });

    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: '2026-08-03T12:34:56Z',
    });

    const result = await terminalizeLandedEpics(project, {
      landCommit: landCommit as any,
    });

    expect(result.terminalized).not.toContain(dropped.id);
  });
});
