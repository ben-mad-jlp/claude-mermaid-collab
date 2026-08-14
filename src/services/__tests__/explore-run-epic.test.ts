// Tests for ensureExploreRunEpic: idempotence, non-bucket status, terminal handling.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureExploreRunEpic, EXPLORE_RUN_EPIC_TITLE } from '../explore-run-epic';
import { getTodo, updateTodo, listTodos, _closeProject } from '../todo-store';
import { isBucketEpic } from '../bucket-registry';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'explore-run-epic-'));
  mkdirSync(join(project, '.collab'), { recursive: true });
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('ensureExploreRunEpic', () => {
  test('ensureExploreRunEpic is idempotent and returns a non-bucket approved root epic', async () => {
    // First call creates the epic
    const id1 = await ensureExploreRunEpic(project);
    expect(id1).toBeTruthy();

    const epic1 = getTodo(project, id1)!;
    expect(epic1).toBeTruthy();
    expect(epic1.title).toMatch(/Explore runs/i);
    expect(epic1.kind).toBe('epic');
    expect(epic1.parentId).toBeNull(); // Root epic
    expect(epic1.approvedAt).toBeTruthy(); // Approved
    expect(epic1.bucketType).toBeNull(); // Not a bucket
    expect(isBucketEpic(epic1)).toBe(false); // isBucketEpic returns false
    expect(epic1.status).toBe('planned'); // Status stored as 'planned' (derived 'ready')

    // Second call returns the same id (idempotent)
    const id2 = await ensureExploreRunEpic(project);
    expect(id2).toBe(id1);

    const epic2 = getTodo(project, id2)!;
    expect(epic2.id).toBe(epic1.id);
    expect(epic2.approvedAt).toBeTruthy();
  });

  test('a terminal prior generation yields a different live epic id', async () => {
    // Create the first epic
    const id1 = await ensureExploreRunEpic(project);
    const epic1 = getTodo(project, id1)!;
    expect(epic1.status).not.toBe('done');
    expect(epic1.status).not.toBe('dropped');

    // Mark it as dropped (terminal)
    await updateTodo(project, id1, { status: 'dropped' });
    const droppedEpic = getTodo(project, id1)!;
    expect(droppedEpic.status).toBe('dropped');

    // Calling ensureExploreRunEpic again should create a NEW epic (not revive the old one)
    const id2 = await ensureExploreRunEpic(project);
    expect(id2).not.toBe(id1);

    const epic2 = getTodo(project, id2)!;
    expect(epic2.status).toBe('planned');
    expect(epic2.approvedAt).toBeTruthy();
    expect(epic2.bucketType).toBeNull();
    expect(isBucketEpic(epic2)).toBe(false);
  });
});
