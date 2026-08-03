import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  updateTodo,
  _closeProject,
} from '../todo-store';
import { snapshotEpicSubtree, restoreEpicSubtree } from '../redecompose-rollback';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'redecompose-rollback-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});

afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('redecompose-rollback', () => {
  test('restoreEpicSubtree restores held reason and acceptance status through the drop cascade', async () => {
    // Create an epic with leaves.
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[EPIC] base repair',
      kind: 'epic',
    });

    const leaf1 = await createTodo(project, {
      ownerSession: 's',
      title: 'leaf 1',
      parentId: epic.id,
    });

    const leaf2 = await createTodo(project, {
      ownerSession: 's',
      title: 'leaf 2',
      parentId: epic.id,
    });

    const leaf3 = await createTodo(project, {
      ownerSession: 's',
      title: 'leaf 3',
      parentId: epic.id,
    });

    const leaf4 = await createTodo(project, {
      ownerSession: 's',
      title: 'leaf 4',
      parentId: epic.id,
    });

    // Patch leaves with heldAt/heldReason: 'epic-base-red: bun test'
    // Must use two calls: first set status (which translates to heldReason: 'manual'),
    // then override heldReason in a separate call without status present.
    await updateTodo(project, leaf1.id, { status: 'blocked' });
    await updateTodo(project, leaf1.id, { heldReason: 'epic-base-red: bun test' });

    await updateTodo(project, leaf2.id, { status: 'blocked' });
    await updateTodo(project, leaf2.id, { heldReason: 'epic-base-red: bun test' });

    await updateTodo(project, leaf3.id, { status: 'blocked' });
    await updateTodo(project, leaf3.id, { heldReason: 'epic-base-red: bun test' });

    // Patch leaf4: block it, set custom held reason, then set rejection
    await updateTodo(project, leaf4.id, { status: 'blocked' });
    await updateTodo(project, leaf4.id, { heldReason: 'epic-base-red: bun test' });
    await updateTodo(project, leaf4.id, { acceptanceStatus: 'rejected' });

    // Verify pre-drop state: all leaves are held with correct reason and leaf4 is rejected.
    let l1 = getTodo(project, leaf1.id)!;
    let l4 = getTodo(project, leaf4.id)!;
    expect(l1.heldReason).toBe('epic-base-red: bun test');
    expect(l4.heldReason).toBe('epic-base-red: bun test');
    expect(l4.acceptanceStatus).toBe('rejected');

    // Snapshot BEFORE drop.
    let allTodos = [
      epic,
      leaf1,
      leaf2,
      leaf3,
      leaf4,
      ...(await Promise.all([
        getTodo(project, epic.id),
        getTodo(project, leaf1.id),
        getTodo(project, leaf2.id),
        getTodo(project, leaf3.id),
        getTodo(project, leaf4.id),
      ])),
    ].filter(Boolean) as any[];

    // Re-fetch to get current state
    const currentTodos = [
      getTodo(project, epic.id),
      getTodo(project, leaf1.id),
      getTodo(project, leaf2.id),
      getTodo(project, leaf3.id),
      getTodo(project, leaf4.id),
    ].filter(Boolean) as any[];

    const snapshot = snapshotEpicSubtree(currentTodos, epic.id);

    // Verify snapshot captured the held reasons.
    expect(snapshot.rows.length).toBe(5); // epic + 4 leaves
    expect(snapshot.rows[0]!.id).toBe(epic.id); // epic is first
    expect(snapshot.rows[1]!.heldReason).toBe('epic-base-red: bun test');
    expect(snapshot.rows[4]!.acceptanceStatus).toBe('rejected');

    // Drop the epic, which cascades and clears heldAt/heldReason/acceptanceStatus.
    await updateTodo(project, epic.id, { status: 'dropped' });

    // Verify cascade happened: all are now dropped with no held reason.
    let epicAfterDrop = getTodo(project, epic.id)!;
    let l1AfterDrop = getTodo(project, leaf1.id)!;
    let l4AfterDrop = getTodo(project, leaf4.id)!;

    expect(epicAfterDrop.status).toBe('dropped');
    expect(l1AfterDrop.status).toBe('dropped');
    expect(l1AfterDrop.heldReason).toBeNull();
    expect(l4AfterDrop.heldReason).toBeNull();
    expect(l4AfterDrop.acceptanceStatus).toBeNull();

    // Restore the epic subtree.
    const result = await restoreEpicSubtree(project, snapshot);

    // Verify restore succeeded.
    expect(result.restored.length).toBe(5);
    expect(result.failed.length).toBe(0);

    // Verify all are restored: non-terminal again, held reasons back.
    const restoredEpic = getTodo(project, epic.id)!;
    const restoredL1 = getTodo(project, leaf1.id)!;
    const restoredL2 = getTodo(project, leaf2.id)!;
    const restoredL3 = getTodo(project, leaf3.id)!;
    const restoredL4 = getTodo(project, leaf4.id)!;

    // All should be non-terminal (restored to their snapshot status, which was 'blocked'→'ready' by statusForRestore).
    expect(restoredEpic.status).not.toBe('dropped');
    expect(restoredL1.status).not.toBe('dropped');
    expect(restoredL2.status).not.toBe('dropped');
    expect(restoredL3.status).not.toBe('dropped');
    expect(restoredL4.status).not.toBe('dropped');

    // All leaves should have their held reason restored.
    expect(restoredL1.heldReason).toBe('epic-base-red: bun test');
    expect(restoredL2.heldReason).toBe('epic-base-red: bun test');
    expect(restoredL3.heldReason).toBe('epic-base-red: bun test');
    expect(restoredL4.heldReason).toBe('epic-base-red: bun test');

    // Leaf4's rejection should be restored.
    expect(restoredL4.acceptanceStatus).toBe('rejected');
  });
});
