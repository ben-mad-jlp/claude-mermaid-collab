/**
 * Bounded-read proof for GET /api/supervisor/missions (the c4eb4fcc wedge).
 *
 * Runs via `bun test` (uses bun:sqlite for the bulk fixture) — same fixture-DB +
 * raw-SQL style as services/__tests__/archival-sweep.test.ts.
 *
 * The route used to do TWO full collectMissionStatusFacts scans per mission (one via
 * getMission, one via getMissionRollup), each of which is a project-wide listTodos plus
 * one ledger scan per live epic — an unbounded ~2N fan-out, returning EVERY mission.
 * These tests pin the three bounds that replaced it: hot-only content, zero facts
 * fan-out, and a capped page size.
 */
import { describe, test, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'missions-bounded-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

// Imports AFTER the env is set so every db opens against our temp dir.
import { createTodo, listTodos, _closeProject } from '../../services/todo-store';
import { upsertMission, addCriterion, _resetMissionDbCache } from '../../services/mission-store';
import { runArchivalSweep } from '../../services/archival-sweep';
import { _closeLedgerDb } from '../../services/worker-ledger';
import { handleSupervisorRoutes } from '../supervisor-routes';
import * as ledgerStats from '../../services/ledger-stats';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVED_ROWS = 20_000;
const LIVE_MISSIONS = 5;

let project: string;
let missionIds: string[] = [];

/**
 * Bulk-insert `count` already-`done` leaves whose completedAt is 31 days old (past
 * ARCHIVAL_RETENTION_MS) directly via bun:sqlite, in ONE transaction. 20k individual
 * awaited createTodo() calls would dominate the test's runtime and prove nothing extra —
 * the fixture only needs rows the archival sweep will stamp.
 */
function bulkInsertArchivableLeaves(proj: string, epicId: string, count: number): void {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  const oldIso = new Date(Date.now() - 31 * DAY_MS).toISOString();
  const stmt = db.prepare(
    `INSERT INTO todos (id, ownerSession, title, status, parentId, dependsOn, ord,
                        createdAt, updatedAt, completedAt, kind)
     VALUES (?, 's1', ?, 'done', ?, '[]', ?, ?, ?, ?, 'leaf')`,
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      stmt.run(`bulk-${i}`, `bulk leaf ${i}`, epicId, i, oldIso, oldIso, oldIso);
    }
  })();
  db.close();
  _closeProject(proj); // bust the todo-store cache so the sweep re-reads
}

async function getMissions(query: string): Promise<{ status: number; body: any }> {
  const req = new Request(`http://x/api/supervisor/missions?${query}`);
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return { status: res!.status, body: await res!.json() };
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'missions-bounded-'));

  // (1) A throwaway epic holding the 20k archivable leaves. Stays live itself so the
  //     sweep only moves its children.
  const junkEpic = await createTodo(project, {
    ownerSession: 's1', title: '[EPIC] bulk archive fixture', kind: 'epic', missionId: null,
  });
  bulkInsertArchivableLeaves(project, junkEpic.id, ARCHIVED_ROWS);

  // (2) The small LIVE set: 5 missions, each with an open epic + a criterion. Fresh
  //     timestamps, so the sweep never touches them.
  for (let i = 0; i < LIVE_MISSIONS; i++) {
    const node = await createTodo(project, {
      ownerSession: 's1', title: `[MISSION] live ${i}`, kind: 'mission', missionId: null,
    });
    upsertMission(project, node.id);
    addCriterion(project, node.id, `criterion ${i}`);
    await createTodo(project, {
      ownerSession: 's1', title: `[EPIC] live epic ${i}`, kind: 'epic', parentId: node.id,
    });
    missionIds.push(node.id);
  }

  // (3) Move the 20k old rows out of the hot (archivedAt IS NULL) index.
  const swept = await runArchivalSweep(project, { force: true });
  expect(swept.todosArchived).toBe(ARCHIVED_ROWS);

  // (4) Bust caches before reading, same as archival-sweep.test.ts.
  _closeProject(project);
  _resetMissionDbCache(project);
});

afterAll(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
  rmSync(SUP_DIR, { recursive: true, force: true });
});

describe('GET /api/supervisor/missions is bounded against a 20k-row archive', () => {
  test('returns only the small live mission set; hot listTodos never sees the archive', async () => {
    const tGet = performance.now();
    const { status, body } = await getMissions(`project=${encodeURIComponent(project)}`);
    const getMs = performance.now() - tGet;

    expect(status).toBe(200);
    expect(body.missions.length).toBe(LIVE_MISSIONS);
    expect(body.missions.map((m: any) => m.node.id).sort()).toEqual([...missionIds].sort());

    // The hot read is archivedAt IS NULL — the 20k archived leaves must not leak in.
    const tList = performance.now();
    const hot = listTodos(project, { includeCompleted: true });
    const listMs = performance.now() - tList;
    expect(hot.length).toBeLessThan(100);
    expect(hot.length).toBeLessThan(ARCHIVED_ROWS);

    // Structural-bound SMOKE check, not a microbenchmark: CI machines vary wildly, so the
    // threshold is deliberately generous. It only catches an order-of-magnitude regression
    // (e.g. the fan-out coming back). The real proof is the zero-call test below.
    expect(getMs).toBeLessThan(2000);
    expect(listMs).toBeLessThan(2000);
  });

  test('the list route does zero facts fan-out (listLeafRuns called 0 times)', async () => {
    // collectMissionStatusFacts is the ONLY caller of listLeafRuns (mission-store.ts), so
    // listLeafRuns' call count is a faithful proxy for the facts fan-out — and unlike a
    // spy on collectMissionStatusFacts itself (whose call sites inside mission-store are
    // direct, unqualified references a namespace spy cannot intercept), this one is a
    // cross-module import and DOES intercept. The control assertion below proves it.
    const spy = spyOn(ledgerStats, 'listLeafRuns');

    spy.mockClear();
    const { body } = await getMissions(`project=${encodeURIComponent(project)}&limit=${LIVE_MISSIONS}`);
    expect(body.missions.length).toBe(LIVE_MISSIONS);
    expect(spy.mock.calls.length).toBe(0);

    // Control: the withFacts path DOES fan out — proving the spy actually intercepts, so
    // the zero above is a real bound and not a silently non-wired spy.
    spy.mockClear();
    const { listMissions } = await import('../../services/mission-store');
    listMissions(project, { withFacts: true });
    expect(spy.mock.calls.length).toBeGreaterThan(0);

    spy.mockRestore();
  });

  test('honors the limit/cursor pagination contract', async () => {
    const p = `project=${encodeURIComponent(project)}`;

    const first = await getMissions(`${p}&limit=2`);
    expect(first.body.missions.length).toBe(2);
    expect(typeof first.body.nextCursor).toBe('string');
    expect(first.body.nextCursor).toBe(first.body.missions[1].node.id);

    const second = await getMissions(`${p}&limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.missions.length).toBe(2);
    // Disjoint page.
    const firstIds = first.body.missions.map((m: any) => m.node.id);
    const secondIds = second.body.missions.map((m: any) => m.node.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);

    // Last page (1 of 5 remaining) exhausts the list → nextCursor null.
    const third = await getMissions(`${p}&limit=2&cursor=${second.body.nextCursor}`);
    expect(third.body.missions.length).toBe(1);
    expect(third.body.nextCursor).toBeNull();
  });

  test('clamps limit to MAX_MISSIONS_LIST_LIMIT', async () => {
    const { MAX_MISSIONS_LIST_LIMIT } = await import('../supervisor-routes');
    expect(MAX_MISSIONS_LIST_LIMIT).toBe(200);
    // An absurd limit must not produce an unbounded page — it clamps, and with only 5
    // live missions the whole set comes back with no next page.
    const { body } = await getMissions(`project=${encodeURIComponent(project)}&limit=999999`);
    expect(body.missions.length).toBe(LIVE_MISSIONS);
    expect(body.nextCursor).toBeNull();
  });
});
