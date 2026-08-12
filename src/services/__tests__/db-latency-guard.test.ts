/**
 * The tripwire has to catch the SHAPE of the defect that killed the sidecar 477 times: one
 * synchronous statement holding the event loop long enough that /api/health cannot be answered.
 *
 * These tests use a fake clock rather than real slow queries — a test that has to actually block
 * for 250ms to prove the guard works is a test that adds 250ms to every run, and one that would
 * go flaky on a loaded box. The guard's contract is "compare elapsed against budget", so the clock
 * is the right seam.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  instrumentDatabase, expectNoSlowQueries, slowQueries, clearSlowQueries,
  SlowQueryError, DEFAULT_QUERY_BUDGET_MS,
} from '../db-latency-guard';

/** A clock the test drives: each read advances by `step`, so one call spans exactly `step` ms. */
function fakeClock(step: number) {
  let t = 0;
  return () => { const v = t; t += step; return v; };
}

function seeded(): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
  for (let i = 0; i < 50; i++) ins.run(`row-${i}`);
  return db;
}

beforeEach(() => clearSlowQueries());

describe('it catches a statement that holds the loop', () => {
  it('records an over-budget query, with its SQL and row count', () => {
    const db = seeded();
    instrumentDatabase(db, { budgetMs: 100, now: fakeClock(5000), onSlow: () => {} });

    db.query('SELECT * FROM t').all();

    expect(slowQueries()).toHaveLength(1);
    expect(slowQueries()[0]!.sql).toContain('SELECT * FROM t');
    expect(slowQueries()[0]!.ms).toBe(5000);
    expect(slowQueries()[0]!.rows).toBe(50); // the row count is the usual smoking gun
  });

  it('says nothing about a query inside budget', () => {
    const db = seeded();
    instrumentDatabase(db, { budgetMs: 100, now: fakeClock(1), onSlow: () => {} });
    db.query('SELECT * FROM t').all();
    expect(slowQueries()).toHaveLength(0);
  });

  it('covers exec, and prepare/run as well as query/all', () => {
    const db = seeded();
    instrumentDatabase(db, { budgetMs: 10, now: fakeClock(999), onSlow: () => {} });

    db.exec('UPDATE t SET v = v');                       // exec
    db.prepare('INSERT INTO t (v) VALUES (?)').run('x');  // prepare + run
    db.query('SELECT COUNT(*) c FROM t').get();           // query + get

    expect(slowQueries().map((q) => q.sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT', 'SELECT']);
  });

  it('instruments the handle IN PLACE, so a cached handle is covered too', () => {
    // Stores hand out one cached Database per project. Returning an instrumented COPY would leave
    // every existing holder on the raw handle, which is the whole population that matters.
    const db = seeded();
    const returned = instrumentDatabase(db, { budgetMs: 10, now: fakeClock(999), onSlow: () => {} });
    expect(returned).toBe(db);
  });

  it('does not double-count when wrapped twice', () => {
    const db = seeded();
    instrumentDatabase(db, { budgetMs: 10, now: fakeClock(999), onSlow: () => {} });
    instrumentDatabase(db, { budgetMs: 10, now: fakeClock(999), onSlow: () => {} });
    db.query('SELECT 1').get();
    expect(slowQueries()).toHaveLength(1);
  });

  it('leaves results untouched — an observer must not change the answer', () => {
    const db = seeded();
    instrumentDatabase(db, { budgetMs: 10, now: fakeClock(999), onSlow: () => {} });
    expect((db.query('SELECT COUNT(*) c FROM t').get() as { c: number }).c).toBe(50);
    expect((db.query('SELECT v FROM t WHERE id = 1').get() as { v: string }).v).toBe('row-0');
  });
});

describe('expectNoSlowQueries — the CI half', () => {
  it('stays silent when nothing is over budget, and returns the value', () => {
    const db = seeded();
    const rows = expectNoSlowQueries(db, 10_000, () => db.query('SELECT * FROM t').all());
    expect(rows).toHaveLength(50); // the assertion must not swallow or alter the result
  });

  it('THROWS on an over-budget statement, naming the SQL and why it matters', () => {
    // A negative budget makes any measurable statement trip it. That is deliberate: proving the
    // failure path with a genuinely slow query would mean writing a slow test.
    const db = seeded();
    let caught: SlowQueryError | undefined;
    try {
      expectNoSlowQueries(db, -1, () => db.query('SELECT * FROM t').all());
    } catch (e) { caught = e as SlowQueryError; }

    expect(caught).toBeInstanceOf(SlowQueryError);
    expect(caught!.message).toContain('SELECT * FROM t');   // which statement
    expect(caught!.message).toContain('held the event loop'); // and what it cost
    expect(caught!.message).toContain('liveness watchdog');   // and why that is fatal
    expect(caught!.query.rows).toBe(50);
  });

  it('reports the WORST offender when several trip', () => {
    // Durations come from a CONTROLLED clock, not from how long the queries really take. An
    // earlier version of this test assumed the 50-row scan would outrun the 1-row one; under
    // a loaded box that is simply untrue, and it went red in the full gate while passing alone.
    // Which statement is slowest is the thing under test, so it must be the thing we set.
    const db = seeded();
    let t = 0;
    const ticks = [0, 10, 100, 900]; // start/end of the small query, then of the big one
    let i = 0;
    const now = () => { t = ticks[i] ?? t; i++; return t; };

    let caught: SlowQueryError | undefined;
    try {
      expectNoSlowQueries(db, 50, () => {
        db.query('SELECT id FROM t LIMIT 1').all(); // 10ms — under budget
        db.query('SELECT * FROM t').all();          // 800ms — the offender
      }, { now });
    } catch (e) { caught = e as SlowQueryError; }

    // Naming the slowest is what makes the failure actionable; first-seen would often finger an
    // innocent statement that merely ran earlier.
    expect(caught).toBeInstanceOf(SlowQueryError);
    expect(caught!.query.ms).toBe(800);
    expect(caught!.query.sql).toContain('SELECT * FROM t');
  });
});

describe('the budget itself', () => {
  it('defaults well below the watchdog threshold', () => {
    // The watchdog probes every 15s and kills after 45s. A budget anywhere near those numbers
    // would only fire once the server was already being killed; it has to catch the routine
    // blocking that accumulates into that, not the fatal instance.
    expect(DEFAULT_QUERY_BUDGET_MS).toBeLessThan(1000);
  });
});
