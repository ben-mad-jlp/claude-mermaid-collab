/**
 * listMissions must not fan out per criterion, per epic, or per mission.
 *
 * MEASURED 2026-08-11: 572 queries and 103ms to return SIX missions. `bun:sqlite` is
 * synchronous, so that time is the event loop held shut — and listMissions sits on the hot
 * path (the coordinator, the landed-epic sweep, two mission-store callers). Repeated often
 * enough it produced the multi-second health-probe latencies the Electron watchdog SIGKILLs
 * for. The fan-out was three separate N+1s:
 *
 *   210x  land record read, per epic PER CRITERION (the record depends only on the epic)
 *   202x  ledger read, one query per epic
 *    34x  full `SELECT * FROM todos` re-scan, though the caller already held that array
 *
 * This test counts QUERIES, not milliseconds — a timing assertion would be flaky on a loaded
 * box and would not say what regressed. The budget scales with the graph so adding a mission
 * cannot silently reintroduce a per-mission fan-out.
 *
 * COVERAGE, honestly: mutation probes confirm this test reds when either the land-record or
 * the ledger batching is reverted. It does NOT red when the `allTodos` threading is reverted —
 * that fix is evidenced by measurement against the live database (34 full scans per call before,
 * and 103ms -> 49ms overall), not pinned here. Tightening the ceiling far enough to catch it
 * would make the test brittle against unrelated query-count drift.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, updateTodo, _closeProject } from '../todo-store';
import { upsertMission, listMissions, addCriterion } from '../mission-store';

let project: string;

beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'lm-budget-')); });
afterEach(() => { try { _closeProject(project); } catch { /* ignore */ } rmSync(project, { recursive: true, force: true }); });

/** Count every statement the block issues, across all databases. */
function countQueries(fn: () => void): number {
  let n = 0;
  const oq = Database.prototype.query;
  const op = Database.prototype.prepare;
  (Database.prototype as unknown as Record<string, unknown>).query = function (this: Database, s: string) { n++; return oq.call(this, s); };
  (Database.prototype as unknown as Record<string, unknown>).prepare = function (this: Database, s: string) { n++; return op.call(this, s); };
  try { fn(); } finally {
    (Database.prototype as unknown as Record<string, unknown>).query = oq;
    (Database.prototype as unknown as Record<string, unknown>).prepare = op;
  }
  return n;
}

async function buildGraph(missions: number, epicsPer: number, criteriaPer: number) {
  for (let m = 0; m < missions; m++) {
    const node = await createTodo(project, { ownerSession: 's1', title: `mission ${m}`, kind: 'mission' });
    upsertMission(project, node.id);
    const crits = [];
    for (let c = 0; c < criteriaPer; c++) crits.push(addCriterion(project, node.id, `criterion ${m}.${c}`));
    for (let e = 0; e < epicsPer; e++) {
      // LANDED and SERVING on purpose. The land-record read only runs for epics that prove a
      // criterion, so a fixture of open epics leaves that whole branch dead and any budget
      // assertion over it vacuous — the first cut of this test passed with the N+1 restored.
      const epic = await createTodo(project, {
        ownerSession: 's1', title: `epic ${m}.${e}`, kind: 'epic', parentId: node.id,
        servesCriterionId: crits[e % crits.length]?.id,
      });
      await updateTodo(project, epic.id, { status: 'done' });
    }
  }
}

describe('listMissions query budget', () => {
  it('does not fan out per criterion — adding criteria must not multiply queries', async () => {
    await buildGraph(2, 3, 1);
    listMissions(project); // warm any prepared-statement/DDL setup out of the measurement
    const few = countQueries(() => { listMissions(project); });

    // Same graph, same epics, many more criteria. The land-record and ledger reads depend on
    // the EPIC, so criteria must not multiply them.
    _closeProject(project);
    project = mkdtempSync(join(tmpdir(), 'lm-budget-'));
    await buildGraph(2, 3, 8);
    listMissions(project);
    const many = countQueries(() => { listMissions(project); });

    // 8x the criteria previously meant ~8x the land-record reads per epic. The batched read
    // is per-epic, so more criteria must cost only the extra criterion rows themselves.
    expect(many).toBeLessThan(few * 1.4);
  });

  it('stays within a per-mission budget rather than re-scanning the whole graph', async () => {
    const MISSIONS = 6;
    await buildGraph(MISSIONS, 3, 3);
    listMissions(project);
    const n = countQueries(() => { listMissions(project); });

    // MEASURED after the fix: 36 queries for this graph, 6 per mission. Was ~95 per mission.
    // The ceiling is calibrated to the fixed cost, not to the bug — a loose bound here passed
    // happily with the N+1 restored, which is how a budget test becomes decorative.
    expect(n).toBeLessThan(MISSIONS * 7);
  });
});
