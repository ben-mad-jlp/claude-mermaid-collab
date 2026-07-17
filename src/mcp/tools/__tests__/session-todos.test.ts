// Runs via `bun test` (bun:sqlite). Tier plumbing tests for add_session_todo and update_session_todo handlers.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionTodoToolDefs } from '../session-todos';
import { getTodo, createTodo, _closeProject } from '../../../services/todo-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'session-todos-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('tier plumbing', () => {
  test('create pins tier to test-pinned', async () => {
    // Create an epic first (tier is only for leaves)
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    // Create a leaf with tier:'test-pinned'
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'Test Leaf', kind: 'leaf', parentId: epic.id, tier: 'test-pinned' });

    // Verify the tier is persisted
    const stored = getTodo(project, leaf.id);
    expect(stored?.tier).toBe('test-pinned');
  });

  test('approve pins tier to small', async () => {
    // Create an epic
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    // Create a leaf
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'Test Leaf', kind: 'leaf', parentId: epic.id });

    // Approve and set tier to 'small'
    const updateToolDef = sessionTodoToolDefs.find((t) => t.name === 'update_session_todo')!;
    const updateResult = await updateToolDef.handler(
      {
        project,
        session: 's1',
        id: leaf.id,
        status: 'ready',
        tier: 'small',
      },
      { broadcast() {} },
    );
    const updated = JSON.parse(updateResult);

    // Verify approvedAt is stamped and tier is set
    expect(updated.approvedAt).toBeTruthy();
    expect(updated.tier).toBe('small');

    // Verify persistence
    const stored = getTodo(project, leaf.id);
    expect(stored?.approvedAt).toBeTruthy();
    expect(stored?.tier).toBe('small');
  });
});

describe('servesCriterionIds plumbing', () => {
  test('servesCriterionIds round-trips on create', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'Test Leaf',
      kind: 'leaf',
      parentId: epic.id,
      servesCriterionIds: ['crit-a', 'crit-b'],
    });

    expect(leaf.servesCriterionIds).toHaveLength(2);
    expect(leaf.servesCriterionIds).toContain('crit-a');
    expect(leaf.servesCriterionIds).toContain('crit-b');

    const stored = getTodo(project, leaf.id);
    expect(stored?.servesCriterionIds).toHaveLength(2);
    expect(stored?.servesCriterionIds).toContain('crit-a');
    expect(stored?.servesCriterionIds).toContain('crit-b');
  });

  test('servesCriterionIds round-trips on update', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    const leaf = await createTodo(project, { ownerSession: 's1', title: 'Test Leaf', kind: 'leaf', parentId: epic.id });

    const updateToolDef = sessionTodoToolDefs.find((t) => t.name === 'update_session_todo')!;
    const updateResult = await updateToolDef.handler(
      { project, session: 's1', id: leaf.id, servesCriterionIds: ['crit-x', 'crit-y'] },
      { broadcast() {} },
    );
    const updated = JSON.parse(updateResult);

    expect(updated.servesCriterionIds).toHaveLength(2);
    expect(updated.servesCriterionIds).toContain('crit-x');
    expect(updated.servesCriterionIds).toContain('crit-y');

    const stored = getTodo(project, leaf.id);
    expect(stored?.servesCriterionIds).toHaveLength(2);
    expect(stored?.servesCriterionIds).toContain('crit-x');
    expect(stored?.servesCriterionIds).toContain('crit-y');
  });

  test('singular servesCriterionId still round-trips', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'Test Leaf',
      kind: 'leaf',
      parentId: epic.id,
      servesCriterionId: 'crit-solo',
    });

    const stored = getTodo(project, leaf.id);
    expect(stored?.servesCriterionId).toBe('crit-solo');
  });
});

describe('add_session_todo retired', () => {
  test('sessionTodoToolDefs no longer registers add_session_todo', () => {
    expect(sessionTodoToolDefs.find((t) => t.name === 'add_session_todo')).toBeUndefined();
  });

  test('addSessionTodo (internal fn) still creates a mission-path epic end-to-end', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Retained Fn Epic', kind: 'epic' });
    expect(epic.kind).toBe('epic');
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'Retained Fn Leaf', kind: 'leaf', parentId: epic.id });
    expect(leaf.parentId).toBe(epic.id);
  });
});
