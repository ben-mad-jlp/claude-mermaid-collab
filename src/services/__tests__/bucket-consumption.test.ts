import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  openDb,
  getTodo,
  createTodo,
  updateTodo,
  _closeProject,
} from '../todo-store';
import { ensureBucket } from '../bucket-registry';
import {
  isBucketItem,
  consumeBucketItems,
  reopenConsumedFor,
  consumerDelivered,
} from '../bucket-consumption';
import { stampEpicLandedAt } from '../todo-store';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'bucket-consumption-'));
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

describe('bucket-consumption: isBucketItem predicate', () => {
  test('a leaf parented directly under a bucket epic IS a bucket item', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');
    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug to fix',
      parentId: bucketId,
    })).id;

    expect(isBucketItem(project, leafId)).toBe(true);
  });

  test('a leaf parented under a non-bucket epic is NOT a bucket item', async () => {
    const project = freshProject();
    projects.push(project);

    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Real epic',
      inbox: true,
    })).id;

    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Feature task',
      parentId: epicId,
    })).id;

    expect(isBucketItem(project, leafId)).toBe(false);
  });

  test('a root-level leaf (no parent) is NOT a bucket item', async () => {
    const project = freshProject();
    projects.push(project);

    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Orphan task',
      inbox: true,
      allowOrphan: true,
    })).id;

    expect(isBucketItem(project, leafId)).toBe(false);
  });

  test('a leaf at an invalid id returns false', async () => {
    const project = freshProject();
    projects.push(project);
    expect(isBucketItem(project, 'nonexistent-id')).toBe(false);
  });
});

describe('bucket-consumption: consumeBucketItems', () => {
  test('consuming 2 of 3 bucket leaves stamps only those two done with promotedTo and consumedAt', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');
    const leaf1 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 1',
      parentId: bucketId,
    });
    const leaf2 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 2',
      parentId: bucketId,
    });
    const leaf3 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 3',
      parentId: bucketId,
    });

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer epic',
      inbox: true,
    })).id;

    const result = await consumeBucketItems(project, [leaf1.id, leaf2.id], {
      id: consumerEpicId,
      kind: 'epic',
    });

    expect(result.consumed).toEqual([leaf1.id, leaf2.id]);
    expect(result.skipped).toEqual([]);

    const row1 = getTodo(project, leaf1.id)!;
    const row2 = getTodo(project, leaf2.id)!;
    const row3 = getTodo(project, leaf3.id)!;

    expect(row1.status).toBe('done');
    expect(row1.promotedTo).toBe(consumerEpicId);
    expect(row1.consumedAt).not.toBeNull();

    expect(row2.status).toBe('done');
    expect(row2.promotedTo).toBe(consumerEpicId);
    expect(row2.consumedAt).not.toBeNull();

    expect(row3.status).toBe('todo');
    expect(row3.promotedTo).toBeNull();
    expect(row3.consumedAt).toBeNull();
  });

  test('a non-bucket leaf id is skipped with reason not-a-bucket-item and left unmutated', async () => {
    const project = freshProject();
    projects.push(project);

    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Real epic',
      inbox: true,
    })).id;

    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Feature',
      parentId: epicId,
    })).id;

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    const result = await consumeBucketItems(project, [leafId], {
      id: consumerEpicId,
      kind: 'epic',
    });

    expect(result.consumed).toEqual([]);
    expect(result.skipped).toEqual([{ id: leafId, reason: 'not-a-bucket-item' }]);

    const row = getTodo(project, leafId)!;
    expect(row.status).toBe('todo');
    expect(row.promotedTo).toBeNull();
    expect(row.consumedAt).toBeNull();
  });

  test('a not-found id is skipped with reason not-found', async () => {
    const project = freshProject();
    projects.push(project);

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    const result = await consumeBucketItems(project, ['nonexistent-id'], {
      id: consumerEpicId,
      kind: 'epic',
    });

    expect(result.consumed).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'nonexistent-id', reason: 'not-found' }]);
  });

  test('an already-done bucket item is skipped with reason already-terminal', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');
    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug',
      parentId: bucketId,
    })).id;

    await updateTodo(project, leafId, { status: 'done' });

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    const result = await consumeBucketItems(project, [leafId], {
      id: consumerEpicId,
      kind: 'epic',
    });

    expect(result.consumed).toEqual([]);
    expect(result.skipped).toEqual([{ id: leafId, reason: 'already-terminal' }]);
  });

  test('an already-dropped bucket item is skipped with reason already-terminal', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');
    const leafId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug',
      parentId: bucketId,
    })).id;

    await updateTodo(project, leafId, { status: 'dropped' });

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    const result = await consumeBucketItems(project, [leafId], {
      id: consumerEpicId,
      kind: 'epic',
    });

    expect(result.consumed).toEqual([]);
    expect(result.skipped).toEqual([{ id: leafId, reason: 'already-terminal' }]);
  });
});

describe('bucket-consumption: reopenConsumedFor', () => {
  test('reopenConsumedFor restores consumed rows to planned and clears promotedTo/consumedAt', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');
    const leaf1 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 1',
      parentId: bucketId,
    });
    const leaf2 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 2',
      parentId: bucketId,
    });

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    await consumeBucketItems(project, [leaf1.id, leaf2.id], {
      id: consumerEpicId,
      kind: 'epic',
    });

    const reopened = reopenConsumedFor(project, consumerEpicId);

    expect(reopened).toHaveLength(2);
    expect(reopened.sort()).toEqual([leaf1.id, leaf2.id].sort());

    const row1 = getTodo(project, leaf1.id)!;
    const row2 = getTodo(project, leaf2.id)!;

    expect(row1.status).toBe('planned');
    expect(row1.promotedTo).toBeNull();
    expect(row1.consumedAt).toBeNull();

    expect(row2.status).toBe('planned');
    expect(row2.promotedTo).toBeNull();
    expect(row2.consumedAt).toBeNull();
  });

  test('reopenConsumedFor with no consumed items returns empty array', async () => {
    const project = freshProject();
    projects.push(project);

    const consumerEpicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer',
      inbox: true,
    })).id;

    const reopened = reopenConsumedFor(project, consumerEpicId);
    expect(reopened).toEqual([]);
  });
});

describe('bucket-consumption: consumerDelivered', () => {
  test('consumerDelivered is true for a landed epic', async () => {
    const project = freshProject();
    projects.push(project);

    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Epic',
      inbox: true,
    })).id;

    stampEpicLandedAt(project, epicId, new Date().toISOString());

    expect(consumerDelivered(project, epicId)).toBe(true);
  });

  test('consumerDelivered is false for a dropped epic with no landedAt', async () => {
    const project = freshProject();
    projects.push(project);

    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Epic',
      inbox: true,
    })).id;

    await updateTodo(project, epicId, { status: 'dropped' });

    expect(consumerDelivered(project, epicId)).toBe(false);
  });

  test('consumerDelivered is false for a non-existent id', async () => {
    const project = freshProject();
    projects.push(project);

    expect(consumerDelivered(project, 'nonexistent')).toBe(false);
  });
});
