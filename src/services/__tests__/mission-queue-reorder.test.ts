// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, activateMission, enqueueMission, reorderMissionQueue, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

/** Create a [MISSION] node and upsert its mission row, returning the id. */
async function makeMissionAndUpsert(title: string): Promise<string> {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  upsertMission(project, t.id);
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-queue-reorder-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('reorderMissionQueue', () => {
  test('reordering the queue preserves the active mission', async () => {
    // Create three missions
    const a = await makeMissionAndUpsert('[MISSION] A');
    const b = await makeMissionAndUpsert('[MISSION] B');
    const c = await makeMissionAndUpsert('[MISSION] C');

    // Activate A (all three start active by default, so we need to make sure A is the one active)
    activateMission(project, a);

    // Enqueue B and C
    enqueueMission(project, b);
    enqueueMission(project, c);

    // Verify initial state
    expect(getMission(project, a)!.active).toBe(true);
    expect(getMission(project, a)!.queuePos).toBeNull(); // active mission has no queuePos
    expect(getMission(project, b)!.active).toBe(false);
    expect(getMission(project, b)!.queuePos).not.toBeNull();
    expect(getMission(project, c)!.active).toBe(false);
    expect(getMission(project, c)!.queuePos).not.toBeNull();

    // Reorder the queue: put C first, then B
    const reordered = reorderMissionQueue(project, [c, b]);

    // A should still be active with no queuePos
    expect(getMission(project, a)!.active).toBe(true);
    expect(getMission(project, a)!.queuePos).toBeNull();

    // B and C should still have falsy active flag
    expect(getMission(project, b)!.active).toBe(false);
    expect(getMission(project, c)!.active).toBe(false);

    // C should have queuePos 0 (first in the new order)
    expect(getMission(project, c)!.queuePos).toBe(0);
    // B should have queuePos 1 (second in the new order)
    expect(getMission(project, b)!.queuePos).toBe(1);

    // Verify the return value contains the reordered missions in request order
    expect(reordered.length).toBe(2);
    expect(reordered[0].todoId).toBe(c);
    expect(reordered[1].todoId).toBe(b);
  });

  test('a reordered mission keeps its requested position', async () => {
    // Create three missions
    const m1 = await makeMissionAndUpsert('[MISSION] M1');
    const m2 = await makeMissionAndUpsert('[MISSION] M2');
    const m3 = await makeMissionAndUpsert('[MISSION] M3');

    // Enqueue all three so none is active
    enqueueMission(project, m1);
    enqueueMission(project, m2);
    enqueueMission(project, m3);

    // Verify all are queued (not active)
    expect(getMission(project, m1)!.active).toBe(false);
    expect(getMission(project, m2)!.active).toBe(false);
    expect(getMission(project, m3)!.active).toBe(false);

    // Reorder with a shuffled order: m3, m1, m2
    reorderMissionQueue(project, [m3, m1, m2]);

    // Verify each mission has the position corresponding to its index in the new order
    expect(getMission(project, m3)!.queuePos).toBe(0);
    expect(getMission(project, m1)!.queuePos).toBe(1);
    expect(getMission(project, m2)!.queuePos).toBe(2);
  });
});
