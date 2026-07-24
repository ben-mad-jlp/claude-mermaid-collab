// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Unit tests for the dep-settlement primitives: settleDupOfLanded + repointDependents.
// Pattern mirrors reserve-leaf.test.ts (temp project dir, _closeProject/_resetAutonomyLog).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { isClaimable } from '../claimability';
import { settleDupOfLanded, repointDependents, DUP_OF_LANDED } from '../dep-settlement';
import { recentAutonomousMutations, _resetAutonomyLog } from '../autonomy-log';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'dep-settlement-'));
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

describe('settleDupOfLanded', () => {
  test('makes a dependent claimable', async () => {
    const epicId = await makeEpic();
    const dep = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const dependent = await createTodo(project, {
      ownerSession: 's1', title: 'depends on dup', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [dep.id],
    });

    const allTodos = [getTodo(project, dep.id)!, getTodo(project, dependent.id)!];
    const byId = new Map(allTodos.map((t) => [t.id, t]));
    expect(isClaimable(byId.get(dependent.id)!, byId)).toBe(false);

    const result = await settleDupOfLanded(project, dep.id, {
      landedCommit: 'abc12345def', landedTodoId: undefined, actor: 'test', reason: 'dup-of-landed-work',
    });
    expect(result.settled).toBe(true);
    expect(result.todoId).toBe(dep.id);

    const settledDep = getTodo(project, dep.id)!;
    expect(settledDep.status).toBe('done');
    expect(settledDep.acceptanceStatus).toBe('accepted');
    expect(settledDep.completedBy?.startsWith(`${DUP_OF_LANDED}:`)).toBe(true);

    const refreshedDependent = getTodo(project, dependent.id)!;
    const byId2 = new Map([settledDep, refreshedDependent].map((t) => [t.id, t]));
    expect(isClaimable(byId2.get(dependent.id)!, byId2)).toBe(true);
  });

  test('is idempotent — a second call is a no-op', async () => {
    const epicId = await makeEpic();
    const dep = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    await settleDupOfLanded(project, dep.id, { landedCommit: 'abc12345', actor: 'test', reason: 'r' });
    const beforeUpdatedAt = getTodo(project, dep.id)!.updatedAt;

    const second = await settleDupOfLanded(project, dep.id, { landedCommit: 'abc12345', actor: 'test', reason: 'r' });
    expect(second).toEqual({ settled: false, todoId: null });
    expect(getTodo(project, dep.id)!.updatedAt).toBe(beforeUpdatedAt);
  });

  test('records a dep-settlement autonomy mutation', async () => {
    const epicId = await makeEpic();
    const dep = await createTodo(project, {
      ownerSession: 's1', title: 'dup leaf', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    await settleDupOfLanded(project, dep.id, { landedCommit: 'abc12345', actor: 'test', reason: 'r' });
    const entries = recentAutonomousMutations({ project });
    expect(entries.some((e) => e.kind === 'dep-settlement')).toBe(true);
  });
});

describe('repointDependents', () => {
  test('handles a short-id edge and rewrites dependsOn', async () => {
    const epicId = await makeEpic();
    const from = await createTodo(project, {
      ownerSession: 's1', title: 'from', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const to = await createTodo(project, {
      ownerSession: 's1', title: 'to', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const dependent = await createTodo(project, {
      ownerSession: 's1', title: 'dependent', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [from.id.slice(0, 8)],
    });

    const result = repointDependents(project, from.id, to.id, { actor: 'test', reason: 'r' });
    expect(result.affected).toEqual([dependent.id]);

    const refreshed = getTodo(project, dependent.id)!;
    expect(refreshed.dependsOn).toContain(to.id);
    expect(refreshed.dependsOn).not.toContain(from.id.slice(0, 8));

    const entries = recentAutonomousMutations({ project });
    expect(entries.some((e) => e.kind === 'dep-settlement')).toBe(true);
  });

  test('is idempotent — a second call has an empty affected set', async () => {
    const epicId = await makeEpic();
    const from = await createTodo(project, {
      ownerSession: 's1', title: 'from', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const to = await createTodo(project, {
      ownerSession: 's1', title: 'to', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    await createTodo(project, {
      ownerSession: 's1', title: 'dependent', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [from.id],
    });

    repointDependents(project, from.id, to.id, { actor: 'test', reason: 'r' });
    const second = repointDependents(project, from.id, to.id, { actor: 'test', reason: 'r' });
    expect(second.affected).toEqual([]);
  });

  test('neither settle nor re-point touches an unrelated todo', async () => {
    const epicId = await makeEpic();
    const other = await createTodo(project, {
      ownerSession: 's1', title: 'other dep', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const from = await createTodo(project, {
      ownerSession: 's1', title: 'from', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const to = await createTodo(project, {
      ownerSession: 's1', title: 'to', parentId: epicId, kind: 'leaf', status: 'ready',
    });
    const unrelated = await createTodo(project, {
      ownerSession: 's1', title: 'unrelated', parentId: epicId, kind: 'leaf', status: 'ready',
      dependsOn: [other.id],
    });

    const before = getTodo(project, unrelated.id)!;

    await settleDupOfLanded(project, from.id, { landedCommit: 'abc12345', actor: 'test', reason: 'r' });
    repointDependents(project, from.id, to.id, { actor: 'test', reason: 'r' });

    const after = getTodo(project, unrelated.id)!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.dependsOn).toEqual(before.dependsOn);
  });
});
