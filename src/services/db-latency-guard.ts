/**
 * db-latency-guard.ts — catch event-loop-blocking database work where it is cheap to fix.
 *
 * WHY THIS EXISTS. `bun:sqlite` is SYNCHRONOUS. Every query runs on the same thread that accepts
 * connections and answers `/api/health`, so a query that takes 30 seconds does not make the server
 * slow — it makes the server ABSENT. The Electron liveness watchdog probes health every 15s and
 * SIGKILLs the sidecar after 45s of no answer; between 2026-07-23 and 2026-08-10 it did so 477
 * times. Every one of those was a healthy server that was merely busy inside SQLite, killed
 * mid-transaction by a watchdog that cannot tell "blocked" from "dead" — because from outside the
 * process, and from inside it, those are the same thing. No timer fires either way.
 *
 * That is the point: a blocked loop is UNDIAGNOSABLE at the moment it happens. The only place to
 * catch it is at the query, before it has blocked anything, which is what this does. The measured
 * instance — a lane query materialising 1.38M rows, run once per quarantine record, 259 of them,
 * 30s per base gate against a 45s threshold — took stack sampling of a production stall to find.
 * A tripwire on the query would have named it in one test run.
 *
 * WHAT IT DOES NOT DO. It does not make anything async and it does not stop a slow query — by the
 * time the duration is known the loop has already been held. It converts an invisible production
 * symptom into a visible, attributable local one. Moving the work off-thread is the actual cure;
 * this is how you find out what to move, and how you keep it moved.
 */

/** Budget for a single statement. Above this the event loop is stalled long enough to matter:
 *  the watchdog probes every 15s, so even a few hundred ms of routine blocking accumulates into
 *  the multi-second probe latencies that precede a kill. */
export const DEFAULT_QUERY_BUDGET_MS = 250;

export interface SlowQuery {
  sql: string;
  ms: number;
  /** Rows returned, when the call reports them. A large count is the usual culprit. */
  rows?: number;
}

export class SlowQueryError extends Error {
  readonly code = 'slow-query';
  constructor(readonly query: SlowQuery, budgetMs: number) {
    super(
      `slow-query: a single statement held the event loop for ${query.ms.toFixed(0)}ms ` +
      `(budget ${budgetMs}ms)${query.rows !== undefined ? `, returning ${query.rows} rows` : ''}. ` +
      `bun:sqlite is synchronous, so this time is stolen from /api/health and everything else — ` +
      `the liveness watchdog SIGKILLs the sidecar after 45s of silence. ` +
      `SQL: ${query.sql.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
    );
    this.name = 'SlowQueryError';
  }
}

/** Minimal shape we instrument. Kept structural so tests need no real Database. */
// `never[]` rest params, not `unknown[]`: parameter types are CONTRAVARIANT, so a signature
// declaring `...rest: unknown[]` is NOT satisfied by bun's `...bindings: SQLQueryBindings[]`.
// never[] is assignable to any array type, which is what makes a real Database fit this shape.
interface StatementLike {
  run?: (...a: never[]) => unknown;
  get?: (...a: never[]) => unknown;
  all?: (...a: never[]) => unknown;
  values?: (...a: never[]) => unknown;
}
interface DatabaseLike {
  exec: (sql: string, ...rest: never[]) => unknown;
  query: (sql: string) => StatementLike;
  prepare: (sql: string, ...rest: never[]) => StatementLike;
}

export interface LatencyGuardOpts {
  budgetMs?: number;
  /** Called for every statement over budget. Throwing from here propagates to the caller. */
  onSlow?: (q: SlowQuery) => void;
  now?: () => number;
}

const observed: SlowQuery[] = [];

/** Every over-budget statement seen in this process, newest last. */
export function slowQueries(): readonly SlowQuery[] {
  return observed;
}
export function clearSlowQueries(): void {
  observed.length = 0;
}

function record(q: SlowQuery, opts: Required<Pick<LatencyGuardOpts, 'budgetMs'>> & LatencyGuardOpts): void {
  observed.push(q);
  if (opts.onSlow) opts.onSlow(q); // may throw — that is how strict mode fails a test
  else console.warn(new SlowQueryError(q, opts.budgetMs).message);
}

/**
 * Wrap a database so every statement is timed. Returns the SAME object, mutated: callers hold
 * handles from a cache and re-wrapping a copy would leave the originals uninstrumented.
 * Idempotent — wrapping twice does not double-count.
 */
export function instrumentDatabase<T extends DatabaseLike>(db: T, opts: LatencyGuardOpts = {}): T {
  const marked = db as T & { __latencyGuarded?: boolean };
  if (marked.__latencyGuarded) return db;
  marked.__latencyGuarded = true;

  const budgetMs = opts.budgetMs ?? DEFAULT_QUERY_BUDGET_MS;
  const now = opts.now ?? (() => performance.now());
  const cfg = { ...opts, budgetMs };

  // Re-entrancy depth. bun:sqlite implements some accessors on top of others — `get()` runs
  // through the same path as `all()` — so a naive wrapper counts one caller-visible statement
  // twice and reports its duration twice over. Only the OUTERMOST call is a real statement.
  let depth = 0;

  const timed = <A extends unknown[], R>(sql: string, fn: (...a: A) => R) => (...a: A): R => {
    if (depth > 0) return fn(...a);
    depth++;
    const t0 = now();
    try {
      const out = fn(...a);
      const ms = now() - t0;
      if (ms > budgetMs) record({ sql, ms, rows: Array.isArray(out) ? out.length : undefined }, cfg);
      return out;
    } finally {
      depth--;
    }
  };

  const wrapStatement = (stmt: StatementLike, sql: string): StatementLike => {
    // bun:sqlite's query() returns a CACHED statement per sql string. Without this marker,
    // every query(sql) call stacks another timing layer onto the same cached statement's
    // methods — the chain grows one frame per call until hot statements burn CPU walking
    // it and eventually throw "Maximum call stack size exceeded" (observed killing every
    // conductor pass after ~2 days of uptime).
    const marked = stmt as StatementLike & { __latencyWrapped?: boolean };
    if (marked.__latencyWrapped) return stmt;
    marked.__latencyWrapped = true;
    for (const m of ['run', 'get', 'all', 'values'] as const) {
      const orig = stmt[m];
      if (typeof orig === 'function') stmt[m] = timed(sql, orig.bind(stmt)) as never;
    }
    return stmt;
  };

  const origExec = db.exec.bind(db);
  db.exec = ((sql: string, ...rest: never[]) => timed(sql, origExec)(sql, ...rest)) as T['exec'];

  for (const m of ['query', 'prepare'] as const) {
    const orig = db[m].bind(db);
    db[m] = ((sql: string, ...rest: never[]) =>
      wrapStatement(orig(sql, ...rest), sql)) as T[typeof m];
  }

  return db;
}

/**
 * Assert that `fn` issues no statement slower than `budgetMs`. This is the CI half: the class of
 * defect that killed the sidecar 477 times fails here, on the developer's machine, naming the SQL
 * — instead of in production as an unattributable SIGKILL with no stack.
 *
 * Uses a per-call budget rather than the global default so a test can hold a hot path to a much
 * tighter bound than routine code.
 */
export function expectNoSlowQueries<T>(
  db: DatabaseLike,
  budgetMs: number,
  fn: () => T,
  opts: { now?: () => number } = {},
): T {
  const hits: SlowQuery[] = [];
  instrumentDatabase(db, { budgetMs, now: opts.now, onSlow: (q) => { hits.push(q); } });
  const out = fn();
  if (hits.length > 0) {
    const worst = hits.reduce((a, b) => (b.ms > a.ms ? b : a));
    throw new SlowQueryError(worst, budgetMs);
  }
  return out;
}
