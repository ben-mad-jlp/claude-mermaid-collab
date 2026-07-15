import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  updateTodo,
  promoteBucketItemToEpic,
  sweepTerminalBucketChildren,
  BucketDepthViolationError,
  _closeProject,
  openDb,
} from '../todo-store';
import { ensureBucket } from '../bucket-registry';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'bucket-depth-'));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  return dir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    rmSync(p, { recursive: true, force: true });
  }
});

describe('bucket-depth-invariant', () => {
  test('epic created under a bucket epic throws BucketDepthViolationError', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    let threw = false;
    try {
      await createTodo(p, { ownerSession: 'test', kind: 'epic', title: 'Test Epic', parentId: bucket });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(BucketDepthViolationError);
      expect((e as BucketDepthViolationError).code).toBe('bucket-depth-violation');
    }
    expect(threw).toBe(true);
  });

  test('mission created under a bucket epic throws BucketDepthViolationError', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'bugfix');
    let threw = false;
    try {
      await createTodo(p, { ownerSession: 'test', kind: 'mission', title: 'Test Mission', parentId: bucket });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(BucketDepthViolationError);
    }
    expect(threw).toBe(true);
  });

  test('grandchild (child of bucket child) throws BucketDepthViolationError', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const child = await createTodo(p, { ownerSession: 'test', title: 'Bucket item', parentId: bucket });

    let threw = false;
    try {
      await createTodo(p, { ownerSession: 'test', title: 'Grandchild', parentId: child.id });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(BucketDepthViolationError);
    }
    expect(threw).toBe(true);
  });

  test('re-parenting a node-with-children into a bucket throws BucketDepthViolationError', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const parent = await createTodo(p, { ownerSession: 'test', kind: 'epic', title: 'Parent Epic' });
    const child = await createTodo(p, { ownerSession: 'test', title: 'Child', parentId: parent.id });

    let threw = false;
    try {
      await updateTodo(p, parent.id, { parentId: bucket });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(BucketDepthViolationError);
    }
    expect(threw).toBe(true);
  });

  test('promoteBucketItemToEpic creates epic and marks item done with promotedTo', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const item = await createTodo(p, { ownerSession: 'test', title: 'Triage item', parentId: bucket });
    expect(item.kind).toBe('leaf');
    expect(item.status).toBe('todo');
    expect(item.promotedTo).toBeNull();

    const { epic, item: updated } = await promoteBucketItemToEpic(p, item.id, { title: 'Promoted to Epic' });

    expect(epic.kind).toBe('epic');
    expect(epic.title).toBe('Promoted to Epic');
    expect(updated.status).toBe('done');
    expect(updated.promotedTo).toBe(epic.id);
    expect(updated.kind).toBe('leaf');  // kind unchanged
  });

  test('promoteBucketItemToEpic preserves item description when title omitted', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const item = await createTodo(p, {
      ownerSession: 'test',
      title: 'Original title',
      description: 'Original description',
      parentId: bucket
    });

    const { epic } = await promoteBucketItemToEpic(p, item.id);

    expect(epic.title).toBe('Original title');
    expect(epic.description).toBe('Original description');
  });

  test('promoteBucketItemToEpic with explicit missionId roots the epic', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const item = await createTodo(p, { ownerSession: 'test', title: 'Item', parentId: bucket });

    const { epic } = await promoteBucketItemToEpic(p, item.id, { missionId: null });

    expect(epic.parentId).toBeNull();
  });

  test('sweepTerminalBucketChildren archives done children older than 7 days', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const oldItem = await createTodo(p, { ownerSession: 'test', title: 'Old item', parentId: bucket, status: 'done' });
    const freshItem = await createTodo(p, { ownerSession: 'test', title: 'Fresh item', parentId: bucket, status: 'done' });

    // Set oldItem's updatedAt to 8 days ago
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const db = openDb(p);
    db.prepare('UPDATE todos SET updatedAt = ? WHERE id = ?').run(cutoff, oldItem.id);

    const archived = await sweepTerminalBucketChildren(p);

    expect(archived).toContain(oldItem.id);
    expect(archived).not.toContain(freshItem.id);

    const oldAfter = getTodo(p, oldItem.id);
    const freshAfter = getTodo(p, freshItem.id);
    expect(oldAfter!.status).toBe('dropped');
    expect(freshAfter!.status).toBe('done');
  });

  test('sweepTerminalBucketChildren does not archive non-done children', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const todo = await createTodo(p, { ownerSession: 'test', title: 'Todo item', parentId: bucket, status: 'todo' });

    // Set updatedAt to 8 days ago
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const db = openDb(p);
    db.prepare('UPDATE todos SET updatedAt = ? WHERE id = ?').run(cutoff, todo.id);

    const archived = await sweepTerminalBucketChildren(p);

    expect(archived).not.toContain(todo.id);
    const after = getTodo(p, todo.id);
    expect(after!.status).toBe('todo');
  });

  test('sweepTerminalBucketChildren is idempotent', async () => {
    const p = freshProject();
    projects.push(p);

    const bucket = await ensureBucket(p, 'inbox');
    const item = await createTodo(p, { ownerSession: 'test', title: 'Item', parentId: bucket, status: 'done' });

    // Set to 8 days old
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const db = openDb(p);
    db.prepare('UPDATE todos SET updatedAt = ? WHERE id = ?').run(cutoff, item.id);

    const first = await sweepTerminalBucketChildren(p);
    expect(first).toContain(item.id);

    const second = await sweepTerminalBucketChildren(p);
    expect(second).not.toContain(item.id);  // already dropped, skip on re-run
  });
});
