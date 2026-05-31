// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createItem, linkTodo, _closeProject as closeRoadmap } from '../roadmap-store';
import { createTodo, getTodo, listTodos, _closeProject as closeTodo } from '../todo-store';
import { migrateRoadmapToTodos, ROADMAP_OWNER } from '../roadmap-migration';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'roadmap-migration-'));
});
afterEach(() => {
  closeRoadmap(project);
  closeTodo(project);
  rmSync(project, { recursive: true, force: true });
});

describe('roadmap-migration', () => {
  test('migrates items to todos with matching ids and mapped fields', async () => {
    const item = await createItem(project, { title: 'Feature A', description: 'desc A' });
    const item2 = await createItem(project, { title: 'Feature B', status: 'done' } as any);
    // Update status via updateItem to 'done'
    const { updateItem } = await import('../roadmap-store');
    await updateItem(project, item2.id, { status: 'done' });

    const result = await migrateRoadmapToTodos(project);
    expect(result.skipped).toBe(false);
    expect(result.migrated).toBe(2);

    const todoA = getTodo(project, item.id);
    expect(todoA).not.toBeNull();
    expect(todoA!.id).toBe(item.id);
    expect(todoA!.title).toBe('Feature A');
    expect(todoA!.description).toBe('desc A');
    expect(todoA!.ownerSession).toBe(ROADMAP_OWNER);
    expect(todoA!.status).toBe('planned');

    const todoB = getTodo(project, item2.id);
    expect(todoB!.status).toBe('done');
  });

  test('idempotent — second run returns skipped:true, no duplicates', async () => {
    await createItem(project, { title: 'Item 1' });

    const first = await migrateRoadmapToTodos(project);
    expect(first.skipped).toBe(false);
    expect(first.migrated).toBe(1);

    const second = await migrateRoadmapToTodos(project);
    expect(second.skipped).toBe(true);
    expect(second.migrated).toBe(0);

    const todos = listTodos(project, { ownerSession: ROADMAP_OWNER, includeCompleted: true });
    // 1 item + sentinel = 2
    expect(todos.filter((t) => t.title === 'Item 1').length).toBe(1);
  });

  test('join — linked todo gets parentId backfilled to item.id', async () => {
    const item = await createItem(project, { title: 'Sprint 1' });
    const todo = await createTodo(project, { ownerSession: 's1', title: 'task-1' });
    await linkTodo(project, item.id, todo.id);

    await migrateRoadmapToTodos(project);

    const after = getTodo(project, todo.id);
    expect(after!.parentId).toBe(item.id);
  });

  test('absent roadmap.db returns skipped:true and does not create roadmap.db', async () => {
    const result = await migrateRoadmapToTodos(project);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(true);
    expect(existsSync(join(project, '.collab', 'roadmap.db'))).toBe(false);
  });

  test('dependsOn refs preserved across items', async () => {
    const itemA = await createItem(project, { title: 'A' });
    const itemB = await createItem(project, { title: 'B', dependsOn: [itemA.id] });

    await migrateRoadmapToTodos(project);

    const todoB = getTodo(project, itemB.id);
    expect(todoB!.dependsOn).toEqual([itemA.id]);
  });
});
