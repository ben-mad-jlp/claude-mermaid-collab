// Runs via `bun test` (bun:sqlite). Round-trip test for baseRepair on update_session_todo.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionTodoToolDefs } from '../session-todos';
import { getTodo, createTodo, _closeProject } from '../../../services/todo-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'session-todos-baserepair-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('baseRepair plumbing on update_session_todo', () => {
  test('baseRepair round-trips true, false, and omitted-carries-through', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Test Epic', kind: 'epic' });

    const updateToolDef = sessionTodoToolDefs.find((t) => t.name === 'update_session_todo')!;

    const setTrue = await updateToolDef.handler(
      { project, session: 's1', id: epic.id, baseRepair: true },
      { broadcast() {} },
    );
    const setTrueResult = JSON.parse(setTrue);
    expect(setTrueResult.baseRepair).toBe(1);
    expect(getTodo(project, epic.id)?.baseRepair).toBe(1);

    const setFalse = await updateToolDef.handler(
      { project, session: 's1', id: epic.id, baseRepair: false },
      { broadcast() {} },
    );
    const setFalseResult = JSON.parse(setFalse);
    expect(setFalseResult.baseRepair).toBe(0);
    expect(getTodo(project, epic.id)?.baseRepair).toBe(0);

    const omitted = await updateToolDef.handler(
      { project, session: 's1', id: epic.id, description: 'x' },
      { broadcast() {} },
    );
    const omittedResult = JSON.parse(omitted);
    expect(omittedResult.baseRepair).toBe(0);
    expect(getTodo(project, epic.id)?.baseRepair).toBe(0);
  });
});
