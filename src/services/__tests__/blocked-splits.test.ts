// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, getTodo, splitLeafInto, collapseSplit, updateTodo, listTodos, _closeProject,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findBlockedSplits } from '../claimability';
import type { Todo } from '../todo-store';

let project: string;

function reportState(inflight: number, blocked: boolean, suppressed: number, claimable: number): string {
  return inflight > 0
    ? 'working'
    : blocked
      ? 'blocked-on-decision'
      : suppressed > 0
        ? 'claims-suppressed'
        : claimable > 0 ? 'claimable' : 'idle';
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'blocked-splits-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});
afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('findBlockedSplits (SR-1 — a wedged project must not look finished)', () => {
  test('finished epic with no blocked splits', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] done' });
    const child = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'completed child', status: 'ready',
      parentId: epic.id,
    });

    completeTodo(project, child.id, 'accepted');

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
    expect(reportState(0, blocked.length > 0, 0, 0)).toBe('idle');
  });

  test('split parent with 9 unapproved children reports as blocked', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, [
      'a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts', 'i.ts',
    ]);

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toHaveLength(1);
    const split = blocked[0]!;
    expect(split.parentId).toBe(leaf.id);
    expect(split.children).toBe(9);
    expect(split.unapproved).toBe(9);
    expect(split.unapprovedChildIds.length).toBe(9);
    expect(reportState(0, blocked.length > 0, 0, 0)).toBe('blocked-on-decision');
  });

  test('approving the children clears the blocked signal', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts']);

    // Approve all children
    for (const childId of childIds) {
      await updateTodo(project, childId, { approvedAt: new Date().toISOString(), status: 'ready' });
    }

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });

  test('declined split does not report as blocked', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts']);
    await collapseSplit(project, leaf.id);

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });

  test('an [EPIC] with planned children is NOT a blocked split', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] planning' });
    const child1 = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'child 1', status: 'planned',
      parentId: epic.id,
    });
    const child2 = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'child 2', status: 'planned',
      parentId: epic.id,
    });

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });

  test('a [MISSION] with planned children is NOT a blocked split', async () => {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] m1' });
    const child1 = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'mission child 1', status: 'planned',
      parentId: mission.id,
    });
    const child2 = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'mission child 2', status: 'planned',
      parentId: mission.id,
    });

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });

  test('partial approval: some children approved clears the signal, some unapproved does not', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts', 'c.ts']);

    // Approve only 2 of 3
    await updateTodo(project, childIds[0]!, { approvedAt: new Date().toISOString(), status: 'ready' });
    await updateTodo(project, childIds[1]!, { approvedAt: new Date().toISOString(), status: 'ready' });

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toHaveLength(1);
    const split = blocked[0]!;
    expect(split.unapproved).toBe(1);
    expect(split.unapprovedChildIds).toEqual([childIds[2]!]);
  });

  test('dropped children are not counted as open', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts', 'c.ts']);

    // Drop one, approve two
    await updateTodo(project, childIds[0]!, { status: 'dropped' });
    await updateTodo(project, childIds[1]!, { approvedAt: new Date().toISOString(), status: 'ready' });
    await updateTodo(project, childIds[2]!, { approvedAt: new Date().toISOString(), status: 'ready' });

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });

  test('terminal parent (done/accepted) is not reported', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'split parent', status: 'ready',
      parentId: epic.id,
    });
    await updateTodo(project, leaf.id, { approvedAt: new Date().toISOString() });

    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts']);

    // Mark parent as done+accepted
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });

    const todos = listTodos(project, { includeCompleted: true });
    const blocked = findBlockedSplits(todos);

    expect(blocked).toEqual([]);
  });
});

// Helper: synchronous completeTodo for testing (wrapper)
function completeTodo(project: string, todoId: string, acceptance: 'accepted' | 'rejected'): void {
  const { updateTodo } = require('../todo-store');
  updateTodo(project, todoId, { status: 'done', acceptanceStatus: acceptance, completed: true });
}
