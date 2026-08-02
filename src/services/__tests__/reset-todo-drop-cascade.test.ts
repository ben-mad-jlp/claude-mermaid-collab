/**
 * Tests for resetTodo drop cascade routing through cascadeDropDescendants.
 * Covers both direct resetTodo calls and MCP handleEpicTool entry point.
 */
import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-reset-cascade-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, resetTodo, getTodo, listTodos, _closeProject, type Todo } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findViolations } from '../invariant-check';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('reset-todo-drop-cascade — resetTodo routes through cascadeDropDescendants', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'reset-cascade-test-'));
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function assertNoLiveDescendants(rootId: string): void {
    const all = listTodos(project, { includeCompleted: true });
    const violations = findViolations(all);
    expect(violations).toEqual([]);
    const byId = new Map(all.map((t) => [t.id, t]));
    function isDescendantOf(t: Todo, ancestorId: string): boolean {
      let cur: Todo | undefined = t;
      while (cur?.parentId) {
        if (cur.parentId === ancestorId) return true;
        cur = byId.get(cur.parentId);
      }
      return false;
    }
    const liveDescendants = all.filter(
      (t) => isDescendantOf(t, rootId) && t.status !== 'done' && t.status !== 'dropped',
    );
    expect(liveDescendants).toEqual([]);
  }

  test('resetTodo drop cascades all descendants with zero invariant violations', async () => {
    // Create an epic with a planned child, a ready child, and a grandchild
    const epic = await createTodo(project, {
      allowOrphan: true,
      title: 'epic for reset',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });

    const plannedChild = await createTodo(project, {
      title: 'planned child',
      ownerSession: 'test',
      status: 'planned',
      parentId: epic.id,
    });

    const readyChild = await createTodo(project, {
      title: 'ready child',
      ownerSession: 'test',
      status: 'ready',
      parentId: epic.id,
    });

    const grandchild = await createTodo(project, {
      title: 'grandchild',
      ownerSession: 'test',
      status: 'planned',
      parentId: readyChild.id,
    });

    // Reset the epic to 'dropped' status
    await resetTodo(project, epic.id, 'dropped');

    // Verify all descendants are dropped
    const updatedPlannedChild = getTodo(project, plannedChild.id);
    const updatedReadyChild = getTodo(project, readyChild.id);
    const updatedGrandchild = getTodo(project, grandchild.id);

    expect(updatedPlannedChild?.status).toBe('dropped');
    expect(updatedReadyChild?.status).toBe('dropped');
    expect(updatedGrandchild?.status).toBe('dropped');

    // Verify no invariant violations
    assertNoLiveDescendants(epic.id);

    // Verify the epic itself is dropped
    const updatedEpic = getTodo(project, epic.id);
    expect(updatedEpic?.status).toBe('dropped');
  });

  test('handleEpicTool reset_todo drop cascades all descendants with zero invariant violations', async () => {
    const { handleEpicTool } = await import('../../mcp/epic-tools');

    // Create an epic with a planned child, a ready child, and a grandchild
    const epic = await createTodo(project, {
      allowOrphan: true,
      title: 'epic for mcp reset',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });

    const plannedChild = await createTodo(project, {
      title: 'planned child',
      ownerSession: 'test',
      status: 'planned',
      parentId: epic.id,
    });

    const readyChild = await createTodo(project, {
      title: 'ready child',
      ownerSession: 'test',
      status: 'ready',
      parentId: epic.id,
    });

    const grandchild = await createTodo(project, {
      title: 'grandchild',
      ownerSession: 'test',
      status: 'planned',
      parentId: readyChild.id,
    });

    // Reset the epic to 'dropped' status via MCP
    await handleEpicTool('reset_todo', { project, todoId: epic.id, status: 'dropped' });

    // Verify all descendants are dropped
    const updatedPlannedChild = getTodo(project, plannedChild.id);
    const updatedReadyChild = getTodo(project, readyChild.id);
    const updatedGrandchild = getTodo(project, grandchild.id);

    expect(updatedPlannedChild?.status).toBe('dropped');
    expect(updatedReadyChild?.status).toBe('dropped');
    expect(updatedGrandchild?.status).toBe('dropped');

    // Verify no invariant violations
    assertNoLiveDescendants(epic.id);

    // Verify the epic itself is dropped
    const updatedEpic = getTodo(project, epic.id);
    expect(updatedEpic?.status).toBe('dropped');
  });
});
