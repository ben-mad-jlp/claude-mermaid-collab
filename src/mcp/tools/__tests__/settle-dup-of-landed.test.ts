// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Handler-level tests for settle_dup_of_landed: settles a dup-of-landed leaf and,
// with repoint:true, moves its dependents onto the landed leaf.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, _closeProject } from '../../../services/todo-store';
import { isClaimable } from '../../../services/claimability';
import { _resetAutonomyLog } from '../../../services/autonomy-log';
import { settleDupOfLandedHandler } from '../settle-dup-of-landed';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'settle-dup-of-landed-mcp-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _resetAutonomyLog();
});
afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function makeEpic(): Promise<string> {
  const epic = await createTodo(project, {
    ownerSession: 's1', title: '[EPIC] host', kind: 'epic', missionId: null,
  });
  return epic.id;
}

describe('settle_dup_of_landed handler', () => {
  test('settle frees a deps-pending dependent', async () => {
    const epicId = await makeEpic();
    const dup = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const dependent = await createTodo(project, {
      ownerSession: 's1', title: 'depends on dup', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [dup.id],
    });

    const byId = new Map([getTodo(project, dup.id)!, getTodo(project, dependent.id)!].map((t) => [t.id, t]));
    expect(isClaimable(byId.get(dependent.id)!, byId)).toBe(false);

    const resultJson = await settleDupOfLandedHandler({ project, todoId: dup.id, landedCommit: 'abc12345def' });
    const result = JSON.parse(resultJson);
    expect(result.settled).toBe(dup.id);

    const byId2 = new Map([getTodo(project, dup.id)!, getTodo(project, dependent.id)!].map((t) => [t.id, t]));
    expect(isClaimable(byId2.get(dependent.id)!, byId2)).toBe(true);
  });

  test('repoint:true moves the edge onto landedTodoId', async () => {
    const epicId = await makeEpic();
    const dup = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const landed = await createTodo(project, {
      ownerSession: 's1', title: 'landed leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const dependent = await createTodo(project, {
      ownerSession: 's1', title: 'depends on dup', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [dup.id],
    });

    const resultJson = await settleDupOfLandedHandler({
      project, todoId: dup.id, landedCommit: 'abc12345def', landedTodoId: landed.id, repoint: true,
    });
    const result = JSON.parse(resultJson);
    expect(result.dependents).toContain(dependent.id);

    const refreshed = getTodo(project, dependent.id)!;
    expect(refreshed.dependsOn).toContain(landed.id);
    expect(refreshed.dependsOn).not.toContain(dup.id);
  });

  test('missing landedCommit throws', async () => {
    const epicId = await makeEpic();
    const dup = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    await expect(settleDupOfLandedHandler({ project, todoId: dup.id })).rejects.toThrow();
  });
});
