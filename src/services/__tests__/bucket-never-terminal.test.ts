/**
 * bucket-never-terminal.test.ts — Regression tests for bucket structural non-terminalizability.
 *
 * Buckets (Inbox, Bugfix inbox) are durable intake containers and must never be closed/dropped
 * by the standard rollup sweep or any other termination path. A live child should survive a
 * rollup sweep even when its bucket parent is marked done or dropped.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTodo, listTodos, getTodo, sweepEpicRollups, completeTodo, openDb } from '../todo-store';
import { ensureBucket } from '../bucket-registry';
import { stampEpicLandedAtGated } from '../epic-landed-stamp-gate';

const PROJECT = '/tmp/mc-bucket-never-terminal';
const SESSION = 'test-session';

describe('bucket-never-terminal', () => {
  beforeEach(async () => {
    // Wipe the test DB before each test.
    const db = openDb(PROJECT);
    db.exec('DELETE FROM todos;');
  });

  it('a bucket marked done+landedAt keeps a freshly filed leaf alive across sweepEpicRollups', async () => {
    // Create a bucket (Inbox) and ensure it gets the singleton marker.
    const bucketId = await ensureBucket(PROJECT, 'inbox');
    const bucket = getTodo(PROJECT, bucketId)!;
    expect(bucket).toBeDefined();
    expect(bucket.title).toMatch(/inbox/i);

    // Create a leaf under the bucket.
    const leaf = await createTodo(PROJECT, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Test leaf',
      parentId: bucketId,
      status: 'todo',
    });
    expect(leaf.parentId).toBe(bucketId);

    // Manually mark the bucket done+landedAt (simulating an anomalous state).
    const db = openDb(PROJECT);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE todos SET status='done', completedAt=?, acceptanceStatus='accepted', landedAt=? WHERE id=?`,
    ).run(now, now, bucketId);

    // Run the rollup sweep.
    await sweepEpicRollups(PROJECT);

    // The bucket should still be done (not revived), but the leaf should still exist and not be dropped.
    const bucketAfter = getTodo(PROJECT, bucketId)!;
    expect(bucketAfter.status).toBe('done');

    const leafAfter = getTodo(PROJECT, leaf.id)!;
    expect(leafAfter).toBeDefined();
    expect(leafAfter.status).not.toBe('dropped');
    expect(leafAfter.parentId).toBe(bucketId);
  });

  it('a bucket marked dropped keeps a freshly filed leaf alive across sweepEpicRollups', async () => {
    // Create a bucket and a leaf.
    const bucketId = await ensureBucket(PROJECT, 'bugfix');
    const leaf = await createTodo(PROJECT, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Bugfix leaf',
      parentId: bucketId,
      status: 'todo',
    });

    // Mark the bucket dropped.
    const db = openDb(PROJECT);
    db.prepare(`UPDATE todos SET status='dropped' WHERE id=?`).run(bucketId);

    // Run the rollup sweep.
    await sweepEpicRollups(PROJECT);

    // Leaf should survive (not be dropped by a cascade or sweep).
    const leafAfter = getTodo(PROJECT, leaf.id)!;
    expect(leafAfter).toBeDefined();
    expect(leafAfter.status).not.toBe('dropped');
  });

  it('ensureBucket revives a dropped singleton', async () => {
    // Create a bucket.
    const bucketId = await ensureBucket(PROJECT, 'inbox');
    const bucket1 = getTodo(PROJECT, bucketId)!;
    expect(bucket1.status).toBe('planned');

    // Manually mark it dropped.
    const db = openDb(PROJECT);
    db.prepare(`UPDATE todos SET status='dropped' WHERE id=?`).run(bucketId);
    let dropped = getTodo(PROJECT, bucketId)!;
    expect(dropped.status).toBe('dropped');

    // Call ensureBucket again — it should find and revive the singleton.
    const revived = await ensureBucket(PROJECT, 'inbox');
    expect(revived).toBe(bucketId);

    // Verify it's now planned.
    const bucketAfter = getTodo(PROJECT, bucketId)!;
    expect(bucketAfter.status).toBe('planned');
    expect(bucketAfter.completedAt).toBeNull();
    expect(bucketAfter.acceptanceStatus).toBeNull();
  });

  it('completing the last live child of a bucket does not roll the bucket up', async () => {
    // Create a bucket and two leaves under it.
    const bucketId = await ensureBucket(PROJECT, 'inbox');

    const leaf1 = await createTodo(PROJECT, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Leaf 1',
      parentId: bucketId,
      status: 'todo',
      approvedBy: SESSION,
    });

    const leaf2 = await createTodo(PROJECT, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Leaf 2',
      parentId: bucketId,
      status: 'todo',
      approvedBy: SESSION,
    });

    // Complete the first leaf.
    await completeTodo(PROJECT, leaf1.id, 'accepted');
    let bucketCheck = getTodo(PROJECT, bucketId)!;
    expect(bucketCheck.status).not.toBe('done');

    // Complete the second leaf (all children done now).
    await completeTodo(PROJECT, leaf2.id, 'accepted');

    // The bucket should NOT be closed/rolled up.
    const bucketAfter = getTodo(PROJECT, bucketId)!;
    expect(bucketAfter.status).not.toBe('done');
    expect(bucketAfter.status).not.toBe('dropped');
  });

  it('stampEpicLandedAtGated refuses a bucket', async () => {
    // Create a bucket and mark it done (simulate a stale state).
    const bucketId = await ensureBucket(PROJECT, 'inbox');
    const db = openDb(PROJECT);
    const now = new Date().toISOString();
    db.prepare(`UPDATE todos SET status='done', completedAt=?, landedAt=? WHERE id=?`).run(now, now, bucketId);

    // Try to stamp it as landed — should be refused with 'gate-error'.
    const result = await stampEpicLandedAtGated(PROJECT, bucketId, now);
    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('gate-error');
  });

  it('ensureBucket revives a fully-terminal bucket (status, completedAt, acceptanceStatus, landedAt, hollowLandedAt) and is idempotent on a second call', async () => {
    // Create a bucket.
    const bucketId = await ensureBucket(PROJECT, 'inbox');
    const bucket1 = getTodo(PROJECT, bucketId)!;
    expect(bucket1.status).toBe('planned');
    expect(bucket1.bucketType).toBe('inbox');

    // Manually mark it fully terminal: status='done', completedAt, acceptanceStatus='accepted',
    // landedAt, and hollowLandedAt.
    const db = openDb(PROJECT);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE todos SET status='done', completedAt=?, acceptanceStatus='accepted', landedAt=?, hollowLandedAt=? WHERE id=?`,
    ).run(now, now, now, bucketId);

    let terminal = getTodo(PROJECT, bucketId)!;
    expect(terminal.status).toBe('done');
    expect(terminal.completedAt).not.toBeNull();
    expect(terminal.acceptanceStatus).toBe('accepted');
    expect(terminal.landedAt).not.toBeNull();
    expect(terminal.hollowLandedAt).not.toBeNull();

    // Call ensureBucket again — it should revive the bucket.
    const revived = await ensureBucket(PROJECT, 'inbox');
    expect(revived).toBe(bucketId);

    // Verify it's now planned and all terminal markers are cleared.
    const revivified = getTodo(PROJECT, bucketId)!;
    expect(revivified.status).toBe('planned');
    expect(revivified.completedAt).toBeNull();
    expect(revivified.acceptanceStatus).toBeNull();
    expect(revivified.landedAt).toBeNull();
    expect(revivified.hollowLandedAt).toBeNull();
    expect(revivified.isBucket).toBeTruthy();
    expect(revivified.bucketType).toBe('inbox');

    // Record the state after first ensureBucket revive call.
    const revivifiedUpdatedAt = revivified.updatedAt;

    // Second call to ensureBucket on the same bucket should be idempotent (only updatedAt changes).
    await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay to ensure updatedAt changes.
    const secondResult = await ensureBucket(PROJECT, 'inbox');
    expect(secondResult).toBe(bucketId);

    const secondCall = getTodo(PROJECT, bucketId)!;
    expect(secondCall.status).toBe(revivified.status);
    expect(secondCall.completedAt).toBe(revivified.completedAt);
    expect(secondCall.acceptanceStatus).toBe(revivified.acceptanceStatus);
    expect(secondCall.landedAt).toBe(revivified.landedAt);
    expect(secondCall.hollowLandedAt).toBe(revivified.hollowLandedAt);
    expect(secondCall.isBucket).toBe(revivified.isBucket);
    expect(secondCall.bucketType).toBe(revivified.bucketType);
    // updatedAt must have changed (it's set to the current time on each call).
    expect(secondCall.updatedAt).not.toBe(revivifiedUpdatedAt);
  });
});
