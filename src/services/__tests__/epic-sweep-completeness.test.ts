// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  createTodo,
  updateTodo,
  getTodo,
  sweepEpicRollups,
  stampEpicLandedAt,
  _closeProject,
  MOTIONLESS_EPIC_AFTER_MS,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let project: string;

/** Helper: force a todo into in_progress status via raw SQL (bypassing the updateTodo
 *  validation that rejects manual in_progress). Then _closeProject to flush the
 *  connection so the next store call re-opens fresh. */
function forceInProgress(proj: string, id: string) {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  db.exec(`UPDATE todos SET status='in_progress' WHERE id='${id}'`);
  db.close();
  _closeProject(proj);
}

/** Helper: backdate a todo's updatedAt timestamp via raw SQL to a specific ISO string.
 *  Then _closeProject to flush the connection. */
function backdateUpdatedAt(proj: string, id: string, isoTimestamp: string) {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  db.exec(`UPDATE todos SET updatedAt='${isoTimestamp}' WHERE id='${id}'`);
  db.close();
  _closeProject(proj);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'epic-sweep-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});

afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('sweepEpicRollups — landed-epic settlement', () => {
  test('moot leftover: rolls up a landed epic when leftover children are non-terminal (planned)', async () => {
    // Create a landed epic with two children:
    // - one done+accepted (settled)
    // - one planned (moot leftover)
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] landed test',
      kind: 'epic',
      status: 'planned',
    });
    const doneChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'done child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, doneChild.id, { status: 'done', acceptanceStatus: 'accepted' });

    const leftoverChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'leftover child',
      parentId: epic.id,
      status: 'planned',
    });

    // Stamp the epic as landed
    const now = new Date().toISOString();
    stampEpicLandedAt(project, epic.id, now);
    // Verify it was actually set
    const epicAfterStamp = getTodo(project, epic.id);
    expect(epicAfterStamp?.landedAt).toBeDefined();

    const { rolledUp, flagged, settledChildIds } = await sweepEpicRollups(project);

    // The moot leftover is dropped, epic rolls up.
    expect(rolledUp).toContain(epic.id);
    expect(settledChildIds[epic.id]).toEqual([leftoverChild.id]);
    expect(flagged).toHaveLength(0);

    // Verify the epic is done+accepted and leftover is dropped
    expect(getTodo(project, epic.id)?.status).toBe('done');
    expect(getTodo(project, epic.id)?.acceptanceStatus).toBe('accepted');
    expect(getTodo(project, leftoverChild.id)?.status).toBe('dropped');
  });

  test('in_progress leftover: flags a landed epic with in_progress child, does not roll up', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] landed with in_progress',
      kind: 'epic',
      status: 'planned',
    });
    const doneChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'done child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, doneChild.id, { status: 'done', acceptanceStatus: 'accepted' });

    const inProgressChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'in_progress child',
      parentId: epic.id,
      status: 'ready',
    });

    // Force the child into in_progress state
    forceInProgress(project, inProgressChild.id);

    // Stamp the epic as landed
    const now = new Date().toISOString();
    stampEpicLandedAt(project, epic.id, now);

    const { rolledUp, flagged } = await sweepEpicRollups(project);

    expect(rolledUp).not.toContain(epic.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      epicId: epic.id,
      reason: 'landed-needs-review',
      inProgress: 1,
      doneUnaccepted: 0,
    });

    // Epic status should remain unchanged (still planned)
    expect(getTodo(project, epic.id)?.status).toBe('planned');
  });

  test('done-unaccepted leftover: flags a landed epic with done-but-unaccepted child when other children are not done', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] landed with unaccepted',
      kind: 'epic',
      status: 'planned',
    });
    const doneChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'done accepted child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, doneChild.id, { status: 'done', acceptanceStatus: 'accepted' });

    // A non-done leftover child (makes !allDone true)
    const mootChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'moot leftover child',
      parentId: epic.id,
      status: 'planned',
    });

    // A done-but-unaccepted child (triggers doneUnaccepted flag)
    const unacceptedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'done unaccepted child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, unacceptedChild.id, { status: 'done', acceptanceStatus: null });

    // Stamp the epic as landed
    const now = new Date().toISOString();
    stampEpicLandedAt(project, epic.id, now);
    // Verify it was actually set
    const epicAfterStamp = getTodo(project, epic.id);
    expect(epicAfterStamp?.landedAt).toBeDefined();

    const { rolledUp, flagged } = await sweepEpicRollups(project);

    expect(rolledUp).not.toContain(epic.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      epicId: epic.id,
      reason: 'landed-needs-review',
      inProgress: 0,
      doneUnaccepted: 1,
    });

    expect(getTodo(project, epic.id)?.status).toBe('planned');
  });
});

describe('sweepEpicRollups — motionless-abandoned', () => {
  test('flagged case: flags a non-landed epic with idle children past motionlessAfterMs threshold', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] motionless test',
      kind: 'epic',
      status: 'planned',
    });
    const child = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'idle child',
      parentId: epic.id,
      status: 'planned',
    });

    // Inject a fixed `now` and a small motionlessAfterMs threshold
    const smallThreshold = 5000; // 5 seconds
    const now = Date.now();
    // Backdate the child's updatedAt to be past the threshold
    const idleTime = smallThreshold + 1000;
    const oldTimestamp = new Date(now - idleTime).toISOString();
    backdateUpdatedAt(project, child.id, oldTimestamp);

    const { rolledUp, flagged } = await sweepEpicRollups(project, { now, motionlessAfterMs: smallThreshold });

    expect(rolledUp).toHaveLength(0);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      epicId: epic.id,
      reason: 'motionless',
    });
    // Verify idleForMs is at least the threshold
    expect(flagged[0].idleForMs).toBeGreaterThanOrEqual(smallThreshold);

    // Epic status should remain unchanged (still planned)
    expect(getTodo(project, epic.id)?.status).toBe('planned');
  });

  test('not-flagged case: does not flag a non-landed epic with recently-updated children', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] recent test',
      kind: 'epic',
      status: 'planned',
    });
    const child = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'recent child',
      parentId: epic.id,
      status: 'planned',
    });

    // Inject a fixed `now` and a small motionlessAfterMs threshold
    const smallThreshold = 5000; // 5 seconds
    const now = Date.now();
    // Backdate the child's updatedAt to be WITHIN the threshold
    const recentTime = smallThreshold - 1000; // 4 seconds ago
    const recentTimestamp = new Date(now - recentTime).toISOString();
    backdateUpdatedAt(project, child.id, recentTimestamp);

    const { rolledUp, flagged } = await sweepEpicRollups(project, { now, motionlessAfterMs: smallThreshold });

    expect(rolledUp).toHaveLength(0);
    expect(flagged).toHaveLength(0);
  });
});

describe('sweepEpicRollups — in_progress rollup regression', () => {
  test('all children done+accepted: rolls up the epic', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] rollup test',
      kind: 'epic',
      status: 'planned',
    });
    const child1 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'child 1',
      parentId: epic.id,
      status: 'ready',
    });
    const child2 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'child 2',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark both children done+accepted
    await updateTodo(project, child1.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, child2.id, { status: 'done', acceptanceStatus: 'accepted' });

    const { rolledUp, flagged } = await sweepEpicRollups(project);

    expect(rolledUp).toContain(epic.id);
    expect(flagged).toHaveLength(0);
    expect(getTodo(project, epic.id)?.status).toBe('done');
    expect(getTodo(project, epic.id)?.acceptanceStatus).toBe('accepted');
  });

  test('all children done, one unaccepted: flags the epic with unaccepted count, does not roll up', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] unaccepted test',
      kind: 'epic',
      status: 'planned',
    });
    const acceptedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'accepted child',
      parentId: epic.id,
      status: 'ready',
    });
    const unacceptedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'unaccepted child',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark both done but only one accepted
    await updateTodo(project, acceptedChild.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, unacceptedChild.id, { status: 'done', acceptanceStatus: null });

    const { rolledUp, flagged } = await sweepEpicRollups(project);

    expect(rolledUp).not.toContain(epic.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      epicId: epic.id,
      reason: 'unaccepted',
      unaccepted: 1,
    });
    expect(getTodo(project, epic.id)?.status).toBe('planned');
  });
});
