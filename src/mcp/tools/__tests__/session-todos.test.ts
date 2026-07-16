// Runs via `bun test` (bun:sqlite). Tier plumbing tests for add_session_todo and update_session_todo handlers.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionTodoToolDefs } from '../session-todos';
import { getTodo, _closeProject } from '../../../services/todo-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'session-todos-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('tier plumbing', () => {
  test('create pins tier to test-pinned', async () => {
    // Create an epic first (tier is only for leaves)
    const addToolDef = sessionTodoToolDefs.find((t) => t.name === 'add_session_todo')!;
    const epicResult = await addToolDef.handler(
      {
        project,
        session: 's1',
        text: 'Test Epic',
        kind: 'epic',
      },
      { broadcast() {} },
    );
    const epic = JSON.parse(epicResult);

    // Create a leaf with tier:'test-pinned'
    const leafResult = await addToolDef.handler(
      {
        project,
        session: 's1',
        text: 'Test Leaf',
        kind: 'leaf',
        parentId: epic.id,
        tier: 'test-pinned',
      },
      { broadcast() {} },
    );
    const leaf = JSON.parse(leafResult);

    // Verify the tier is persisted
    const stored = getTodo(project, leaf.id);
    expect(stored?.tier).toBe('test-pinned');
  });

  test('approve pins tier to small', async () => {
    // Create an epic
    const addToolDef = sessionTodoToolDefs.find((t) => t.name === 'add_session_todo')!;
    const epicResult = await addToolDef.handler(
      {
        project,
        session: 's1',
        text: 'Test Epic',
        kind: 'epic',
      },
      { broadcast() {} },
    );
    const epic = JSON.parse(epicResult);

    // Create a leaf
    const leafResult = await addToolDef.handler(
      {
        project,
        session: 's1',
        text: 'Test Leaf',
        kind: 'leaf',
        parentId: epic.id,
      },
      { broadcast() {} },
    );
    const leaf = JSON.parse(leafResult);

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
