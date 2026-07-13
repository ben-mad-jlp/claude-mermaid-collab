import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { createTodo, listTodos, getTodo, _closeProject, OrphanTodoError, DuplicateBucketError } from '../todo-store';
import { stripLabel } from '../todo-kind';

describe('todo-root-integrity (crit_42812662_14)', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'todo-root-integrity-'));
    await fs.mkdir(join(tmpDir, '.collab'), { recursive: true });
  });

  afterAll(() => {
    _closeProject(tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parentless non-mission work todo is rejected (OrphanTodoError)', async () => {
    let errorThrown: any = null;
    try {
      await createTodo(tmpDir, {
        ownerSession: 's1',
        title: 'orphan leaf',
      });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown).toBeInstanceOf(OrphanTodoError);
    expect(errorThrown.code).toBe('orphan-todo');

    // Verify nothing was inserted
    const allTodos = listTodos(tmpDir, { includeCompleted: true });
    expect(allTodos.length).toBe(0);
  });

  test('a parentless mission is allowed as a root', async () => {
    const m = await createTodo(tmpDir, {
      ownerSession: 's1',
      title: 'converge X',
      kind: 'mission',
    });

    expect(m.parentId).toBeNull();
    expect(m.kind).toBe('mission');
  });

  test('inbox:true auto-homes a parentless leaf under the singleton Inbox epic', async () => {
    const leaf = await createTodo(tmpDir, {
      ownerSession: 's1',
      title: 'stray thought',
      inbox: true,
    });

    expect(leaf.parentId).toBeTruthy();

    const parent = getTodo(tmpDir, leaf.parentId!);
    expect(parent).toBeDefined();
    expect(parent!.kind).toBe('epic');
    expect(parent!.isBucket).toBe(true);
    expect(stripLabel(parent!.title).toLowerCase()).toBe('inbox');
  });

  test('second Bugfix inbox bucket create reuses the existing id (no duplicate row)', async () => {
    const first = await createTodo(tmpDir, {
      ownerSession: 's1',
      title: 'Bugfix inbox',
      kind: 'epic',
    });

    expect(first.parentId).toBeNull();
    expect(first.isBucket).toBe(true);

    let errorThrown: any = null;
    try {
      await createTodo(tmpDir, {
        ownerSession: 's1',
        title: 'Bugfix inbox',
        kind: 'epic',
      });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown).toBeInstanceOf(DuplicateBucketError);
    expect(errorThrown.code).toBe('duplicate-bucket');

    // Assert exactly one non-dropped Bugfix bucket survives
    const bugfixBuckets = listTodos(tmpDir, { includeCompleted: true }).filter(
      (t) => t.isBucket && t.status !== 'dropped' && t.title.toLowerCase().includes('bugfix'),
    );
    expect(bugfixBuckets.length).toBe(1);
    expect(bugfixBuckets[0]!.id).toBe(first.id);
  });
});
