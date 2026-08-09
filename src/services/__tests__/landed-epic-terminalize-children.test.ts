// Hermetic tests for terminalizeLandedEpics drop-cascade on non-terminal children
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
import { terminalizeLandedEpics, type BranchGcRunner } from '../landed-epic-sweep';
import { findViolations, findLandedAtDivergence } from '../invariant-check';
import type { EpicLandCommit } from '../epic-landedness';
import { isEpic } from '../todo-kind';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-terminalize-children-'));
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

describe('terminalizeLandedEpics drop-cascade', () => {
  test('survivor unclaimed non-terminal children block terminalization (no drop occurs)', async () => {
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
      title: '[EPIC] land with survivor children',
      kind: 'epic',
      status: 'todo',
    });

    const land = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LAND] land me → master',
      parentId: epic.id,
      kind: 'land',
      status: 'todo',
    });

    // Child A: planned unclaimed leaf (survivor)
    const childA = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] child A planned',
      parentId: epic.id,
      kind: 'leaf',
      status: 'planned',
    });

    // Child B: planned with rejection status (survivor, not retirable until rejected-ness is cleared)
    const childB = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] child B rejected',
      parentId: epic.id,
      kind: 'leaf',
      status: 'planned',
    });
    await updateTodo(project, childB.id, { acceptanceStatus: 'rejected' });

    const probe = probeFor(epic.id);

    // Run the termalization — should SKIP because survivors exist
    const result = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    // Verify the epic was NOT terminalized
    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.survivorChildren).toContain(childA.id);
    expect(result.survivorChildren).toContain(childB.id);

    // Verify NO children were dropped
    expect(result.droppedChildren).not.toContain(childA.id);
    expect(result.droppedChildren).not.toContain(childB.id);

    // Verify both children are still in their original state
    const childAReloaded = getTodo(project, childA.id)!;
    const childBReloaded = getTodo(project, childB.id)!;
    expect(childAReloaded.status).toBe('planned');
    expect(childBReloaded.status).toBe('planned');
    expect(childBReloaded.acceptanceStatus).toBe('rejected');

    // Verify epic is NOT done and has NO landedAt
    const epicReloaded = getTodo(project, epic.id)!;
    expect(epicReloaded.status).not.toBe('done');
    expect(epicReloaded.landedAt).toBeNull();

    // Verify no invariant violations
    const allTodos = listTodos(project, { includeCompleted: true });
    const violations = findViolations(allTodos);
    const liveChildViolations = violations.filter(
      (v) => v.kind === 'live-child-under-terminal-epic' && (v.todoId === childA.id || v.todoId === childB.id),
    );
    expect(liveChildViolations).toHaveLength(0);

    // Verify no landed-at-divergence violations
    const divergence = findLandedAtDivergence(allTodos);
    const epicDivergence = divergence.filter((v) => v.todoId === epic.id);
    expect(epicDivergence).toHaveLength(0);
  });

  test('all-terminal children allow epic to terminalize (no survivors block)', async () => {
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
      title: '[EPIC] land with all-terminal children',
      kind: 'epic',
      status: 'todo',
    });

    const land = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LAND] land me → master',
      parentId: epic.id,
      kind: 'land',
      status: 'todo',
    });

    // Child A: terminal leaf (not a survivor since it's done)
    const childA = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] child A done',
      parentId: epic.id,
      kind: 'leaf',
      status: 'done',
    });

    // Child B: another terminal leaf
    const childB = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] child B done',
      parentId: epic.id,
      kind: 'leaf',
      status: 'done',
    });

    const probe = probeFor(epic.id);

    // Run the termalization
    const result = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    // Verify the epic WAS terminalized (no survivors since all children are terminal)
    expect(result.terminalized).toContain(epic.id);
    expect(result.survivorChildren).toHaveLength(0);

    // Verify epic is done, accepted, and has landedAt set
    const epicReloaded = getTodo(project, epic.id)!;
    expect(epicReloaded.status).toBe('done');
    expect(epicReloaded.acceptanceStatus).toBe('accepted');
    expect(epicReloaded.landedAt).toBe(fakeCommitDate);

    // Verify no invariant violations
    const allTodos = listTodos(project, { includeCompleted: true });
    const violations = findViolations(allTodos);
    const liveChildViolations = violations.filter(
      (v) => v.kind === 'live-child-under-terminal-epic',
    );
    expect(liveChildViolations).toHaveLength(0);

    // Verify no landed-at-divergence violations for this epic
    const divergence = findLandedAtDivergence(allTodos);
    const epicDivergence = divergence.filter((v) => v.todoId === epic.id);
    expect(epicDivergence).toHaveLength(0);
  });

  test('an in-flight child still blocks terminalization and the drop cascade', async () => {
    const fakeCommitDate = '2026-08-03T12:34:56Z';
    const landCommit = async (proj: string, id: string, deps?: any): Promise<EpicLandCommit> => ({
      status: 'landed',
      sha: 'abc123',
      committedAtIso: fakeCommitDate,
    });

    // Create epic with a [LAND] leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] with in-flight child',
      kind: 'epic',
      status: 'todo',
    });

    const land = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LAND] land me → master',
      parentId: epic.id,
      kind: 'land',
      status: 'todo',
    });

    // Planned child (will be affected if cascade runs)
    const plannedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] planned child',
      parentId: epic.id,
      kind: 'leaf',
      status: 'planned',
    });

    // In-flight child: create and claim it to simulate a claim
    const inFlightLeaf = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[LEAF] still building',
      parentId: epic.id,
      kind: 'leaf',
      status: 'todo',
    });
    // Mark as approved so it can be claimed
    await updateTodo(project, inFlightLeaf.id, { approvedAt: '2026-08-03T12:00:00Z', approvedBy: 's1' });
    // Claim it to mark it as in-flight
    await claimTodo(project, inFlightLeaf.id, 's1', 30_000);

    const beforeTerminalize = getTodo(project, epic.id)!;
    const beforePlanned = getTodo(project, plannedChild.id)!;
    const beforeInFlight = getTodo(project, inFlightLeaf.id)!;

    const probe = probeFor(epic.id);

    // Run the termalization — should skip because in-flight child exists
    const result = await terminalizeLandedEpics(project, {
      probe,
      landCommit: landCommit as any,
    });

    // Verify the epic was NOT terminalized
    expect(result.terminalized).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // Verify NO children were dropped
    expect(result.droppedChildren).not.toContain(plannedChild.id);
    expect(result.droppedChildren).not.toContain(inFlightLeaf.id);

    // Verify the epic row is completely unchanged
    const epicAfter = getTodo(project, epic.id)!;
    expect(epicAfter.status).toBe(beforeTerminalize.status);
    expect(epicAfter.updatedAt).toBe(beforeTerminalize.updatedAt);
    expect(epicAfter.landedAt).toBe(beforeTerminalize.landedAt);

    // Verify children are unchanged
    const plannedAfter = getTodo(project, plannedChild.id)!;
    const inFlightAfter = getTodo(project, inFlightLeaf.id)!;
    expect(plannedAfter.status).toBe(beforePlanned.status);
    expect(plannedAfter.updatedAt).toBe(beforePlanned.updatedAt);
    expect(inFlightAfter.status).toBe(beforeInFlight.status);
    expect(inFlightAfter.updatedAt).toBe(beforeInFlight.updatedAt);
  });
});
