// Runs via `bun test` (uses bun:sqlite) — excluded from vitest, same runtime as
// mission-store.test.ts / todo-kind-strip.test.ts (fixture-DB style + raw-SQL backdating,
// the established pattern in this suite for stamping timestamps no public setter exposes).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  createTodo, completeTodo, updateTodo, getTodo, listTodos, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, addCriterion, setCriterionMet, setMissionAbandoned,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { runArchivalSweep } from '../archival-sweep';

let project: string;

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;

/** Backdate a todo's completedAt/updatedAt (no public setter for this — same raw-SQL
 *  pattern mission-store.test.ts uses for archivedAt). Busts the todo-store cache after. */
function backdateTodo(proj: string, id: string, patch: { completedAt?: string; updatedAt?: string }) {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  if (patch.completedAt !== undefined) {
    db.prepare('UPDATE todos SET completedAt = ? WHERE id = ?').run(patch.completedAt, id);
  }
  if (patch.updatedAt !== undefined) {
    db.prepare('UPDATE todos SET updatedAt = ? WHERE id = ?').run(patch.updatedAt, id);
  }
  db.close();
  _closeProject(proj);
}

/** Backdate a mission's updatedAt (no public setter injects a clock — same raw-SQL
 *  pattern mission-store.test.ts uses). Busts the mission-store cache after. */
function backdateMission(proj: string, todoId: string, updatedAtMs: number) {
  const db = new Database(join(proj, '.collab', 'mission.db'));
  db.prepare('UPDATE mission SET updatedAt = ? WHERE todoId = ?').run(updatedAtMs, todoId);
  db.close();
  _resetMissionDbCache(proj);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'archival-sweep-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('runArchivalSweep', () => {
  test('archives terminal rows past retention, spares recent/live rows, cedes the loop across chunks', async () => {
    const now = Date.now();
    const oldIso = new Date(now - RETENTION_MS - DAY_MS).toISOString(); // 31 days ago
    const recentIso = new Date(now - DAY_MS).toISOString(); // 1 day ago

    const epic = await createTodo(project, {
      ownerSession: 's1', title: '[EPIC] archival fixture', kind: 'epic', missionId: null,
    });

    // 7 leaves total (pageSize 3 below ⇒ pages of 3/3/1, forcing >1 yield across chunks).
    const doneOldA = await createTodo(project, { ownerSession: 's1', title: 'done old A', kind: 'leaf', parentId: epic.id });
    await completeTodo(project, doneOldA.id);
    backdateTodo(project, doneOldA.id, { completedAt: oldIso });

    const doneOldB = await createTodo(project, { ownerSession: 's1', title: 'done old B', kind: 'leaf', parentId: epic.id });
    await completeTodo(project, doneOldB.id);
    backdateTodo(project, doneOldB.id, { completedAt: oldIso });

    const droppedOldA = await createTodo(project, { ownerSession: 's1', title: 'dropped old A', kind: 'leaf', parentId: epic.id });
    await updateTodo(project, droppedOldA.id, { status: 'dropped' });
    backdateTodo(project, droppedOldA.id, { updatedAt: oldIso });

    const droppedOldB = await createTodo(project, { ownerSession: 's1', title: 'dropped old B', kind: 'leaf', parentId: epic.id });
    await updateTodo(project, droppedOldB.id, { status: 'dropped' });
    backdateTodo(project, droppedOldB.id, { updatedAt: oldIso });

    const doneRecent = await createTodo(project, { ownerSession: 's1', title: 'done recent', kind: 'leaf', parentId: epic.id });
    await completeTodo(project, doneRecent.id);
    backdateTodo(project, doneRecent.id, { completedAt: recentIso });

    const liveReadyOld = await createTodo(project, { ownerSession: 's1', title: 'live ready old', kind: 'leaf', parentId: epic.id });
    await updateTodo(project, liveReadyOld.id, { status: 'ready' });
    backdateTodo(project, liveReadyOld.id, { updatedAt: oldIso }); // old but non-terminal ⇒ never archived

    const liveBlocked = await createTodo(project, { ownerSession: 's1', title: 'live blocked', kind: 'leaf', parentId: epic.id });
    await updateTodo(project, liveBlocked.id, { status: 'blocked' });

    // Missions: one converged past retention, one abandoned past retention, one converged
    // recently, one live (non-terminal) — only the first two must end up archived.
    const convergedOldNode = await createTodo(project, { ownerSession: 's1', title: '[MISSION] converged old', kind: 'mission' });
    upsertMission(project, convergedOldNode.id);
    const c1 = addCriterion(project, convergedOldNode.id, 'criterion A');
    setCriterionMet(project, c1.id, true);
    backdateMission(project, convergedOldNode.id, now - RETENTION_MS - DAY_MS);

    const abandonedOldNode = await createTodo(project, { ownerSession: 's1', title: '[MISSION] abandoned old', kind: 'mission' });
    upsertMission(project, abandonedOldNode.id);
    setMissionAbandoned(project, abandonedOldNode.id, now);
    backdateMission(project, abandonedOldNode.id, now - RETENTION_MS - DAY_MS);

    const convergedRecentNode = await createTodo(project, { ownerSession: 's1', title: '[MISSION] converged recent', kind: 'mission' });
    upsertMission(project, convergedRecentNode.id);
    const c2 = addCriterion(project, convergedRecentNode.id, 'criterion B');
    setCriterionMet(project, c2.id, true);

    const liveNode = await createTodo(project, { ownerSession: 's1', title: '[MISSION] live', kind: 'mission' });
    upsertMission(project, liveNode.id);
    addCriterion(project, liveNode.id, 'criterion C'); // unmet ⇒ needs-discovery, non-terminal

    let yieldCalls = 0;
    const yieldSpy = async () => { yieldCalls += 1; };

    const result = await runArchivalSweep(project, {
      now,
      retentionMs: RETENTION_MS,
      chunkSize: 3,
      yieldFn: yieldSpy,
      force: true,
    });

    expect(result.todosArchived).toBe(4);
    expect(result.missionsArchived).toBe(2);
    expect(yieldCalls).toBeGreaterThan(1);

    // Terminal + old ⇒ archived.
    expect(getTodo(project, doneOldA.id)!.archivedAt).not.toBeNull();
    expect(getTodo(project, doneOldB.id)!.archivedAt).not.toBeNull();
    expect(getTodo(project, droppedOldA.id)!.archivedAt).not.toBeNull();
    expect(getTodo(project, droppedOldB.id)!.archivedAt).not.toBeNull();

    // Terminal but recent, or live regardless of age ⇒ not archived.
    expect(getTodo(project, doneRecent.id)!.archivedAt ?? null).toBeNull();
    expect(getTodo(project, liveReadyOld.id)!.archivedAt ?? null).toBeNull();
    expect(getTodo(project, liveBlocked.id)!.archivedAt ?? null).toBeNull();

    const archivedIds = listTodos(project, { includeCompleted: true, onlyArchived: true }).map((t) => t.id);
    expect(new Set(archivedIds)).toEqual(new Set([doneOldA.id, doneOldB.id, droppedOldA.id, droppedOldB.id]));

    // Missions: converged/abandoned past retention ⇒ archived; recent/live ⇒ not.
    expect(getMission(project, convergedOldNode.id)!.archivedAt).not.toBeNull();
    expect(getMission(project, abandonedOldNode.id)!.archivedAt).not.toBeNull();
    expect(getMission(project, convergedRecentNode.id)!.archivedAt ?? null).toBeNull();
    expect(getMission(project, liveNode.id)!.archivedAt ?? null).toBeNull();
  });

  test('force:false respects the throttle (a second call within the interval no-ops even with fresh eligible rows)', async () => {
    const now = Date.now();
    const oldIso = new Date(now - RETENTION_MS - DAY_MS).toISOString();
    const epic = await createTodo(project, { ownerSession: 's1', title: '[EPIC] throttle fixture', kind: 'epic', missionId: null });

    const first = await createTodo(project, { ownerSession: 's1', title: 'done old 1', kind: 'leaf', parentId: epic.id });
    await completeTodo(project, first.id);
    backdateTodo(project, first.id, { completedAt: oldIso });

    const firstRun = await runArchivalSweep(project, { now });
    expect(firstRun).toEqual({ todosArchived: 1, missionsArchived: 0 });

    // A second eligible row appears, but the second call lands within ARCHIVAL_SWEEP_INTERVAL_MS
    // and force is not set — the throttle must no-op the pass entirely, even though this row
    // is eligible.
    const second = await createTodo(project, { ownerSession: 's1', title: 'done old 2', kind: 'leaf', parentId: epic.id });
    await completeTodo(project, second.id);
    backdateTodo(project, second.id, { completedAt: oldIso });

    const secondRun = await runArchivalSweep(project, { now: now + 1 });
    expect(secondRun).toEqual({ todosArchived: 0, missionsArchived: 0 });
    expect(getTodo(project, second.id)!.archivedAt ?? null).toBeNull();
  });
});
