// Hermetic tests for survivor-safe terminalizeLandedEpics — unclaimed claimable children block terminalization
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, getTodo, listTodos, updateTodo, _closeProject,
} from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { terminalizeLandedEpics, runLandedEpicSweep, type BranchGcRunner } from '../landed-epic-sweep';
import { findViolations } from '../invariant-check';
import type { EpicLandCommit } from '../epic-landedness';
import { isClaimable } from '../claimability';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-terminalize-survivor-'));
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

describe('survivor-safe terminalizeLandedEpics', () => {
  test('an unclaimed claimable child survives and blocks terminalization', async () => {
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    // Create epic with a [LAND] leaf to prevent auto-completion
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] land with unclaimed claimable child',
      kind: 'epic',
      status: 'todo',
    });
    // Approve the epic so children can be claimable
    await updateTodo(project, epic.id, { approvedAt: '2026-08-03T11:00:00Z', approvedBy: 's1' });

    const land = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LAND] land me → master',
      parentId: epic.id,
      kind: 'land',
      status: 'todo',
    });

    // Create an unclaimed, claimable leaf child (planned status, approved)
    const leaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] planned but approved',
      parentId: epic.id,
      kind: 'leaf',
      status: 'planned',
    });
    // Make it claimable by approving it
    await updateTodo(project, leaf.id, { approvedAt: '2026-08-03T12:00:00Z', approvedBy: 's1' });

    // Capture pre-sweep state
    const leafBefore = getTodo(project, leaf.id)!;
    const leafBeforeUpdatedAt = leafBefore.updatedAt;

    const probe = probeFor(epic.id);

    // Run terminalizeLandedEpics — should skip epic and record survivor child
    const result = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    // Verify the epic was NOT terminalized (skipped due to survivor)
    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // Verify the survivor child is recorded
    expect(result.survivorChildren).toContain(leaf.id);

    // Verify no children were dropped
    expect(result.droppedChildren).not.toContain(leaf.id);

    // Verify the leaf was not modified by the sweep
    const leafAfter = getTodo(project, leaf.id)!;
    expect(leafAfter.status).not.toBe('dropped');
    expect(leafAfter.status).toBe(leafBefore.status);
    expect(leafAfter.updatedAt).toBe(leafBeforeUpdatedAt);

    // Verify the epic was not modified
    const epicAfter = getTodo(project, epic.id)!;
    expect(epicAfter.status).not.toBe('done');
    expect(epicAfter.landedAt).toBeNull();

    // Verify no invariant violations
    const allTodos = listTodos(project, { includeCompleted: true });
    const violations = findViolations(allTodos);
    const liveChildViolations = violations.filter(
      (v) => v.kind === 'live-child-under-terminal-epic' && v.todoId === leaf.id,
    );
    expect(liveChildViolations).toHaveLength(0);

    // Verify the child is still claimable
    const byId = new Map(allTodos.map((t) => [t.id, t]));
    expect(isClaimable(leafAfter, byId)).toBe(true);
  });

  test('terminalizeLandedEpics is idempotent: repeated calls on survivor children skip consistently', async () => {
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    // Create epic with [LAND] leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] land with unclaimed claimable child',
      kind: 'epic',
      status: 'todo',
    });
    // Approve the epic so children can be claimable
    await updateTodo(project, epic.id, { approvedAt: '2026-08-03T11:00:00Z', approvedBy: 's1' });

    const land = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LAND] land me → master',
      parentId: epic.id,
      kind: 'land',
      status: 'todo',
    });

    // Create an unclaimed, claimable leaf child
    const leaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] planned but approved',
      parentId: epic.id,
      kind: 'leaf',
      status: 'planned',
    });
    await updateTodo(project, leaf.id, { approvedAt: '2026-08-03T12:00:00Z', approvedBy: 's1' });

    const probe = probeFor(epic.id);

    // First call to terminalizeLandedEpics
    const result1 = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    expect(result1.terminalized).not.toContain(epic.id);
    expect(result1.survivorChildren).toContain(leaf.id);
    expect(result1.droppedChildren).not.toContain(leaf.id);

    // Verify leaf is still alive and claimable after first call
    let leafAfter = getTodo(project, leaf.id)!;
    expect(leafAfter.status).toBe('planned');
    let byId = new Map(listTodos(project, { includeCompleted: true }).map((t) => [t.id, t]));
    expect(isClaimable(leafAfter, byId)).toBe(true);

    // Second call to terminalizeLandedEpics (idempotent) — should skip the same way
    const result2 = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    expect(result2.terminalized).not.toContain(epic.id);
    expect(result2.survivorChildren).toContain(leaf.id);
    expect(result2.droppedChildren).not.toContain(leaf.id);

    // Verify leaf is still alive and unchanged after second call
    leafAfter = getTodo(project, leaf.id)!;
    expect(leafAfter.status).toBe('planned');
    byId = new Map(listTodos(project, { includeCompleted: true }).map((t) => [t.id, t]));
    expect(isClaimable(leafAfter, byId)).toBe(true);

    // Verify no invariant violations after both runs
    const allTodos = listTodos(project, { includeCompleted: true });
    const violations = findViolations(allTodos);
    const liveChildViolations = violations.filter(
      (v) => v.kind === 'live-child-under-terminal-epic' && v.todoId === leaf.id,
    );
    expect(liveChildViolations).toHaveLength(0);
  });
});
