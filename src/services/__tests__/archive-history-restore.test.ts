// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, getTodo, listTodos, archiveTodosByIds, listArchivedTodos, restoreTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, listMissions, archiveMissionsByTodoIds, listArchivedMissions,
  restoreMission, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'archive-history-restore-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('archive/history/restore round-trip', () => {
  test('todo: archive -> history -> restore is lossless', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] archivable epic', kind: 'epic' });
    const before = getTodo(project, t.id)!;
    expect(before.archivedAt).toBeFalsy();

    archiveTodosByIds(project, [t.id], Date.now());

    // absent from the hot list
    const hot = listTodos(project);
    expect(hot.find((x) => x.id === t.id)).toBeUndefined();

    // present in history, field-by-field equal except archivedAt
    const page = listArchivedTodos(project);
    const archived = page.items.find((x) => x.id === t.id)!;
    expect(archived).toBeDefined();
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.updatedAt).toBe(before.updatedAt);
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key === 'archivedAt') continue;
      expect(archived[key]).toEqual(before[key]);
    }

    // restore
    const restored = restoreTodo(project, t.id);
    expect(restored.archivedAt).toBeFalsy();

    const hotAgain = listTodos(project);
    expect(hotAgain.find((x) => x.id === t.id)).toBeDefined();
    const pageAfter = listArchivedTodos(project);
    expect(pageAfter.items.find((x) => x.id === t.id)).toBeUndefined();
  });

  test('mission: archive -> history -> restore is lossless', async () => {
    const m = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] archivable mission', kind: 'mission' });
    upsertMission(project, m.id);
    const before = getMission(project, m.id)!;
    expect(before.archivedAt).toBeFalsy();

    archiveMissionsByTodoIds(project, [m.id], Date.now());

    // absent from the hot list
    const hot = listMissions(project);
    expect(hot.find((x) => x.mission.todoId === m.id)).toBeUndefined();

    // present in history, field-by-field equal except archivedAt
    const page = listArchivedMissions(project);
    const archived = page.items.find((x) => x.todoId === m.id)!;
    expect(archived).toBeDefined();
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.updatedAt).toBe(before.updatedAt);
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key === 'archivedAt' || key === 'status') continue;
      expect(archived[key]).toEqual(before[key]);
    }

    // restore
    const restored = restoreMission(project, m.id);
    expect(restored.archivedAt).toBeFalsy();

    const hotAgain = listMissions(project);
    expect(hotAgain.find((x) => x.mission.todoId === m.id)).toBeDefined();
    const pageAfter = listArchivedMissions(project);
    expect(pageAfter.items.find((x) => x.todoId === m.id)).toBeUndefined();
  });
});
