/**
 * bucket-revival-sweep.test.ts — Regression tests for reviveTerminalBuckets sweep.
 *
 * Tests the idempotent revival of bucket epics (Inbox, Bugfix inbox, Flaky quarantine)
 * from terminal states (done/dropped) back to planned, and the restoration of cascaded
 * children that match the exact drop signature.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, openDb, reviveTerminalBuckets, _closeProject } from '../todo-store';
import { ensureBucket } from '../bucket-registry';
import { fileToBucketLeaf } from '../../mcp/workgraph-tools';

const SESSION = 'test-session';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'bucket-revival-sweep-'));
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

describe('bucket-revival-sweep', () => {

  test('revives a done bucketType singleton bucket and clears completedAt', async () => {
    const project = freshProject();
    projects.push(project);

    // Create an inbox bucket (gets bucketType='inbox').
    const bucketId = await ensureBucket(project, 'inbox');
    let bucket = getTodo(project, bucketId)!;
    expect(bucket.status).toBe('planned');
    expect(bucket.bucketType).toBe('inbox');

    // Manually mark it done with completedAt.
    const db = openDb(project);
    const now = new Date().toISOString();
    db.prepare(`UPDATE todos SET status='done', completedAt=? WHERE id=?`).run(now, bucketId);

    let before = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(before.status).toBe('done');
    expect(before.completedAt).not.toBeNull();
    expect(before.bucketType).toBe('inbox');

    // Run reviveTerminalBuckets.
    const revived = await reviveTerminalBuckets(project);
    expect(revived).toContain(bucketId);

    // Verify the bucket is now planned and completedAt is cleared.
    let after = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(after.status).toBe('planned');
    expect(after.bucketType).toBe('inbox');
    expect(after.completedAt).toBeNull();
  });

  test('revives a dropped legacy isBucket=1 bucket without stamping bucketType', async () => {
    const project = freshProject();
    projects.push(project);

    // Create a bucket via ensureBucket (which stamps bucketType='bugfix').
    const bucketId = await ensureBucket(project, 'bugfix');
    const db = openDb(project);
    const now = new Date().toISOString();

    // Simulate a legacy bucket: clear the bucketType and mark it dropped.
    db.prepare(`UPDATE todos SET bucketType=NULL, status='dropped', completedAt=? WHERE id=?`).run(now, bucketId);

    let before = db.prepare(`SELECT status, bucketType, isBucket FROM todos WHERE id=?`).get(bucketId) as any;
    expect(before.status).toBe('dropped');
    expect(before.bucketType).toBeNull();
    expect(before.isBucket).toBe(1); // Should still be marked as bucket via isBucket

    // Run reviveTerminalBuckets.
    const revived = await reviveTerminalBuckets(project);
    expect(revived).toContain(bucketId);

    // Verify it's revived to planned but bucketType remains null (not stamped).
    let after = db.prepare(`SELECT status, bucketType, isBucket FROM todos WHERE id=?`).get(bucketId) as any;
    expect(after.status).toBe('planned');
    expect(after.bucketType).toBeNull(); // Should NOT have been stamped
    expect(after.isBucket).toBe(1);
  });

  test('leaves a healthy planned Inbox bucket\'s status and bucketType unchanged', async () => {
    const project = freshProject();
    projects.push(project);

    // Create a healthy bucket.
    const bucketId = await ensureBucket(project, 'inbox');
    const bucket = getTodo(project, bucketId)!;
    expect(bucket.status).toBe('planned');
    expect(bucket.bucketType).toBe('inbox');

    // Record the original state.
    const db = openDb(project);
    const before = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;

    // Run reviveTerminalBuckets (should be no-op for a healthy bucket).
    const revived = await reviveTerminalBuckets(project);
    expect(revived).not.toContain(bucketId);

    // Verify nothing changed (except updatedAt).
    const after = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(after.status).toBe(before.status);
    expect(after.bucketType).toBe(before.bucketType);
    expect(after.completedAt).toBe(before.completedAt);
  });

  test('is idempotent on a second call', async () => {
    const project = freshProject();
    projects.push(project);

    // Create and terminate a bucket.
    const bucketId = await ensureBucket(project, 'inbox');
    const db = openDb(project);
    const now = new Date().toISOString();
    db.prepare(`UPDATE todos SET status='done', completedAt=? WHERE id=?`).run(now, bucketId);

    // First call to reviveTerminalBuckets.
    const revived1 = await reviveTerminalBuckets(project);
    expect(revived1).toContain(bucketId);

    let state1 = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(state1.status).toBe('planned');
    expect(state1.completedAt).toBeNull();

    // Sleep briefly to ensure updatedAt would differ if it gets re-touched.
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second call to reviveTerminalBuckets (should be idempotent: no-op because bucket is now planned).
    const revived2 = await reviveTerminalBuckets(project);
    expect(revived2).not.toContain(bucketId); // Should not be included (already planned)

    let state2 = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(state2.status).toBe(state1.status);
    expect(state2.bucketType).toBe(state1.bucketType);
    expect(state2.completedAt).toBe(state1.completedAt);
  });

  test('restores only children matching the exact cascade-drop signature', async () => {
    const project = freshProject();
    projects.push(project);

    // Create a bucket (while healthy).
    const bucketId = await ensureBucket(project, 'inbox');
    const db = openDb(project);

    // Create all children first (while bucket is healthy):
    // 1. Cascade-drop signature child (should be restored).
    const cascadeDropChild = await createTodo(project, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Cascade-drop child',
      parentId: bucketId,
      status: 'planned',
    });

    // 2. Already-dropped child with different updatedAt (should NOT be restored).
    const otherDroppedChild = await createTodo(project, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Other dropped child',
      parentId: bucketId,
      status: 'planned',
    });

    // 3. Healthy planned child (should NOT be affected).
    const healthyChild = await createTodo(project, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Healthy child',
      parentId: bucketId,
      status: 'planned',
    });

    // 4. Dropped child with acceptanceStatus set (should NOT be restored).
    const acceptedDroppedChild = await createTodo(project, {
      ownerSession: SESSION,
      kind: 'leaf',
      title: 'Accepted dropped child',
      parentId: bucketId,
      status: 'planned',
    });

    // Now terminate the bucket and set up the children to match different signatures.
    const now = new Date().toISOString();
    db.prepare(`UPDATE todos SET status='done', completedAt=? WHERE id=?`).run(now, bucketId);

    // Set cascade-drop child to match signature: status='dropped', completedAt=NULL, acceptanceStatus=NULL, updatedAt=now.
    db.prepare(
      `UPDATE todos SET status='dropped', completedAt=NULL, acceptanceStatus=NULL, updatedAt=? WHERE id=?`,
    ).run(now, cascadeDropChild.id);

    // Set other-dropped child with different updatedAt (should NOT be restored).
    const differentTime = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      `UPDATE todos SET status='dropped', completedAt=NULL, acceptanceStatus=NULL, updatedAt=? WHERE id=?`,
    ).run(differentTime, otherDroppedChild.id);

    // Keep healthy child as planned (should NOT be affected).

    // Set accepted-dropped child with acceptanceStatus (should NOT be restored).
    db.prepare(
      `UPDATE todos SET status='dropped', completedAt=NULL, acceptanceStatus='accepted', updatedAt=? WHERE id=?`,
    ).run(now, acceptedDroppedChild.id);

    // Run reviveTerminalBuckets.
    await reviveTerminalBuckets(project);

    // Verify only the cascade-drop signature child was restored.
    let child1 = db.prepare(`SELECT status FROM todos WHERE id=?`).get(cascadeDropChild.id) as any;
    expect(child1.status).toBe('planned');

    let child2 = db.prepare(`SELECT status FROM todos WHERE id=?`).get(otherDroppedChild.id) as any;
    expect(child2.status).toBe('dropped'); // Not restored (different updatedAt)

    let child3 = db.prepare(`SELECT status FROM todos WHERE id=?`).get(healthyChild.id) as any;
    expect(child3.status).toBe('planned'); // Unchanged

    let child4 = db.prepare(`SELECT status FROM todos WHERE id=?`).get(acceptedDroppedChild.id) as any;
    expect(child4.status).toBe('dropped'); // Not restored (acceptanceStatus was set)
  });

  test('revives a filed leaf\'s terminalized bucket end-to-end via fileToBucketLeaf', async () => {
    const project = freshProject();
    projects.push(project);

    // File a leaf into the bugfix bucket (auto-creates the singleton).
    const leaf = await fileToBucketLeaf(project, SESSION, {
      title: 'Test bugfix',
      bucket: 'bugfix',
    });

    // Get the bucket ID from the leaf's parent.
    const bucketId = leaf.parentId!;
    const bucket1 = getTodo(project, bucketId)!;
    expect(bucket1.status).toBe('planned');
    expect(bucket1.bucketType).toBe('bugfix');

    // Manually terminate the bucket (simulate drop cascade).
    const db = openDb(project);
    const now = new Date().toISOString();
    db.prepare(`UPDATE todos SET status='done', completedAt=? WHERE id=?`).run(now, bucketId);

    // Verify the bucket is now terminal.
    let bucket2 = db.prepare(`SELECT status, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(bucket2.status).toBe('done');
    expect(bucket2.completedAt).not.toBeNull();

    // Run reviveTerminalBuckets.
    await reviveTerminalBuckets(project);

    // Verify the bucket is revived.
    let bucket3 = db.prepare(`SELECT status, bucketType, completedAt FROM todos WHERE id=?`).get(bucketId) as any;
    expect(bucket3.status).toBe('planned');
    expect(bucket3.bucketType).toBe('bugfix');
    expect(bucket3.completedAt).toBeNull();

    // Verify the filed leaf still exists and is not dropped.
    let leafAfter = db.prepare(`SELECT status FROM todos WHERE id=?`).get(leaf.id) as any;
    expect(leafAfter).toBeDefined();
    expect(leafAfter.status).not.toBe('dropped');
  });
});
