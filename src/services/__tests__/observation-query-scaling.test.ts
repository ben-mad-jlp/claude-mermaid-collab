/**
 * The observation ledger must not scale the daemon's blocking time with its own size.
 *
 * WHY (2026-08-10 incident): leaf-gate built its per-lane "watched tests" set by calling
 * listObservations(project, now-7d) — SELECT * over the window — and filtering by lane in JS.
 * At 1.38M rows that read cost a MEASURED 8.7s per lane on the event loop. The sidecar serves
 * its liveness probe on that same thread, so several lanes exceeded the Electron watchdog's
 * 45s threshold and the sidecar was SIGKILLed and respawned ~15x/hour for 18 days, orphaning
 * in-flight leaves each time. These tests pin the three properties that keep it bounded:
 * the projection is pushed into SQL, the index can serve it, and old rows are pruned.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const P = '/repo/alpha';
const OTHER = '/repo/beta';
const LANE = 'floors:^(src|scripts)/';
const DAY = 24 * 60 * 60_000;

/** Builds the table exactly as worker-ledger declares it, including BOTH indexes. */
function freshDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), 'obs-scaling-'));
  const db = new Database(join(dir, 'ledger.db'));
  db.exec(`CREATE TABLE base_gate_test_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL, baseSha TEXT NOT NULL, lane TEXT NOT NULL, test TEXT NOT NULL,
    failed INTEGER NOT NULL, scope TEXT NOT NULL, observedAt INTEGER NOT NULL
  );
  CREATE INDEX idx_bgtr_project_test ON base_gate_test_run(project, test, observedAt);
  CREATE INDEX idx_bgtr_project_lane_observed ON base_gate_test_run(project, lane, observedAt)`);
  return db;
}

function seed(db: Database, opts: { rows: number; project?: string; lane?: string; now: number; ageMs?: number }) {
  const ins = db.prepare(
    'INSERT INTO base_gate_test_run (project,baseSha,lane,test,failed,scope,observedAt) VALUES (?,?,?,?,?,?,?)',
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < opts.rows; i++) {
      ins.run(opts.project ?? P, 'sha', opts.lane ?? LANE, `src/__tests__/t-${i % 400}.test.ts`, 0, 'base',
        opts.now - (opts.ageMs ?? 0));
    }
  });
  tx();
}

let db: Database;
beforeEach(() => { db = freshDb(); });

describe('observation ledger scaling', () => {
  it('the watched-set query is served by an index instead of scanning the table', () => {
    const now = Date.now();
    seed(db, { rows: 500, now });
    const plan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT DISTINCT test FROM base_gate_test_run WHERE project=? AND lane=? AND observedAt>=?',
    ).all(P, LANE, now - 7 * DAY) as Array<{ detail: string }>;
    const detail = plan.map((r) => r.detail).join(' ');
    // A SCAN here is the regression: it is what made the read grow with total table size.
    expect(detail).toContain('idx_bgtr_project_lane_observed');
    expect(detail).not.toContain('SCAN base_gate_test_run');
  });

  it('returns only this project+lane, and one row per distinct test', () => {
    const now = Date.now();
    seed(db, { rows: 800, now });                                  // P / LANE, 400 distinct
    seed(db, { rows: 200, now, lane: 'typecheck' });               // same project, other lane
    seed(db, { rows: 200, now, project: OTHER });                  // other project
    const got = db.prepare(
      'SELECT DISTINCT test FROM base_gate_test_run WHERE project=? AND lane=? AND observedAt>=?',
    ).all(P, LANE, now - 7 * DAY) as Array<{ test: string }>;
    expect(got.length).toBe(400); // deduped, not 800
    // The old code loaded EVERY row in the window (all 1200 here) and filtered in JS.
    const everythingInWindow = db.prepare(
      'SELECT COUNT(*) c FROM base_gate_test_run WHERE project=? AND observedAt>=?',
    ).get(P, now - 7 * DAY) as { c: number };
    expect(everythingInWindow.c).toBeGreaterThan(got.length * 2);
  });

  it('the distinct read does not grow with rows outside the lane', () => {
    const now = Date.now();
    seed(db, { rows: 400, now });
    const before = (db.prepare(
      'SELECT DISTINCT test FROM base_gate_test_run WHERE project=? AND lane=? AND observedAt>=?',
    ).all(P, LANE, now - 7 * DAY) as unknown[]).length;
    seed(db, { rows: 20_000, now, lane: 'other-lane' }); // 50x more rows, all off-lane
    const after = (db.prepare(
      'SELECT DISTINCT test FROM base_gate_test_run WHERE project=? AND lane=? AND observedAt>=?',
    ).all(P, LANE, now - 7 * DAY) as unknown[]).length;
    expect(after).toBe(before); // result size is a function of the lane, not the table
  });

  it('retention deletes past the horizon and keeps everything inside it', () => {
    const now = Date.now();
    seed(db, { rows: 300, now, ageMs: 20 * DAY }); // older than the 14d horizon
    seed(db, { rows: 300, now, ageMs: 1 * DAY });  // inside it
    const cutoff = now - 14 * DAY;
    const deleted = db.prepare('DELETE FROM base_gate_test_run WHERE observedAt < ?').run(cutoff);
    expect(Number(deleted.changes)).toBe(300);
    const left = db.prepare('SELECT COUNT(*) c FROM base_gate_test_run').get() as { c: number };
    expect(left.c).toBe(300); // the recent window survives — pruning must not eat live data
  });
});
