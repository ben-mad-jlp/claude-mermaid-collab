import Database from 'bun:sqlite';
import { fireOrchestratorKick } from './orchestrator-kick';
import { isClaimable } from './claimability';
import { resolveEscalationsForTodo } from './supervisor-store';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname } from 'node:os';
import { trackingProjectRoot } from './project-registry';

/**
 * Per-PROJECT todo store (Phase 0 of the todos upgrade — see design-todos-upgrade).
 * Replaces the per-session JSON files with a single bun:sqlite DB per project,
 * so a "managing session" can own/assign todos across sessions with a plain
 * query/write (no cross-store merge). Source of truth is local disk.
 */

export type TodoStatus = 'backlog' | 'planned' | 'todo' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'dropped';

export interface TodoLink {
  blueprintId: string;
  taskId?: string;
}

/** De-conflate refactor (S1): the in-progress claim collapsed to ONE value.
 *  in_progress ≡ claim != null. Physical: one new `claim TEXT NULL` (JSON) column,
 *  written/read only via writeClaim/readClaim. The 4 legacy columns
 *  (claimedBy/claimToken/claimedAt/claimLeaseMs) stay present (write-frozen behind
 *  the accessor) and are kept in lockstep until the deferred physical drop. */
export interface ClaimStruct {
  by: string;
  token: string;
  at: string;
  leaseMs: number;
}

/** Whether a todo's assignee is an autonomous agent (default) or a human.
 *  Attribution, NOT auth (B1): drives "who is expected to act / who acted". */
export type AssigneeKind = 'agent' | 'human';

export interface Todo {
  id: string;
  ownerSession: string;
  assigneeSession: string | null;
  /** Agent (default) vs human assignee. Existing rows backfill to 'agent'. */
  assigneeKind: AssigneeKind;
  title: string;
  description: string | null;
  status: TodoStatus;
  completed: boolean; // derived: status === 'done'
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string[];
  order: number;
  link: TodoLink | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  asanaGid: string | null;
  sessionName: string | null;
  /** The WORKER session that actually ran this todo — the pool lane the Coordinator
   *  launched for it. Distinct from `claimedBy` (always the coordinator's reservation
   *  lock) and from `sessionName` (overloaded: worker lane OR creating session).
   *  Persists across completion; the UI surfaces it as the "Executor". */
  executedBySession: string | null;
  blueprintId: string | null;
  /** Agent-profile type (frontend/backend/api/ui/library/…), or null = default. Drives worker launch params. */
  type: string | null;
  /** Absolute path of the repo this todo is IMPLEMENTED in, when that differs
   *  from the (tracking) project the todo lives in. null = same as tracking
   *  project. The Coordinator spawns the worker with cwd=this and runs the
   *  acceptance gate against this repo's change-set + manifest gate command. */
  targetProject: string | null;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  claimedBy: string | null;
  claimToken: string | null;
  claimedAt: string | null;
  claimLeaseMs: number | null;
  /** De-conflate S1 — the collapsed in-progress claim (JSON struct or null).
   *  null IFF any of the 4 legacy claim columns is null (the orphan class).
   *  in_progress ≡ claim != null. Read/written only via readClaim/writeClaim. */
  claim: ClaimStruct | null;
  /** De-conflate S1 — Planner approval decision (ISO) / audit handle. Written ONLY
   *  by the Planner approval verb. Null = not approved. Drives derived claimability. */
  approvedAt: string | null;
  approvedBy: string | null;
  /** De-conflate S1 — hold decision (ISO) + reason. Written by Steward/human and
   *  lease-exhaustion. Null = not held. The only honest stored "blocked". */
  heldAt: string | null;
  heldReason: string | null;
  retryCount: number;
  /** Opaque actor handle (e.g. 'local:<hostname>') recorded as the completer
   *  when a HUMAN todo is marked done — attribution, not auth (B1). Null for
   *  agent todos and for any todo not (yet) completed. One nullable string makes
   *  Layer C a backfill rather than a migration. */
  completedBy: string | null;
  /** One-directional FK → SystemObject.id (durable system-object this work-todo
   *  builds/changes). null = not object-linked. The work-vs-durable firewall
   *  (design §4): the link is the ONLY coupling — a durable object carries NO
   *  work-graph lifecycle (no status/claim/lease here on the object side). */
  objectRef: string | null;
  /** Readiness-gates P2: when this todo is a design/decision [GATE], the
   *  decision-record id whose approval auto-completes it. Null for non-gate todos
   *  and gates cleared manually. */
  decisionRef: string | null;
  /** Readiness-gates P4: an operator-env probe spec (e.g. 'tcp://127.0.0.1:8082'
   *  or 'http://host:port/health'). The Coordinator FILTERS this todo out of the
   *  claimable set at CLAIM time while the probe fails — auto-claimable once it
   *  passes, with NO status write and no stored cleared-bit. Null = no probe. */
  claimProbe: string | null;
}

export interface TodoFilter {
  session?: string; // matches owner OR assignee
  ownerSession?: string;
  assigneeSession?: string;
  status?: TodoStatus;
  includeCompleted?: boolean;
}

export interface CreateTodoInput {
  ownerSession: string;
  assigneeSession?: string | null;
  assigneeKind?: AssigneeKind;
  title: string;
  description?: string | null;
  status?: TodoStatus;
  priority?: 0 | 1 | 2 | 3 | 4 | null;
  dueDate?: string | null;
  parentId?: string | null;
  dependsOn?: string[];
  link?: TodoLink | null;
  sessionName?: string | null;
  executedBySession?: string | null;
  blueprintId?: string | null;
  type?: string | null;
  targetProject?: string | null;
  objectRef?: string | null;
  decisionRef?: string | null;
  claimProbe?: string | null;
}

export type UpdateTodoPatch = Partial<{
  title: string;
  description: string | null;
  status: TodoStatus;
  completed: boolean;
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string[];
  assigneeSession: string | null;
  assigneeKind: AssigneeKind;
  link: TodoLink | null;
  asanaGid: string | null;
  sessionName: string | null;
  executedBySession: string | null;
  blueprintId: string | null;
  type: string | null;
  targetProject: string | null;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  /** Explicit actor handle to record as completer. Normally left unset — a human
   *  completion auto-stamps 'local:<hostname>'. Set to null to clear. */
  completedBy: string | null;
  /** One-directional FK → SystemObject.id. Set to link this work-todo to a
   *  durable system-object; null to unlink. No lifecycle coupling (the firewall). */
  objectRef: string | null;
  decisionRef: string | null;
  claimProbe: string | null;
  /** De-conflate S1 (additive). Decision axes; readers ignore these until S3.
   *  `claim` is intentionally NOT patchable here — it is mutated only via writeClaim. */
  approvedAt: string | null;
  approvedBy: string | null;
  heldAt: string | null;
  heldReason: string | null;
}>;

interface TodoRow {
  id: string;
  ownerSession: string;
  assigneeSession: string | null;
  assigneeKind: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string;
  ord: number;
  link: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  asanaGid: string | null;
  sessionName: string | null;
  executedBySession: string | null;
  blueprintId: string | null;
  type: string | null;
  targetProject: string | null;
  acceptanceStatus: string | null;
  claimedBy: string | null;
  claimToken: string | null;
  claimedAt: string | null;
  claimLeaseMs: number | null;
  claim: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  heldAt: string | null;
  heldReason: string | null;
  retryCount: number;
  completedBy: string | null;
  objectRef: string | null;
  decisionRef: string | null;
  claimProbe: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  ownerSession TEXT NOT NULL,
  assigneeSession TEXT,
  assigneeKind TEXT NOT NULL DEFAULT 'agent',
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER,
  dueDate TEXT,
  parentId TEXT,
  dependsOn TEXT NOT NULL DEFAULT '[]',
  ord REAL NOT NULL,
  link TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  asanaGid TEXT,
  sessionName TEXT,
  executedBySession TEXT,
  blueprintId TEXT,
  type TEXT,
  targetProject TEXT,
  acceptanceStatus TEXT,
  claimedBy TEXT,
  claimToken TEXT,
  claimedAt TEXT,
  claimLeaseMs INTEGER,
  retryCount INTEGER NOT NULL DEFAULT 0,
  completedBy TEXT,
  objectRef TEXT,
  decisionRef TEXT,
  claimProbe TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(ownerSession);
CREATE INDEX IF NOT EXISTS idx_todos_assignee ON todos(assigneeSession);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
`;

function addColumnIfMissing(db: Database, table: string, col: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  // A worker whose cwd is its isolation worktree (<repo>/.collab/agent-sessions/...)
  // must resolve to the TRACKING repo's todos.db, never a worktree-local one — else
  // it opens an empty/absent db (silent 'no such table', or SQLITE_IOERR creating it
  // on a full disk) and the Coordinator's rows are invisible. See decision 20106f26.
  project = trackingProjectRoot(project);
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'todos.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  addColumnIfMissing(db, 'todos', 'sessionName', 'sessionName TEXT');
  addColumnIfMissing(db, 'todos', 'executedBySession', 'executedBySession TEXT');
  addColumnIfMissing(db, 'todos', 'blueprintId', 'blueprintId TEXT');
  addColumnIfMissing(db, 'todos', 'type', 'type TEXT');
  addColumnIfMissing(db, 'todos', 'targetProject', 'targetProject TEXT');
  addColumnIfMissing(db, 'todos', 'acceptanceStatus', 'acceptanceStatus TEXT');
  addColumnIfMissing(db, 'todos', 'claimedBy', 'claimedBy TEXT');
  addColumnIfMissing(db, 'todos', 'claimToken', 'claimToken TEXT');
  addColumnIfMissing(db, 'todos', 'claimedAt', 'claimedAt TEXT');
  addColumnIfMissing(db, 'todos', 'claimLeaseMs', 'claimLeaseMs INTEGER');
  addColumnIfMissing(db, 'todos', 'retryCount', 'retryCount INTEGER NOT NULL DEFAULT 0');
  // B1: human-vs-agent attribution. assigneeKind backfills existing rows to
  // 'agent' (backward compat); completedBy is the nullable actor handle.
  addColumnIfMissing(db, 'todos', 'assigneeKind', "assigneeKind TEXT NOT NULL DEFAULT 'agent'");
  addColumnIfMissing(db, 'todos', 'completedBy', 'completedBy TEXT');
  // Phase 2 §7.4: one-directional FK to a durable SystemObject. Nullable, NO
  // lifecycle columns — the work-vs-durable firewall (durable objects never
  // inherit the todo status/claim/lease ladder).
  addColumnIfMissing(db, 'todos', 'objectRef', 'objectRef TEXT');
  // Readiness-gates P2: nullable decision-record link on a design/decision gate.
  addColumnIfMissing(db, 'todos', 'decisionRef', 'decisionRef TEXT');
  // Readiness-gates P4: nullable operator-env probe spec for the claim-time filter.
  addColumnIfMissing(db, 'todos', 'claimProbe', 'claimProbe TEXT');
  // De-conflate Todo work-graph status (S1) — additive, nullable. The decision
  // axes (approval / hold) split out of the overloaded enum, and the in-progress
  // claim collapses to ONE JSON column. Readers are unchanged in S1; these are
  // populated by writeClaim + the one-shot backfill below, ignored until S3.
  addColumnIfMissing(db, 'todos', 'approvedAt', 'approvedAt TEXT');
  addColumnIfMissing(db, 'todos', 'approvedBy', 'approvedBy TEXT');
  addColumnIfMissing(db, 'todos', 'heldAt', 'heldAt TEXT');
  addColumnIfMissing(db, 'todos', 'heldReason', 'heldReason TEXT');
  addColumnIfMissing(db, 'todos', 'claim', 'claim TEXT');
  // One-shot backfill: enforce the claim invariant (claim fields non-null IFF
  // status==='in_progress') on rows written before the invariant was enforced.
  db.exec(
    `UPDATE todos SET ${CLAIM_CLEAR_SQL}, claim=NULL
     WHERE status != 'in_progress' AND (claimedBy IS NOT NULL OR claimToken IS NOT NULL OR claimedAt IS NOT NULL OR claimLeaseMs IS NOT NULL OR claim IS NOT NULL)`
  );
  // One-shot backfill: targetProject is now a TOTAL field — every todo belongs to
  // exactly one project. Legacy rows left it NULL (the old "same as tracking
  // project" override convention), which made the Bridge fall back to "whichever
  // DB it lives in" and combine cross-project todos into one diagram. Stamp every
  // NULL with this db's tracking project so the UI can partition by targetProject.
  db.prepare(`UPDATE todos SET targetProject = ? WHERE targetProject IS NULL`).run(project);
  // De-conflate S1 one-shot backfill, guarded by user_version so it runs exactly
  // once per DB and is a no-op on every subsequent open (idempotent).
  const ver = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (ver < TODO_DECONFLATE_V1) {
    backfillDeconflateV1(db);
    db.exec(`PRAGMA user_version = ${TODO_DECONFLATE_V1}`);
  }
  dbCache.set(project, db);
  return db;
}

/** user_version marker for the de-conflate S1 backfill (approvedAt/heldAt/claim). */
export const TODO_DECONFLATE_V1 = 1;

/**
 * One-shot, idempotent de-conflate S1 backfill (design-todo-model-refactor §S1).
 * Exported for unit-testing in isolation. Safe to re-run (re-running only
 * re-derives the same values), but normally gated by user_version in openDb.
 *
 *  - approvedAt (LOAD-BEARING): every pre-terminal-or-terminal row that the
 *    Planner must have approved (status left 'planned'/'backlog'/'todo' only when
 *    NOT approved) → approvedAt = updatedAt. planned/backlog/todo → leave NULL.
 *  - heldAt (existing 'blocked' rows): deps NOT satisfied → leave NULL (re-derives
 *    as deps-pending/dep-rejected). deps satisfied AND (retryCount>=MAX OR no open
 *    deps) → heldAt=updatedAt, heldReason='migrated-park'. Conservative: when
 *    ambiguous, SET the hold (a spurious hold is human-clearable).
 *  - claim (existing 'in_progress' rows): pack the 4 legacy cols; any null → NULL.
 *  - enum: untouched.
 *
 * Throws if the post-backfill approvedAt invariant is violated.
 */
export function backfillDeconflateV1(db: Database): void {
  // approvedAt: any row whose status implies it cleared the Planner's approval gate.
  db.exec(
    `UPDATE todos SET approvedAt = updatedAt
     WHERE approvedAt IS NULL
       AND status IN ('ready','blocked','in_progress','done','dropped')`
  );

  // heldAt: only existing 'blocked' rows are candidates. Recompute depsSatisfied
  // per-row in TS (depSatisfied keys on status==='done' && acceptanceStatus!='rejected').
  {
    const rows = db.query(
      `SELECT id, updatedAt, retryCount, dependsOn FROM todos WHERE status='blocked' AND heldAt IS NULL`
    ).all() as Array<{ id: string; updatedAt: string; retryCount: number; dependsOn: string }>;
    if (rows.length > 0) {
      // Build a status/acceptance map for dep resolution.
      const all = db.query(
        `SELECT id, status, acceptanceStatus FROM todos`
      ).all() as Array<{ id: string; status: string; acceptanceStatus: string | null }>;
      const byId = new Map(all.map((r) => [r.id, r]));
      const setHeld = db.prepare(
        `UPDATE todos SET heldAt=?, heldReason='migrated-park' WHERE id=?`
      );
      db.transaction(() => {
        for (const r of rows) {
          let deps: string[] = [];
          try { deps = JSON.parse(r.dependsOn); } catch { /* [] */ }
          const depsSatisfied = deps.every((d) => {
            const dep = byId.get(d);
            return depSatisfied(dep ? { status: dep.status as TodoStatus, acceptanceStatus: dep.acceptanceStatus as Todo['acceptanceStatus'] } : undefined);
          });
          if (!depsSatisfied) continue; // re-derives as deps-pending / dep-rejected
          const noOpenDeps = !deps.some((d) => {
            const dep = byId.get(d);
            // an "open" dep = a known dep that is not yet terminal
            return dep && dep.status !== 'done' && dep.status !== 'dropped';
          });
          if ((r.retryCount ?? 0) >= MAX_CLAIM_RETRIES || noOpenDeps) {
            setHeld.run(r.updatedAt, r.id);
          }
        }
      })();
    }
  }

  // claim: pack the 4 legacy cols for existing 'in_progress' rows. Any null → NULL.
  {
    const rows = db.query(
      `SELECT id, claimedBy, claimToken, claimedAt, claimLeaseMs FROM todos WHERE status='in_progress' AND claim IS NULL`
    ).all() as Array<{ id: string; claimedBy: string | null; claimToken: string | null; claimedAt: string | null; claimLeaseMs: number | null }>;
    const setClaim = db.prepare(`UPDATE todos SET claim=? WHERE id=?`);
    db.transaction(() => {
      for (const r of rows) {
        const c = packClaim(r.claimedBy, r.claimToken, r.claimedAt, r.claimLeaseMs);
        if (c) setClaim.run(JSON.stringify(c), r.id);
      }
    })();
  }

  // Post-backfill assertion (top risk #2): approved work must never go dormant.
  const orphanApprovals = (db.query(
    `SELECT COUNT(*) AS n FROM todos WHERE approvedAt IS NULL AND status NOT IN ('planned','backlog','todo')`
  ).get() as { n: number }).n;
  if (orphanApprovals !== 0) {
    throw new Error(`de-conflate backfill assertion failed: ${orphanApprovals} row(s) have approvedAt IS NULL but a non-pre-approval status`);
  }
}

/** For tests: drop the cached handle so a fresh dir opens a fresh DB. */
export function _closeProject(project: string): void {
  project = trackingProjectRoot(project);
  const db = dbCache.get(project);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    dbCache.delete(project);
  }
}

// Per-project serialized write lock (mirrors session-todos.ts withLock, keyed on project).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

const nowIso = () => new Date().toISOString();

/**
 * De-conflate S3 — the WRITE-SIDE translation seam, living in the store mutator so
 * it covers EVERY surface (HTTP routes, MCP tools, scripts) at one chokepoint.
 *
 * `ready`/`blocked`/`in_progress` are now DERIVED facts (claimability.ts), so a
 * caller hand-setting one of those as a stored status is incoherent. This rewrites
 * such a status-write into the equivalent DECISION-write and returns:
 *   - storedStatus: the value actually persisted to `status` (never a derived one)
 *   - decision overrides for approvedAt/approvedBy/heldAt/heldReason (undefined =
 *     "leave caller/existing value unchanged"; null = "clear")
 *
 * Mapping (MANUAL STATUS WRITES table):
 *   ready              → approve: approvedAt=now (+approvedBy), heldAt=null; keep status as-is/'planned'
 *   blocked            → hold:    heldAt=now, heldReason='manual';            keep status as-is/'planned'
 *   in_progress        → REJECT (throw) — a human inventing a claim is nonsensical
 *   planned|backlog|todo→ un-approve/park: approvedAt=null;                   status='planned'
 *   done|dropped       → real lifecycle move; unchanged
 *
 * Throws TranslatedInProgressError on an attempt to hand-set in_progress.
 */
export class ManualInProgressError extends Error {
  constructor() {
    super("cannot set status='in_progress' directly — claims are created by the daemon via claimTodo, not by a manual status write");
    this.name = 'ManualInProgressError';
  }
}

interface StatusTranslation {
  storedStatus: TodoStatus;
  approvedAt?: string | null;
  approvedBy?: string | null;
  heldAt?: string | null;
  heldReason?: string | null;
}

/**
 * Translate a requested status into (storedStatus + decision overrides).
 * `requested` is the status the caller asked for; `currentStatus` is the existing
 * row's status (so a derived-value write can leave it as-is rather than forcing it).
 * `approvedBy` is an optional audit handle for the approve verb.
 */
function translateStatusWrite(
  requested: TodoStatus,
  currentStatus: TodoStatus,
  approvedBy?: string | null,
): StatusTranslation {
  const ts = nowIso();
  switch (requested) {
    case 'ready':
      // "approve to run" — identical to the Planner's approve verb. Never store the
      // derived 'ready'; never leave it on a TERMINAL status (an un-complete routes
      // through 'ready' and must move the row off 'done'/'dropped' back to 'planned'
      // so it re-derives claimable). Otherwise keep the existing pre-terminal status.
      return {
        storedStatus: (currentStatus === 'ready' || currentStatus === 'done' || currentStatus === 'dropped')
          ? 'planned' : currentStatus,
        approvedAt: ts,
        ...(approvedBy != null ? { approvedBy } : {}),
        heldAt: null,
        heldReason: null,
      };
    case 'blocked':
      // "hold this" — the only honest manual blocked. Never store 'blocked'.
      return {
        storedStatus: currentStatus === 'blocked' ? 'planned' : currentStatus,
        heldAt: ts,
        heldReason: 'manual',
      };
    case 'in_progress':
      throw new ManualInProgressError();
    case 'planned':
    case 'backlog':
    case 'todo':
      // Pre-approval / pre-run values — NOT derived, so stored verbatim. They
      // represent "un-approved / parked pre-run", so clear the approval decision.
      return { storedStatus: requested, approvedAt: null };
    case 'done':
    case 'dropped':
    default:
      // real lifecycle move — unchanged.
      return { storedStatus: requested };
  }
}

/** Minimal default actor handle for a human completion when the caller didn't
 *  supply one. Opaque attribution string (B1) — host-scoped, not an identity. */
function defaultActorHandle(): string {
  try { return `local:${hostname()}`; } catch { return 'local:unknown'; }
}

/**
 * Pack the 4 legacy claim columns into a ClaimStruct, or null if ANY is null
 * (the orphan class — a half-set claim is treated as no claim). The single shared
 * helper behind readClaim and the backfill.
 */
function packClaim(by: string | null, token: string | null, at: string | null, leaseMs: number | null): ClaimStruct | null {
  if (by == null || token == null || at == null || leaseMs == null) return null;
  return { by, token, at, leaseMs };
}

/**
 * De-conflate S1 accessor (read). The single read path for the in-progress claim.
 * Prefers the new `claim` JSON column when present; otherwise derives from the 4
 * legacy columns (kept in lockstep by writeClaim). Returns null if any of the 4
 * legacy columns is null — the orphan class is unrepresentable as a live claim.
 */
export function readClaim(row: Pick<TodoRow, 'claim' | 'claimedBy' | 'claimToken' | 'claimedAt' | 'claimLeaseMs'>): ClaimStruct | null {
  if (row.claim) {
    try {
      const c = JSON.parse(row.claim) as ClaimStruct;
      if (c && c.by != null && c.token != null && c.at != null && c.leaseMs != null) return c;
    } catch { /* fall through to legacy cols */ }
  }
  return packClaim(row.claimedBy, row.claimToken, row.claimedAt, row.claimLeaseMs);
}

/**
 * De-conflate S1 accessor (write). The SINGLE mutator for the claim: sets ALL of
 * the 4 legacy columns AND the new `claim` JSON column in lockstep (or clears all
 * 5 on null). Routing every set/clear site through here makes a partial claim
 * unrepresentable by any code path. Pure refactor — identical to the old inline
 * `claimedBy=?,…` / `claimedBy=NULL,…` writes, plus the in-sync `claim` column.
 * Issues a standalone UPDATE on `id`; callers already hold the project write-lock.
 */
export function writeClaim(db: Database, id: string, claim: ClaimStruct | null): void {
  if (claim == null) {
    db.prepare(
      `UPDATE todos SET ${CLAIM_CLEAR_SQL} WHERE id=?`
    ).run(id);
  } else {
    db.prepare(
      `UPDATE todos SET claimedBy=?, claimToken=?, claimedAt=?, claimLeaseMs=?, claim=? WHERE id=?`
    ).run(claim.by, claim.token, claim.at, claim.leaseMs, JSON.stringify(claim), id);
  }
}

/** SQL fragment clearing all 5 claim columns in lockstep — for the sites where the
 *  clear MUST stay bundled into a single atomic UPDATE alongside a status change
 *  (behavior-identical to a separate writeClaim(db,id,null), one fewer write). */
const CLAIM_CLEAR_SQL = 'claimedBy=NULL, claimToken=NULL, claimedAt=NULL, claimLeaseMs=NULL, claim=NULL';

function rowToTodo(row: TodoRow): Todo {
  let dependsOn: string[] = [];
  try { dependsOn = JSON.parse(row.dependsOn); } catch { /* default [] */ }
  let link: TodoLink | null = null;
  if (row.link) { try { link = JSON.parse(row.link); } catch { /* null */ } }
  return {
    id: row.id,
    ownerSession: row.ownerSession,
    assigneeSession: row.assigneeSession,
    assigneeKind: (row.assigneeKind as AssigneeKind) ?? 'agent',
    title: row.title,
    description: row.description,
    status: row.status as TodoStatus,
    completed: row.status === 'done',
    priority: (row.priority as Todo['priority']) ?? null,
    dueDate: row.dueDate,
    parentId: row.parentId,
    dependsOn,
    order: row.ord,
    link,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    asanaGid: row.asanaGid,
    sessionName: row.sessionName ?? null,
    executedBySession: row.executedBySession ?? null,
    blueprintId: row.blueprintId ?? null,
    type: row.type ?? null,
    targetProject: row.targetProject ?? null,
    acceptanceStatus: (row.acceptanceStatus as Todo['acceptanceStatus']) ?? null,
    claimedBy: row.claimedBy ?? null,
    claimToken: row.claimToken ?? null,
    claimedAt: row.claimedAt ?? null,
    claimLeaseMs: row.claimLeaseMs ?? null,
    claim: readClaim(row),
    approvedAt: row.approvedAt ?? null,
    approvedBy: row.approvedBy ?? null,
    heldAt: row.heldAt ?? null,
    heldReason: row.heldReason ?? null,
    retryCount: row.retryCount ?? 0,
    completedBy: row.completedBy ?? null,
    objectRef: row.objectRef ?? null,
    decisionRef: row.decisionRef ?? null,
    claimProbe: row.claimProbe ?? null,
  };
}

export function getTodo(project: string, id: string): Todo | null {
  const db = openDb(project);
  const row = db.query('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | null;
  return row ? rowToTodo(row) : null;
}

export function listTodos(project: string, filter: TodoFilter = {}): Todo[] {
  const db = openDb(project);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.session) {
    // Session scope shows only todos OWNED by this session. Assigned-to-me
    // todos from other sessions used to leak in via OR — that surfaces noise
    // in the sidebar. Use the explicit `assigneeSession` filter (e.g. via
    // ManagerDashboard / a dedicated "assigned to me" view) when needed.
    where.push('ownerSession = ?');
    params.push(filter.session);
  }
  if (filter.ownerSession) { where.push('ownerSession = ?'); params.push(filter.ownerSession); }
  if (filter.assigneeSession) { where.push('assigneeSession = ?'); params.push(filter.assigneeSession); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (!filter.includeCompleted && !filter.status) { where.push("status != 'done'"); }
  const sql = `SELECT * FROM todos${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ord ASC`;
  const rows = db.query(sql).all(...(params as never[])) as TodoRow[];
  return rows.map(rowToTodo);
}

export function createTodo(project: string, input: CreateTodoInput): Promise<Todo> {
  return withLock(project, () => {
    const db = openDb(project);
    const maxOrd = (db.query('SELECT MAX(ord) AS m FROM todos').get() as { m: number | null }).m;
    const ord = maxOrd == null ? 10 : maxOrd + 10;
    const id = crypto.randomUUID();
    const ts = nowIso();
    // De-conflate S3 — WRITE-SIDE TRANSLATION SEAM (create path). A create that asks
    // for a derived status (ready/blocked/in_progress) is a decision, not a stored
    // status: translate to approvedAt/heldAt and persist the non-derived status.
    const requested = input.status ?? 'todo';
    const tr = translateStatusWrite(requested, 'planned'); // no prior status on create
    const status = tr.storedStatus;
    const approvedAt = tr.approvedAt !== undefined ? tr.approvedAt : null;
    const approvedBy = tr.approvedBy !== undefined ? tr.approvedBy : null;
    const heldAt = tr.heldAt !== undefined ? tr.heldAt : null;
    const heldReason = tr.heldReason !== undefined ? tr.heldReason : null;
    db.prepare(
      `INSERT INTO todos (id, ownerSession, assigneeSession, assigneeKind, title, description, status, priority,
        dueDate, parentId, dependsOn, ord, link, createdAt, updatedAt, completedAt, asanaGid,
        sessionName, executedBySession, blueprintId, type, targetProject, acceptanceStatus, claimedBy, claimToken, claimedAt, claimLeaseMs, retryCount, completedBy, objectRef, decisionRef, claimProbe,
        approvedAt, approvedBy, heldAt, heldReason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      // A todo added in a session defaults to being assigned to that session
      // (its ownerSession). Pass an explicit assigneeSession to assign elsewhere.
      id, input.ownerSession, input.assigneeSession ?? input.ownerSession ?? null, input.assigneeKind ?? 'agent', input.title, input.description ?? null,
      status, input.priority ?? null, input.dueDate ?? null, input.parentId ?? null,
      JSON.stringify(input.dependsOn ?? []), ord, input.link ? JSON.stringify(input.link) : null,
      ts, ts, status === 'done' ? ts : null, null,
      // targetProject is total: default to this todo's tracking project (normalized
      // off any worktree path) so it's never written NULL. null === "same project".
      input.sessionName ?? null, input.executedBySession ?? null, input.blueprintId ?? null, input.type ?? null, input.targetProject ?? trackingProjectRoot(project), null, null, null, null, null, 0, null, input.objectRef ?? null, input.decisionRef ?? null, input.claimProbe ?? null,
      approvedAt, approvedBy, heldAt, heldReason
    );
    // EVENT-DRIVEN (S3): a directly-created APPROVED todo is an 'approved' input edge
    // → kick the orchestrator now (best-effort latency; the interval scan is the net).
    if (approvedAt != null) fireOrchestratorKick(`todo-created-approved:${id.slice(0, 8)}`);
    return getTodo(project, id)!;
  });
}

export function updateTodo(project: string, id: string, patch: UpdateTodoPatch): Promise<Todo> {
  return withLock(project, () => {
    const existing = getTodo(project, id);
    if (!existing) throw new Error(`todo not found: ${id}`);

    // De-conflate S3 — WRITE-SIDE TRANSLATION SEAM. A caller setting `status` to a
    // now-DERIVED value (ready/blocked/in_progress) is expressing a DECISION, not a
    // stored status. Translate it to a decision-write (approvedAt/heldAt) here, the
    // one chokepoint covering HTTP + MCP + scripts. in_progress is rejected outright.
    let requestedStatus = patch.status ?? existing.status;
    if (patch.completed === true) requestedStatus = 'done';
    // BUG c4f9f170: un-completing a `done` todo (completed:false) must NOT drop it
    // to `todo`. An un-done todo returns to claimable (we route it through 'ready',
    // which the seam below translates to an approve so the daemon re-claims it).
    if (patch.completed === false && existing.status === 'done' && patch.status === undefined) {
      requestedStatus = 'ready';
    }
    // Decision-axis overrides: start from any EXPLICIT patch values (the Planner /
    // decision writers set approvedAt/heldAt directly), then let the status-write
    // translation layer on top when the caller used the status enum instead.
    let approvedAt: string | null = patch.approvedAt !== undefined ? patch.approvedAt : existing.approvedAt;
    let approvedBy: string | null = patch.approvedBy !== undefined ? patch.approvedBy : existing.approvedBy;
    let heldAt: string | null = patch.heldAt !== undefined ? patch.heldAt : existing.heldAt;
    let heldReason: string | null = patch.heldReason !== undefined ? patch.heldReason : existing.heldReason;

    let status: TodoStatus;
    // Only translate when the caller actually expressed a status intent (patch.status
    // or the completed:false→ready rescue). A patch that touches only OTHER fields
    // must leave status untouched and NOT mint a spurious decision.
    const callerSetStatus = patch.status !== undefined || patch.completed !== undefined;
    if (callerSetStatus) {
      const tr = translateStatusWrite(requestedStatus, existing.status, patch.approvedBy);
      status = tr.storedStatus;
      if (tr.approvedAt !== undefined) approvedAt = tr.approvedAt;
      if (tr.approvedBy !== undefined) approvedBy = tr.approvedBy;
      if (tr.heldAt !== undefined) heldAt = tr.heldAt;
      if (tr.heldReason !== undefined) heldReason = tr.heldReason;
    } else {
      status = existing.status;
    }
    const completedAt = status === 'done' ? (existing.completedAt ?? nowIso()) : null;

    const assigneeKind: AssigneeKind = patch.assigneeKind ?? existing.assigneeKind;
    // completedBy mirrors completedAt: non-null only while done. An explicit
    // patch.completedBy always wins; otherwise a HUMAN todo transitioning to done
    // auto-stamps a default actor handle (attribution, not auth — B1).
    let completedBy: string | null;
    if (status !== 'done') {
      completedBy = null;
    } else if (patch.completedBy !== undefined) {
      completedBy = patch.completedBy;
    } else if (existing.completedBy != null) {
      completedBy = existing.completedBy;
    } else {
      completedBy = assigneeKind === 'human' ? defaultActorHandle() : null;
    }

    const next = {
      title: patch.title ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      status,
      priority: patch.priority !== undefined ? patch.priority : existing.priority,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
      parentId: patch.parentId !== undefined ? patch.parentId : existing.parentId,
      dependsOn: patch.dependsOn ?? existing.dependsOn,
      assigneeSession: patch.assigneeSession !== undefined ? patch.assigneeSession : existing.assigneeSession,
      assigneeKind,
      link: patch.link !== undefined ? patch.link : existing.link,
      asanaGid: patch.asanaGid !== undefined ? patch.asanaGid : existing.asanaGid,
      sessionName: patch.sessionName !== undefined ? patch.sessionName : existing.sessionName,
      executedBySession: patch.executedBySession !== undefined ? patch.executedBySession : existing.executedBySession,
      blueprintId: patch.blueprintId !== undefined ? patch.blueprintId : existing.blueprintId,
      type: patch.type !== undefined ? patch.type : existing.type,
      targetProject: patch.targetProject !== undefined ? patch.targetProject : existing.targetProject,
      acceptanceStatus: patch.acceptanceStatus !== undefined ? patch.acceptanceStatus : existing.acceptanceStatus,
      objectRef: patch.objectRef !== undefined ? patch.objectRef : existing.objectRef,
      decisionRef: patch.decisionRef !== undefined ? patch.decisionRef : existing.decisionRef,
      claimProbe: patch.claimProbe !== undefined ? patch.claimProbe : existing.claimProbe,
    };
    const db = openDb(project);
    // Claim invariant: claim fields are non-null IFF status==='in_progress'. Any
    // write that moves the todo to a non-in_progress status clears the claim
    // (matches reclaimClaim / releaseExpiredClaims).
    const clearClaim = status !== 'in_progress';
    db.prepare(
      `UPDATE todos SET title=?, description=?, status=?, priority=?, dueDate=?, parentId=?,
        dependsOn=?, assigneeSession=?, assigneeKind=?, link=?, asanaGid=?, sessionName=?, executedBySession=?, blueprintId=?, type=?, targetProject=?, acceptanceStatus=?, objectRef=?, decisionRef=?, claimProbe=?,
        approvedAt=?, approvedBy=?, heldAt=?, heldReason=?,
        completedAt=?, completedBy=?, updatedAt=?${clearClaim ? ', ' + CLAIM_CLEAR_SQL : ''} WHERE id=?`
    ).run(
      next.title, next.description, next.status, next.priority, next.dueDate, next.parentId,
      JSON.stringify(next.dependsOn), next.assigneeSession, next.assigneeKind, next.link ? JSON.stringify(next.link) : null,
      next.asanaGid, next.sessionName, next.executedBySession, next.blueprintId, next.type, next.targetProject, next.acceptanceStatus, next.objectRef, next.decisionRef, next.claimProbe,
      approvedAt, approvedBy, heldAt, heldReason,
      completedAt, completedBy, nowIso(), id
    );
    // EVENT-DRIVEN (S3) — retargeted to the INPUT edges that can newly make some
    // todo claimable. Approval going null→non-null is the 'approved' input kick;
    // clearing a hold (heldAt non-null→null) is the 'unheld' input kick.
    if (existing.approvedAt == null && approvedAt != null) {
      fireOrchestratorKick(`approved:${id.slice(0, 8)}`);
    } else if (existing.heldAt != null && heldAt == null) {
      fireOrchestratorKick(`unheld:${id.slice(0, 8)}`);
    }
    return getTodo(project, id)!;
  });
}

/**
 * Single-writer invariant (PCS open-problem #7): orchestration WRITES (claim /
 * complete) must happen on the project's home server — i.e. the project must
 * exist locally. Guards against a peer fabricating a `.collab` DB for a project
 * that isn't on this machine (openDb mkdir's the path), which would split-brain
 * the work-graph. Cross-machine writes route to the home server; a full
 * home-server registry + failover is deferred (federation is still vaporware).
 */
function assertProjectLocal(project: string): void {
  if (!existsSync(project)) {
    throw new Error(`project not local: claim/complete writes must run on the project's home server — ${project}`);
  }
}

export function claimTodo(project: string, id: string, claimedBy: string, leaseMs: number): Promise<Todo | null> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const db = openDb(project);
    const token = crypto.randomUUID();
    const now = nowIso();
    // CAS claim (S3): the atomic guard is NARROWED to the new decision model and is
    // SUBORDINATE to isClaimable (optimistic-concurrency, NEVER a second definition
    // of eligibility — the daemon already filtered via isClaimable/listReadyTodos;
    // this WHERE only re-checks the race-prone fields at write time). writeClaim's
    // 5-column lockstep is folded inline so the set is one atomic write.
    //   claim IS NULL            — not already in-flight
    //   status NOT IN done/dropped — not terminal
    //   approvedAt IS NOT NULL    — Planner-approved
    //   heldAt IS NULL            — not held
    const claimJson = JSON.stringify({ by: claimedBy, token, at: now, leaseMs } satisfies ClaimStruct);
    const res = db.prepare(
      `UPDATE todos SET status='in_progress', claimedBy=?, claimToken=?, claimedAt=?, claimLeaseMs=?, claim=?, updatedAt=?
       WHERE id=? AND claim IS NULL AND status NOT IN ('done','dropped') AND approvedAt IS NOT NULL AND heldAt IS NULL`
    ).run(claimedBy, token, now, leaseMs, claimJson, now, id);
    return res.changes === 1 ? getTodo(project, id) : null;
  });
}

/** Max lease-expiry retries before a todo is parked as 'blocked' for a human (design #2).
 *  Override with MERMAID_MAX_CLAIM_RETRIES. */
export const MAX_CLAIM_RETRIES = Number(process.env.MERMAID_MAX_CLAIM_RETRIES) || 4;

export interface ReleaseResult {
  /** Reclaimed to 'ready' for another attempt. */
  released: string[];
  /** Retry cap exceeded → parked 'blocked'; the coordinator escalates these (kind:blocker). */
  exhausted: string[];
}

/**
 * Reclaim expired claims. A claim whose lease elapsed is returned to 'ready'
 * and its retryCount bumped — UNLESS that pushes it past MAX_CLAIM_RETRIES, in
 * which case it is parked 'blocked' (a stuck/failing worker shouldn't be
 * respawned forever) so the coordinator can escalate it for a human.
 */
export function releaseExpiredClaims(project: string, now: string = nowIso()): Promise<ReleaseResult> {
  return withLock(project, () => {
    const db = openDb(project);
    const nowMs = new Date(now).getTime();
    // S3: read the claim via readClaim (the orphan-aware accessor) rather than the
    // raw legacy columns. A row is expired iff it carries a claim whose lease elapsed.
    const rows = db.query(`SELECT * FROM todos WHERE status NOT IN ('done','dropped')`).all() as TodoRow[];
    const expired = rows
      .map((r) => ({ r, c: readClaim(r) }))
      .filter((x): x is { r: TodoRow; c: ClaimStruct } => x.c != null
        && new Date(x.c.at).getTime() + x.c.leaseMs < nowMs);
    if (expired.length === 0) return { released: [], exhausted: [] };
    const ts = nowIso();
    // On expiry: clear the claim and bump retryCount (re-derives claimable). Past
    // the retry cap, PARK via heldAt/heldReason='retry-exhausted' (the new honest
    // stored "blocked") instead of writing status='blocked'. ONE write per row.
    const toReady = db.prepare(
      `UPDATE todos SET status='ready', ${CLAIM_CLEAR_SQL},
       retryCount=retryCount+1, updatedAt=? WHERE id=?`
    );
    const toHeld = db.prepare(
      `UPDATE todos SET status='blocked', ${CLAIM_CLEAR_SQL}, heldAt=?, heldReason='retry-exhausted',
       retryCount=retryCount+1, updatedAt=? WHERE id=?`
    );
    const released: string[] = [];
    const exhausted: string[] = [];
    db.transaction(() => {
      for (const { r } of expired) {
        if ((r.retryCount ?? 0) + 1 > MAX_CLAIM_RETRIES) { toHeld.run(ts, ts, r.id); exhausted.push(r.id); }
        else { toReady.run(ts, r.id); released.push(r.id); }
      }
    })();
    return { released, exhausted };
  });
}

/**
 * De-conflate S3 — the MERGED force-reclaim. The old reclaimClaim (guarded on
 * `claimToken IS NOT NULL`) and reclaimOrphan (any in_progress row) collapse to
 * one function: with the single `claim` struct there is no half-claimed row to
 * distinguish, so an orphan ≡ a row whose claim (read via readClaim) is non-null
 * past its lease, OR a row left in_progress with NO live claim at all. Both are
 * "reclaim now, regardless of lease". The 19b097a1 ~9h stuck-leaf gap (in_progress
 * + claimToken NULL) is rescued here, not silently skipped.
 *
 * Reclaims ANY non-terminal row carrying a claim (or stranded in_progress without
 * one) and applies the retry-cap: → cleared claim (re-derives claimable) on a
 * normal reclaim, or → heldAt + heldReason='retry-exhausted' once MAX_CLAIM_RETRIES
 * is exceeded. Returns 'ready' (claim cleared) / 'blocked' (held), or null if the
 * row wasn't a reclaimable claim.
 *
 * NOTE: returns the legacy 'ready'|'blocked' labels for back-compat with callers —
 * 'ready' means "claim cleared, will re-derive claimable" and 'blocked' means
 * "parked via heldAt", matching the new decision model.
 */
export function reclaimNow(project: string, id: string): Promise<'ready' | 'blocked' | null> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const db = openDb(project);
    const row = db.query(
      `SELECT * FROM todos WHERE id=?`
    ).get(id) as TodoRow | undefined;
    if (!row) return null;
    // Reclaimable iff it carries a (live or orphaned) claim, or is stranded
    // in_progress without one. Terminal rows are never reclaimed.
    if (row.status === 'done' || row.status === 'dropped') return null;
    const hasClaim = readClaim(row) != null;
    if (!hasClaim && row.status !== 'in_progress') return null;
    const exhausted = (row.retryCount ?? 0) + 1 > MAX_CLAIM_RETRIES;
    const next: 'ready' | 'blocked' = exhausted ? 'blocked' : 'ready';
    if (exhausted) {
      db.prepare(
        `UPDATE todos SET status='blocked', ${CLAIM_CLEAR_SQL}, heldAt=?, heldReason='retry-exhausted',
         retryCount=retryCount+1, updatedAt=? WHERE id=?`
      ).run(nowIso(), nowIso(), id);
    } else {
      db.prepare(
        `UPDATE todos SET status='ready', ${CLAIM_CLEAR_SQL},
         retryCount=retryCount+1, updatedAt=? WHERE id=?`
      ).run(nowIso(), id);
    }
    return next;
  });
}

/** Back-compat aliases (S3): both legacy names now route to the single merged
 *  reclaimNow. Kept so coordinator-live's call sites need no change. */
export const reclaimClaim = reclaimNow;
export const reclaimOrphan = reclaimNow;

/**
 * Release a claim WITHOUT a retry penalty — for a todo the coordinator claimed
 * but then could NOT spawn a worker for (pool at capacity, deferred BEFORE any
 * spawn attempt). Unlike reclaimClaim (which charges a retry for a dead/failed
 * worker), a deferral never ran anything, so the todo returns straight to
 * 'ready', is immediately re-claimable, and holds no dead lease (DOGFOOD #3).
 * Returns true if a live claim was released, false if the row wasn't an
 * in_progress claim (lost the race / already moved on).
 */
export function releaseClaim(project: string, id: string): Promise<boolean> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const db = openDb(project);
    const res = db.prepare(
      `UPDATE todos SET status='ready', ${CLAIM_CLEAR_SQL},
       updatedAt=? WHERE id=? AND status='in_progress' AND claimToken IS NOT NULL`
    ).run(nowIso(), id);
    // EVENT-DRIVEN (S3): freeing a claim restores capacity → 'capacity' input edge.
    if (res.changes > 0) fireOrchestratorKick(`capacity:${id.slice(0, 8)}`);
    return res.changes > 0;
  });
}

/**
 * The Coordinator's claimable set: ready, deps-satisfied, AND assigneeKind='agent'.
 *
 * B2 (user-todo): human todos sit STRUCTURALLY outside the claim/lease/gate
 * machinery via this ONE filter at the claim boundary — they are a different
 * actor on the same graph, not a second execution contract, so they never get a
 * claimToken / lease / gateCommand. This is the single chokepoint, NOT a
 * skip-flag sprinkled through lease/retry/gate.
 *
 * Dependency resolution still flows both ways: depSatisfied keys only on a dep's
 * status='done' (independent of assigneeKind), so an agent todo depending on a
 * human todo becomes claimable the moment the human marks it done, and a human
 * todo depending on an agent todo becomes actionable (in the B3 inbox VIEW) once
 * the agent finishes + gate passes. The filter only removes human todos from the
 * CLAIM path — never from the graph.
 */
export function listReadyTodos(project: string): Todo[] {
  // S3: readiness is no longer the materialized `ready` enum value — it is DERIVED
  // by the single isClaimable predicate (claimability.ts) over the in-memory map of
  // ALL todos. isClaimable already folds in the agent-vs-human split, approval/hold
  // gates, and the dep-satisfied check (incl. dep-rejected), so this is the whole
  // claimable set modulo the daemon-side live probe (claimGuard).
  const all = listTodos(project, { includeCompleted: true });
  const byId = new Map(all.map((t) => [t.id, t]));
  return all.filter((t) => isClaimable(t, byId));
}

export interface CreateGateInput {
  /** The work-graph (agent) todo this gate must clear before it can run. */
  workTodoId: string;
  title: string;
  description?: string | null;
  /** Optional label folded into the title for the inbox (e.g. 'spec-review'). */
  gateKind?: string;
  /** Human-gate epic to parent the gate under (project-specific; the caller
   *  supplies it — the per-project store stays free of any hard-coded epic id).
   *  Omit to leave the gate unparented. */
  parentId?: string | null;
  /** P2: link a design/decision gate to a decision-record id so approving that
   *  record auto-completes this gate (see completeGatesForDecision). */
  decisionRef?: string | null;
}
export interface CreateGateResult { gate: Todo; workTodo: Todo; }

/**
 * Readiness gate (design-readiness-gates Phase 1) — ZERO schema. A gate is just a
 * HUMAN todo the work-todo depends on:
 *  1. create a `[GATE]` human todo (assigneeKind:'human', status:'ready') — humans
 *     can act on it immediately, but the coordinator NEVER claims it (listReadyTodos
 *     filters assigneeKind!=='agent');
 *  2. append the gate's id to the work-todo's dependsOn and park the work-todo
 *     'blocked'.
 * Because depSatisfied keys only on status==='done' (regardless of assigneeKind),
 * the open gate holds the work-todo blocked — never auto-promoted, never claimed/
 * false-failed — and completing the gate auto-promotes it to 'ready' on the SAME
 * completeTodo tick (the unblock pass), with no new status and no reset_todo.
 */
export async function createGate(project: string, input: CreateGateInput): Promise<CreateGateResult> {
  const work = getTodo(project, input.workTodoId);
  if (!work) throw new Error(`work todo not found: ${input.workTodoId}`);
  const label = input.gateKind ? `[GATE:${input.gateKind}]` : '[GATE]';
  const title = input.title.startsWith('[GATE') ? input.title : `${label} ${input.title}`;
  const gate = await createTodo(project, {
    ownerSession: work.ownerSession,
    assigneeKind: 'human',
    parentId: input.parentId ?? null,
    status: 'ready',
    title,
    description: input.description ?? null,
    decisionRef: input.decisionRef ?? null,
  });
  const nextDeps = [...(work.dependsOn ?? []), gate.id];
  // S3: parking behind a gate is NO LONGER a manual hold — the OPEN gate dep makes
  // the work-todo deps-pending (DERIVED), which holds it out of the claimable set
  // until the gate is done. We must NOT write status:'blocked' here: the seam would
  // translate that to heldAt='manual', and completing the gate would not clear that
  // hold (the unblock pass doesn't touch heldAt) — stranding the work-todo. Instead
  // ADD the dep and APPROVE the work-todo (status:'ready' → approvedAt), so the
  // moment the gate completes it re-derives claimable on the same tick. A terminal
  // work-todo is left untouched.
  const patch: UpdateTodoPatch = work.status === 'done' || work.status === 'dropped'
    ? { dependsOn: nextDeps }
    : { dependsOn: nextDeps, status: 'ready' };
  const workTodo = await updateTodo(project, input.workTodoId, patch);
  return { gate, workTodo };
}

/**
 * Reverse-edge view: the OPEN gates (human todos, not yet done) the work-todo is
 * waiting on — the "what is this waiting on" inbox line. Empty when nothing gates it.
 */
export function listGatesBlocking(project: string, workTodoId: string): Todo[] {
  const work = getTodo(project, workTodoId);
  if (!work) return [];
  return (work.dependsOn ?? [])
    .map((id) => getTodo(project, id))
    .filter((t): t is Todo => t != null && t.assigneeKind === 'human' && t.status !== 'done');
}

/**
 * Reverse-edge view: the work-todos a given gate blocks — the "what does this gate
 * unblock when I clear it" inbox line.
 */
export function listGatedBy(project: string, gateId: string): Todo[] {
  return listTodos(project, { includeCompleted: true }).filter((t) => (t.dependsOn ?? []).includes(gateId));
}

/**
 * Readiness-gates P2: auto-complete every open gate whose decisionRef === the
 * just-approved decision-record id. Landing the design = approving the record =
 * the gate clears itself (each completeTodo runs the normal unblock pass, so the
 * gated work-todos auto-promote on the same tick). Returns one CompleteTodoResult
 * per gate completed; empty when no gate references the decision. Called by the
 * approve_decision_record handler — the stores stay decoupled (no decision-record
 * → todo-store import; the MCP layer, which knows the project, orchestrates).
 */
export async function completeGatesForDecision(project: string, decisionId: string): Promise<CompleteTodoResult[]> {
  const gates = listTodos(project, { includeCompleted: false })
    .filter((t) => t.decisionRef === decisionId && t.status !== 'done');
  const results: CompleteTodoResult[] = [];
  for (const g of gates) {
    results.push(await completeTodo(project, g.id, 'accepted', `decision:${decisionId}`));
  }
  return results;
}

export function computeWaves(todos: Todo[]): Todo[][] {
  if (todos.length === 0) return [];
  const byId = new Map<string, Todo>();
  for (const t of todos) byId.set(t.id, t);
  const remaining = new Map<string, Todo>(byId);
  const placed = new Set<string>();
  const waves: Todo[][] = [];
  while (remaining.size > 0) {
    const wave: Todo[] = [];
    for (const t of remaining.values()) {
      const deps = (t.dependsOn ?? []).filter((d) => byId.has(d));
      if (deps.every((d) => placed.has(d))) wave.push(t);
    }
    if (wave.length === 0) { waves.push(Array.from(remaining.values())); break; }
    for (const t of wave) { remaining.delete(t.id); placed.add(t.id); }
    waves.push(wave);
  }
  return waves;
}

export interface CompleteTodoResult {
  completed: Todo;
  promoted: string[];
  /** Parent epic ids auto-closed by this completion's roll-up (deepest-first),
   *  when the completed todo was the last outstanding child. Empty when nothing
   *  rolled up. */
  rolledUp: string[];
}

/**
 * Whether a dependency satisfies its dependents (PCS design #1: unblock only on
 * done-AND-accepted). A dep counts as satisfied when it is 'done' and NOT
 * explicitly 'rejected' — so a rejected completion never propagates to
 * dependents (they stay blocked), while null/pending/accepted completions
 * propagate as before (backward-compatible). An unknown dep id is treated as
 * external/satisfied, preserving prior behavior.
 */
function depSatisfied(dep: Pick<Todo, 'status' | 'acceptanceStatus'> | undefined): boolean {
  if (dep === undefined) return true;
  return dep.status === 'done' && dep.acceptanceStatus !== 'rejected';
}

/**
 * Mark a todo done and unblock its dependents.
 * Status semantics: planned=proposed-not-yet-approved; ready=approved & deps-done (claimable);
 * blocked=approved but deps pending; in_progress=claimed; done; dropped=abandoned.
 * Only the planner moves planned→ready/blocked (approval). This (the coordinator core)
 * only promotes blocked→ready when the last dep completes — it never touches 'planned'.
 */
export function completeTodo(project: string, id: string, acceptanceStatus?: 'pending' | 'accepted' | 'rejected', completedBy?: string | null): Promise<CompleteTodoResult> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const db = openDb(project);
    const existing = getTodo(project, id);
    if (!existing) throw new Error(`todo not found: ${id}`);
    const ts = nowIso();
    const accept = acceptanceStatus !== undefined ? acceptanceStatus : existing.acceptanceStatus;
    // Attribution (B1): an explicit completer wins; otherwise a HUMAN todo
    // auto-stamps a default actor handle. Agent todos stay null unless told.
    // (The executor — the worker session — lives in `sessionName`, which persists
    // across completion and is what the UI shows; claimedBy is the coordinator's
    // reservation, NOT the worker, so it must NOT be used as the executor.)
    const actor: string | null = completedBy !== undefined
      ? completedBy
      : (existing.assigneeKind === 'human' ? (existing.completedBy ?? defaultActorHandle()) : existing.completedBy);
    // SI-3: a rejected completion is NOT done. The mechanical gate failed, so the
    // todo returns to a non-terminal 'blocked' state (completedAt cleared) and is
    // surfaced — the caller escalates it (handleWorkerComplete) for a human to
    // re-open/split/drop. It is NOT auto-promoted back to 'ready' (the unblock
    // pass below skips rejected todos), so it never silently re-claims and
    // re-fails. Only accepted/pending/null completions move to 'done'.
    if (accept === 'rejected') {
      // Not done → completedBy cleared (mirrors completedAt).
      db.prepare(
        `UPDATE todos SET status='blocked', completedAt=NULL, completedBy=NULL, acceptanceStatus=?,
          ${CLAIM_CLEAR_SQL}, updatedAt=? WHERE id=?`
      ).run(accept, ts, id);
    } else {
      db.prepare(
        `UPDATE todos SET status='done', completedAt=COALESCE(completedAt, ?), completedBy=?, acceptanceStatus=?,
          ${CLAIM_CLEAR_SQL}, updatedAt=? WHERE id=?`
      ).run(ts, actor, accept, ts, id);
    }
    // Unblock pass: any 'blocked' todo whose every (known) dep is satisfied
    // (done AND not rejected) → 'ready'. A rejected dep does NOT unblock, and a
    // todo that is itself rejected stays parked until a human clears it.
    const all = listTodos(project, { includeCompleted: true });
    const byId = new Map(all.map((t) => [t.id, t]));
    const promoted: string[] = [];
    for (const t of all) {
      if (t.status !== 'blocked') continue;
      if (t.acceptanceStatus === 'rejected') continue;
      const depsDone = (t.dependsOn ?? []).every((d) => depSatisfied(byId.get(d)));
      if (depsDone) {
        db.prepare(`UPDATE todos SET status='ready', updatedAt=? WHERE id=?`).run(nowIso(), t.id);
        promoted.push(t.id);
      }
    }
    // Epic roll-up: when this completion leaves a parent epic with every
    // (non-dropped) child done, close the parent too — and recurse upward, since
    // a parent may itself be a child. A rejected or still-open child blocks the
    // roll-up; an epic with zero non-dropped children is never auto-closed.
    const rolledUp: string[] = [];
    let parentId = existing.parentId;
    while (parentId) {
      const parent = getTodo(project, parentId);
      if (!parent || parent.status === 'done' || parent.status === 'dropped') break;
      const children = listTodos(project, { includeCompleted: true }).filter((t) => t.parentId === parentId && t.status !== 'dropped');
      if (children.length === 0) break;
      const allChildrenDone = children.every((c) => c.status === 'done' && c.acceptanceStatus !== 'rejected');
      if (!allChildrenDone) break;
      db.prepare(
        `UPDATE todos SET status='done', completedAt=COALESCE(completedAt, ?), acceptanceStatus=?,
          ${CLAIM_CLEAR_SQL}, updatedAt=? WHERE id=?`
      ).run(ts, 'accepted', nowIso(), parentId);
      rolledUp.push(parentId);
      parentId = parent.parentId;
    }
    // EVENT-DRIVEN (S3): the completing todo just went TERMINAL (done/dropped) — the
    // one mutation that can flip a DEPENDENT's deps-satisfied false→true. This is the
    // 'dep-terminal' input edge; fire it whenever this todo reached a terminal status
    // (not only when the still-materialized fan-out promoted something — that fan-out
    // is removed in S4, leaving this kick as the sole dependent-wake signal).
    if (accept !== 'rejected') fireOrchestratorKick(`dep-terminal:${id.slice(0, 8)}`);
    return { completed: getTodo(project, id)!, promoted, rolledUp };
  });
}

/** An epic the sweep left in_progress because every child is `done` but at least
 *  one is not explicitly `accepted` (policy (b): never silently close ungated
 *  work — surface it as a flag instead). */
export interface EpicRollupFlag {
  epicId: string;
  /** Count of non-dropped children. */
  children: number;
  /** How many of those children are `done` but not `acceptanceStatus==='accepted'`. */
  unaccepted: number;
}

export interface EpicSweepResult {
  /** Epic ids the sweep rolled up to `done` this pass (all children done+accepted). */
  rolledUp: string[];
  /** Epics whose children all settled `done` but some are not accepted — left
   *  in_progress, surfaced for a human/gate to resolve (one entry per epic). */
  flagged: EpicRollupFlag[];
}

/**
 * Periodic epic-rollup sweep (orchestrator reconcile pass).
 *
 * The event-driven rollup in {@link completeTodo} only fires when a CHILD
 * completes through that path — an epic whose children settled out-of-band
 * (legacy todos completed before the gate existed, bulk edits, cross-session
 * completions) is never re-evaluated and sits `in_progress` forever. This sweep
 * is the catch-up: for each `in_progress` parent (epic) whose non-dropped
 * children are ALL `done` AND explicitly `accepted`, it performs the same
 * transition the event path performs (status=done, acceptance=accepted, claim
 * cleared) — recursing upward via a bounded fixpoint so closing a nested child
 * epic can in turn unblock its parent.
 *
 * Policy for done-but-UNACCEPTED children (policy (b), the 34a22538 case): an
 * epic whose children are all `done` but some are not `accepted` is NOT closed —
 * the sweep never silently closes ungated work. It is returned in `flagged`
 * instead, leaving the epic `in_progress` for explicit acceptance/gating.
 *
 * This sweep ONLY mutates todo status; it raises NO escalations or land cards
 * (the 'epic-ready-to-land' surface stays exclusively on the event path). It is
 * idempotent (a re-run on an already-rolled-up graph closes nothing) and bounded
 * (at most one pass per parent epic).
 */
export function sweepEpicRollups(project: string): Promise<EpicSweepResult> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const db = openDb(project);
    const rolledUp: string[] = [];
    const flagged: EpicRollupFlag[] = [];
    const flaggedSeen = new Set<string>();

    // Bound: each pass may close child epics that then unblock parent epics, so
    // re-evaluate until a pass closes nothing. The number of distinct parents is
    // a strict upper bound on how many epics can ever close, so the loop is
    // always finite (per-tick bounded).
    const parentIds = new Set(
      listTodos(project, { includeCompleted: true })
        .filter((t) => t.parentId != null && t.status !== 'dropped')
        .map((t) => t.parentId as string),
    );
    const maxPasses = parentIds.size + 1;

    for (let pass = 0; pass < maxPasses; pass++) {
      const all = listTodos(project, { includeCompleted: true });
      const childrenByParent = new Map<string, Todo[]>();
      for (const t of all) {
        if (t.parentId == null || t.status === 'dropped') continue;
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }

      let closedThisPass = 0;
      for (const epic of all) {
        // Container auto-complete cascade (worker-decomposition P3): roll up any
        // NON-TERMINAL container whose children all settled — not just in_progress
        // ones. A 'planned'/'ready'/'blocked' epic whose children all completed
        // (e.g. children worked before the epic was activated) would otherwise
        // linger forever. Terminal epics (done/dropped) are left alone.
        if (epic.status === 'done' || epic.status === 'dropped') continue;
        const children = childrenByParent.get(epic.id);
        if (!children || children.length === 0) continue; // not an epic / no live children
        if (!children.every((c) => c.status === 'done')) continue; // a child still open

        const unaccepted = children.filter((c) => c.acceptanceStatus !== 'accepted');
        if (unaccepted.length === 0) {
          // All children done + accepted → roll the epic up (mirrors the event path).
          const ts = nowIso();
          db.prepare(
            `UPDATE todos SET status='done', completedAt=COALESCE(completedAt, ?), acceptanceStatus='accepted',
              ${CLAIM_CLEAR_SQL}, updatedAt=? WHERE id=?`,
          ).run(ts, ts, epic.id);
          rolledUp.push(epic.id);
          closedThisPass++;
        } else if (!flaggedSeen.has(epic.id)) {
          // Policy (b): done-but-unaccepted children → flag, never auto-close.
          flagged.push({ epicId: epic.id, children: children.length, unaccepted: unaccepted.length });
          flaggedSeen.add(epic.id);
        }
      }
      if (closedThisPass === 0) break;
    }

    return { rolledUp, flagged };
  });
}

/**
 * STEWARD: unstick a parked/over-retried todo and re-promote it. Use when the
 * CAUSE of repeated rejections is fixed EXTERNALLY (a now-merged dependency, a
 * foreign whole-tree gate error since repaired, a corrected gate command) so a
 * todo sitting at/over MAX_CLAIM_RETRIES — which would otherwise re-park to
 * 'blocked' the instant it's reclaimed — can flow again. Resets retryCount=0,
 * clears acceptanceStatus + any stale claim + completion stamps, and sets the
 * status (default 'ready'). This is the supported replacement for hand-editing
 * todos.db. Returns the updated todo.
 */
export function resetTodo(
  project: string,
  id: string,
  status: TodoStatus = 'ready',
  targetProject?: string | null,
): Promise<Todo> {
  return withLock(project, () => {
    assertProjectLocal(project);
    const existing = getTodo(project, id);
    if (!existing) throw new Error(`todo not found: ${id}`);
    const db = openDb(project);
    // Optionally REROUTE while unsticking: a cross-project todo created without a
    // targetProject (so the worker spawned with cwd=tracking repo and the gate ran
    // in the wrong place) can be corrected in the same call. undefined → leave it.
    const setTarget = targetProject !== undefined ? ', targetProject=?' : '';
    // S3: a reset to 'ready' is the 'unheld' input edge — clear any hold and ensure
    // the todo is approved so it re-derives claimable. We translate the requested
    // status through the seam: 'ready' → approve + clear hold + store 'planned'.
    const tr = translateStatusWrite(status, existing.status);
    const storedStatus = tr.storedStatus;
    const approvedAt = tr.approvedAt !== undefined ? tr.approvedAt : existing.approvedAt;
    const approvedBy = tr.approvedBy !== undefined ? tr.approvedBy : existing.approvedBy;
    const heldAt = tr.heldAt !== undefined ? tr.heldAt : null; // reset always clears the hold
    const heldReason = tr.heldReason !== undefined ? tr.heldReason : null;
    const stmt = db.prepare(
      `UPDATE todos SET status=?, retryCount=0, acceptanceStatus=NULL,
        ${CLAIM_CLEAR_SQL},
        approvedAt=?, approvedBy=?, heldAt=?, heldReason=?,
        completedAt=NULL, completedBy=NULL${setTarget}, updatedAt=? WHERE id=?`
    );
    if (targetProject !== undefined) stmt.run(storedStatus, approvedAt, approvedBy, heldAt, heldReason, targetProject, nowIso(), id);
    else stmt.run(storedStatus, approvedAt, approvedBy, heldAt, heldReason, nowIso(), id);
    // Re-promoting a blocked/rejected todo SUPERSEDES any escalation it raised (rejected
    // / parked / blocker / blueprint-failed) — the work is being re-attempted, so those
    // are stale. Auto-resolve them (matching by todoId + the lane session) so the project
    // doesn't keep reading 'paused on escalation' (stale red) while the daemon rebuilds it.
    // Mirrors completeTodo's accept-time resolveEscalationsForTodo; best-effort, never
    // blocks the unstick.
    try { resolveEscalationsForTodo(project, id, existing.sessionName ? [existing.sessionName] : []); }
    catch { /* best-effort — escalation cleanup must never break the reset */ }
    // EVENT-DRIVEN (S3): a steward reset back to `ready` clears the hold and approves
    // → the 'unheld' input edge. Kick now instead of waiting an interval (direct SQL
    // above bypasses the updateTodo kick).
    if (status === 'ready') fireOrchestratorKick(`unheld:${id.slice(0, 8)}`);
    return getTodo(project, id)!;
  });
}

/**
 * STEWARD override-accept: force a todo whose work is verified-done DONE+accepted,
 * BYPASSING the mechanical gate. Use when the gate FALSE-rejected verified-green
 * work (e.g. a whole-tree `tsc` tripping on a sibling lane's committed error, or a
 * gate command that's wrong for the change-set). Routes through completeTodo so
 * dependents unblock and parent epics roll up exactly as a normal acceptance —
 * the ONLY difference is no gate runs. Records the steward as completer for
 * provenance. Returns the completion result (completed todo + promoted/rolledUp).
 */
export function overrideAcceptTodo(project: string, id: string, completedBy: string = 'steward'): Promise<CompleteTodoResult> {
  return completeTodo(project, id, 'accepted', completedBy);
}

export function assignTodo(project: string, id: string, assigneeSession: string | null): Promise<Todo> {
  return updateTodo(project, id, { assigneeSession });
}

export function removeTodo(project: string, id: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    const res = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (res.changes === 0) throw new Error(`todo not found: ${id}`);
  });
}

export function clearCompleted(project: string, session: string): Promise<{ removed: number }> {
  return withLock(project, () => {
    const db = openDb(project);
    const res = db
      .prepare("DELETE FROM todos WHERE (ownerSession = ? OR assigneeSession = ?) AND status = 'done'")
      .run(session, session);
    return { removed: res.changes };
  });
}

export function reorder(project: string, ids: string[]): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    const stmt = db.prepare('UPDATE todos SET ord = ?, updatedAt = ? WHERE id = ?');
    const ts = nowIso();
    db.transaction(() => {
      ids.forEach((id, i) => stmt.run((i + 1) * 10, ts, id));
    })();
  });
}

export interface ImportTodoInput {
  id: string;
  ownerSession: string;
  title: string;
  description?: string | null;
  status?: TodoStatus;
  parentId?: string | null;
  dependsOn?: string[];
  order?: number;
  sessionName?: string | null;
  blueprintId?: string | null;
  type?: string | null;
}

export function importTodo(project: string, input: ImportTodoInput): void {
  const db = openDb(project);
  const maxOrd = (db.query('SELECT MAX(ord) AS m FROM todos').get() as { m: number | null }).m;
  const ord = input.order ?? (maxOrd == null ? 10 : maxOrd + 10);
  const ts = nowIso();
  const status = input.status ?? 'todo';
  db.prepare(
    `INSERT OR IGNORE INTO todos
      (id, ownerSession, assigneeSession, assigneeKind, title, description, status, priority, dueDate, parentId,
       dependsOn, ord, link, createdAt, updatedAt, completedAt, asanaGid,
       sessionName, blueprintId, type, acceptanceStatus, claimedBy, claimToken, claimedAt, claimLeaseMs, retryCount, completedBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    input.id, input.ownerSession, input.ownerSession, 'agent', input.title, input.description ?? null, status,
    null, null, input.parentId ?? null, JSON.stringify(input.dependsOn ?? []), ord, null, ts, ts,
    status === 'done' ? ts : null, null,
    input.sessionName ?? null, input.blueprintId ?? null, input.type ?? null, null, null, null, null, null, 0, null
  );
}
