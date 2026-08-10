/**
 * leaf-claim-store.ts — who is executing which leaf, and until when.
 *
 * REPLACES the global `leaf_inflight` table. That table lived in
 * `~/.mermaid-collab/worker-ledger.db` while the leaf it described lived in the project's own
 * database, so nothing could enforce agreement between them and they drifted: measured live on
 * 2026-08-10 at 14:49, `todos` reported 2 leaves `in_progress` holding claims while
 * `leaf_inflight` held ZERO rows. Two UI surfaces disagreed and both were honest — they were
 * reading different stores. `leaf_claim` lives in the project database with a real
 * `REFERENCES todos(id) ON DELETE CASCADE`, so "a claimed leaf exists" is an engine invariant
 * rather than something application code is trusted to remember.
 *
 * And it EXPIRES. `leaf_inflight` had no deadline, and the daemon is SIGKILLed by its liveness
 * watchdog (477 times in the 18 days to 2026-08-10). SIGKILL runs no `finally`, so a claim could
 * outlive its holder forever and every such leaf had to be reset by hand. A claim is a LEASE: the
 * question a reader asks is not "is there a row" but "is there a row that has not expired".
 *
 * THE INDEX IS NOT THE TRUTH. About ten call sites ask cross-project questions ("is this leafId
 * live?", "which projects have something running?") without holding a project path. Answering
 * those by scanning the project registry is exactly the fan-out that has saturated this box
 * before, so a global `leaf_claim_index(leafId → project)` sits in the ledger purely as a
 * pointer. Rules, all load-bearing:
 *   - it is written alongside every acquire and every release;
 *   - when it disagrees with a project database, THE PROJECT DATABASE WINS — the index only ever
 *     answers "which project should I open", never "is this claim live";
 *   - it is fully rebuildable from the project databases (`rebuildClaimIndex`), so losing it costs
 *     a rebuild, not correctness;
 *   - an index row pointing at a project with no matching claim reads as NOT live and is dropped
 *     opportunistically by the reader that noticed.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openCollabDb } from './collab-db';
import { canonicalProjectRootLoose, storePath } from './store-paths';

/**
 * Default lease: 45 minutes.
 *
 * FLOOR — it must exceed the slowest LEGITIMATE gap between two refreshes of the claim. The claim
 * is re-stamped when a node starts, so the gap is one node's wall clock plus the executor work
 * between nodes. The longest node cap shipped is `IMPLEMENT_TIMEOUT_MS` = 30min
 * (leaf-node-profile.ts), and between nodes the executor merges to the epic and can sit through a
 * full base gate. Anything at or under ~35min would let a healthy long implement node lose its own
 * leaf to the reaper mid-build, which is strictly worse than the bug being fixed.
 *
 * CEILING — a holder killed by SIGKILL strands its leaf for exactly one lease, so this is the
 * worst-case time-to-recovery. It is a BACKSTOP, not the normal path: a restarted daemon reclaims
 * foreign-epoch claims within a tick (`reapStaleInflight`), and a same-epoch run that died without
 * clearing is caught by the orphan sweep. The lease only has to cover the case nothing else does —
 * a machine that stays down, or a daemon that never comes back.
 *
 * 45min = 30min floor + 50% headroom, and bounds an unattended strand at under an hour.
 */
export const LEAF_CLAIM_LEASE_MS = 45 * 60 * 1000;

export interface ClaimRow {
  leafId: string;
  project: string;
  holder: string;
  epicId: string | null;
  acquiredAt: number;
  expiresAt: number;
  heartbeatAt: number;
  epoch: string | null;
  nodeKind: string | null;
  model: string | null;
  attempt: number | null;
}

export interface AcquireClaimArgs {
  project: string;
  leafId: string;
  holder: string;
  epicId?: string | null;
  leaseMs?: number;
  epoch?: string | null;
  nodeKind?: string | null;
  model?: string | null;
  attempt?: number | null;
}

// --- the global pointer index -------------------------------------------------------------

let indexDb: Database | null = null;

/**
 * The index shares the ledger FILE but not the ledger's connection: worker-ledger imports this
 * module, so reaching back for its handle would close an import cycle, and a cycle here means a
 * TDZ crash that only reproduces when the file is loaded alone. Two connections on one WAL
 * database is fine — readers never block — but two WRITERS can collide, so this handle carries a
 * busy timeout. The ledger's own handle has none, which is safe only because these writes are
 * single-row and sub-millisecond.
 */
function openIndexDb(): Database {
  if (indexDb) return indexDb;
  const path = storePath('workerLedger');
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA busy_timeout = 5000');
  d.exec(`CREATE TABLE IF NOT EXISTS leaf_claim_index (
    leafId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  )`);
  d.exec('CREATE INDEX IF NOT EXISTS idx_leaf_claim_index_project ON leaf_claim_index(project)');
  indexDb = d;
  return d;
}

/** Test-only: drop the index handle so a new MERMAID_SUPERVISOR_DIR is picked up. */
export function _closeClaimIndexDb(): void {
  try { indexDb?.close(); } catch { /* ignore */ }
  indexDb = null;
}

function indexPut(project: string, leafId: string, now: number): void {
  openIndexDb().prepare(
    `INSERT INTO leaf_claim_index (leafId, project, updatedAt) VALUES (?,?,?)
     ON CONFLICT(leafId) DO UPDATE SET project=excluded.project, updatedAt=excluded.updatedAt`,
  ).run(leafId, project, now);
}

function indexDrop(leafId: string): void {
  openIndexDb().prepare('DELETE FROM leaf_claim_index WHERE leafId = ?').run(leafId);
}

/** The project a leafId was last claimed in, per the index. A HINT — the caller must still
 *  confirm against that project's database, which is the authority. */
export function indexedProjectFor(leafId: string): string | null {
  const row = openIndexDb()
    .prepare('SELECT project FROM leaf_claim_index WHERE leafId = ?')
    .get(leafId) as { project?: string } | undefined;
  return row?.project ?? null;
}

/** Every project the index believes holds at least one claim. The set of databases a
 *  cross-project question has to open — deliberately NOT the project registry. */
export function indexedProjects(): string[] {
  const rows = openIndexDb()
    .prepare('SELECT DISTINCT project FROM leaf_claim_index')
    .all() as Array<{ project: string }>;
  return rows.map((r) => r.project);
}

// --- claims --------------------------------------------------------------------------------

function claimDb(project: string): Database {
  return openCollabDb(canonicalProjectRootLoose(project));
}

const CLAIM_COLS = 'leafId, holder, epicId, acquiredAt, expiresAt, heartbeatAt, epoch, nodeKind, model, attempt';

function rowToClaim(project: string, r: Record<string, unknown>): ClaimRow {
  return {
    leafId: r.leafId as string,
    project,
    holder: r.holder as string,
    epicId: (r.epicId as string) ?? null,
    acquiredAt: r.acquiredAt as number,
    expiresAt: r.expiresAt as number,
    heartbeatAt: r.heartbeatAt as number,
    epoch: (r.epoch as string) ?? null,
    nodeKind: (r.nodeKind as string) ?? null,
    model: (r.model as string) ?? null,
    attempt: (r.attempt as number) ?? null,
  };
}

/**
 * Take (or renew) the lease on a leaf. Returns false when a LIVE claim is held by someone else.
 *
 * The whole guard is the `WHERE` on the upsert's conflict branch, and it runs inside SQLite's
 * own statement atomicity — a read-then-write in TypeScript would let two daemons both observe
 * "expired" and both win. Two ways to take an occupied row, and only two: the existing lease has
 * EXPIRED, or the holder is already you (a node boundary re-stamping its own claim, which must
 * not be mistaken for a steal).
 *
 * Throws if `leafId` is not a row in `todos` — that is the foreign key doing its job, and it is
 * the drift this table exists to make unrepresentable. Callers on the telemetry path swallow it.
 */
export function acquireClaim(a: AcquireClaimArgs, now: number = Date.now()): boolean {
  const project = canonicalProjectRootLoose(a.project);
  const expiresAt = now + (a.leaseMs ?? LEAF_CLAIM_LEASE_MS);
  const res = claimDb(project).prepare(
    `INSERT INTO leaf_claim (${CLAIM_COLS})
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(leafId) DO UPDATE SET
       holder=excluded.holder, epicId=excluded.epicId, acquiredAt=excluded.acquiredAt,
       expiresAt=excluded.expiresAt, heartbeatAt=excluded.heartbeatAt, epoch=excluded.epoch,
       nodeKind=excluded.nodeKind, model=excluded.model, attempt=excluded.attempt
     WHERE leaf_claim.expiresAt <= ? OR leaf_claim.holder = excluded.holder`,
  ).run(
    a.leafId, a.holder, a.epicId ?? null, now, expiresAt, now, a.epoch ?? null,
    a.nodeKind ?? null, a.model ?? null, a.attempt ?? null,
    now,
  );
  const acquired = (res.changes ?? 0) > 0;
  if (acquired) indexPut(project, a.leafId, now);
  return acquired;
}

/**
 * Push the deadline out. Refuses on an ALREADY-EXPIRED claim: once a lease lapses the leaf is
 * fair game, and a heartbeat that could resurrect it would let a dead-then-revived holder stamp
 * over whoever legitimately took over. Recovery from an expired lease is `acquireClaim`, which
 * checks ownership; heartbeat is only for a claim you demonstrably still hold.
 */
export function heartbeatClaim(
  project: string,
  leafId: string,
  leaseMs: number = LEAF_CLAIM_LEASE_MS,
  now: number = Date.now(),
): boolean {
  const canon = canonicalProjectRootLoose(project);
  const res = claimDb(canon).prepare(
    'UPDATE leaf_claim SET expiresAt = ?, heartbeatAt = ? WHERE leafId = ? AND expiresAt > ?',
  ).run(now + leaseMs, now, leafId, now);
  const ok = (res.changes ?? 0) > 0;
  if (ok) indexPut(canon, leafId, now);
  return ok;
}

/** Give the leaf back (node finished, leaf terminal). Idempotent. */
export function releaseClaim(project: string, leafId: string): void {
  claimDb(project).prepare('DELETE FROM leaf_claim WHERE leafId = ?').run(leafId);
  indexDrop(leafId);
}

/**
 * Is this leaf actually being executed right now? Three facts, all required: a claim row exists,
 * its lease has not lapsed, and — when the caller passes an `epoch` — it was written by that
 * process. The epoch check is what keeps a phantom from a dead daemon from shielding a leaf that
 * nothing is running.
 */
export function isClaimLive(
  project: string,
  leafId: string,
  epoch?: string | null,
  now: number = Date.now(),
): boolean {
  const row = claimDb(project)
    .prepare('SELECT expiresAt, epoch FROM leaf_claim WHERE leafId = ?')
    .get(leafId) as { expiresAt: number; epoch: string | null } | undefined;
  if (!row) return false;
  if (row.expiresAt <= now) return false;
  if (epoch !== undefined && row.epoch !== epoch) return false;
  return true;
}

/** One project's claims, live ones only. */
function liveClaimsIn(project: string, now: number): ClaimRow[] {
  const rows = claimDb(project)
    .prepare(`SELECT ${CLAIM_COLS} FROM leaf_claim WHERE expiresAt > ? ORDER BY acquiredAt DESC`)
    .all(now) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToClaim(canonicalProjectRootLoose(project), r));
}

/**
 * LIVE claims. With `project`, one database. Without, the index says which databases to open —
 * a registry scan on this path is what produced the load incidents this design is avoiding.
 *
 * An index row whose project holds NO claim row at all is a leftover (a claim released by a
 * process that died between the two writes, or an index that outlived a dropped project); it
 * reads as not-live and is dropped here, which is the only cleanup this stale-row class needs.
 */
export function listClaims(opts: { project?: string; now?: number } = {}): ClaimRow[] {
  const now = opts.now ?? Date.now();
  if (opts.project) {
    try { return liveClaimsIn(opts.project, now); } catch { return []; }
  }
  const out: ClaimRow[] = [];
  for (const project of indexedProjects()) {
    let claims: ClaimRow[];
    let all: Set<string>;
    try {
      claims = liveClaimsIn(project, now);
      all = new Set(allClaimIds(project));
    } catch {
      continue; // unopenable project database — the index keeps pointing, we just cannot answer
    }
    out.push(...claims);
    for (const r of indexRowsFor(project)) {
      if (!all.has(r.leafId)) indexDrop(r.leafId); // pointer to a claim that is not there
    }
  }
  return out.sort((a, b) => b.acquiredAt - a.acquiredAt);
}

function indexRowsFor(project: string): Array<{ leafId: string }> {
  return openIndexDb()
    .prepare('SELECT leafId FROM leaf_claim_index WHERE project = ?')
    .all(project) as Array<{ leafId: string }>;
}

function allClaimIds(project: string): string[] {
  return (claimDb(project).prepare('SELECT leafId FROM leaf_claim').all() as Array<{ leafId: string }>)
    .map((r) => r.leafId);
}

/**
 * EVERY claim, expired and foreign-epoch included. The reapers need to see the rows they are
 * about to delete, which `listClaims` by construction hides. Not for liveness questions.
 */
export function listAllClaims(opts: { project?: string } = {}): ClaimRow[] {
  const projects = opts.project ? [canonicalProjectRootLoose(opts.project)] : indexedProjects();
  const out: ClaimRow[] = [];
  for (const project of projects) {
    try {
      const rows = claimDb(project)
        .prepare(`SELECT ${CLAIM_COLS} FROM leaf_claim ORDER BY acquiredAt DESC`)
        .all() as Array<Record<string, unknown>>;
      for (const r of rows) out.push(rowToClaim(project, r));
    } catch { /* unopenable project database — skip */ }
  }
  return out;
}

/** Delete a claim without going through the ownership rules. For the reapers only. */
export function forceReleaseClaim(project: string, leafId: string): void {
  try { releaseClaim(project, leafId); } catch { indexDrop(leafId); }
}

/** Drop every lapsed lease in one project. The routine recovery path for a holder that died
 *  without releasing; returns how many leaves were freed. */
export function reapExpiredClaims(project: string, now: number = Date.now()): number {
  const canon = canonicalProjectRootLoose(project);
  const doomed = (claimDb(canon)
    .prepare('SELECT leafId FROM leaf_claim WHERE expiresAt <= ?')
    .all(now) as Array<{ leafId: string }>).map((r) => r.leafId);
  for (const leafId of doomed) forceReleaseClaim(canon, leafId);
  return doomed.length;
}

/**
 * Rebuild the pointer index from the project databases — the recovery move whenever the index is
 * suspect, and the proof that it is derived data rather than state. Projects that cannot be
 * opened are skipped rather than fatal: a rebuild that refuses because one project is gone is a
 * rebuild nobody can run. Returns the number of pointers written.
 */
export function rebuildClaimIndex(projects: string[]): number {
  const d = openIndexDb();
  d.exec('DELETE FROM leaf_claim_index');
  const now = Date.now();
  let n = 0;
  for (const project of projects) {
    const canon = canonicalProjectRootLoose(project);
    let ids: string[];
    try { ids = allClaimIds(canon); } catch { continue; }
    for (const leafId of ids) { indexPut(canon, leafId, now); n++; }
  }
  return n;
}
