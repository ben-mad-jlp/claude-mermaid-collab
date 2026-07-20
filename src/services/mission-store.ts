/**
 * mission-store.ts — durable loop-control state for the convergence-loop MISSION
 * (Phase 2a of the autonomous convergence loop; companion to context-recycle).
 *
 * A MISSION is a durable capability goal, represented by a `[MISSION]` work-graph
 * root node whose convergence is tracked in a separate `.collab/mission.db`. Each
 * mission has acceptance CRITERIA (the goal definition). Mission status is DERIVED
 * from the work-graph (epic children, leaf runs), acceptance criteria (met/unverified),
 * and the mission row's `abandonedAt` flag — NOT from stored phase/iteration state.
 * The old phase machine (discover/plan/execute/verify cycles) was removed in F1;
 * the mission node itself remains a durable non-closing root.
 *
 * DESIGN: the mission NODE lives in the todo work-graph (for board visibility +
 * epic parenting + descendant rollup); loop-control state (criteria + abandonment)
 * lives HERE in a SEPARATE `.collab/mission.db`, keyed by the node's todo id.
 */
import Database from 'bun:sqlite';
import { join, isAbsolute, relative } from 'node:path';
import { mkdirSync } from 'node:fs';
import { listTodos, resolveShortId } from './todo-store.ts';
import { isEpic, isMission } from './todo-kind.ts';
import { listLeafRuns } from './ledger-stats.ts';
import { derivedStatus } from './claimability.ts';
import { createEscalation } from './supervisor-store.ts';
import { recordAutonomousMutation } from './autonomy-log.ts';

/** Derived-on-read capability status of a mission (never stored; computed from the
 *  work-graph + criteria + leaf-run ledger each read). Precedence is first-match-wins in
 *  the order listed in deriveMissionStatus. */
export type MissionStatus =
  | 'unapproved'      // awaitingApprovalSince set — forged (e.g. from a doc) but not yet human-approved
  | 'abandoned'       // abandonedAt set
  | 'over-budget'     // spendUsd >= budgetUsd
  | 'blocked'         // a mission leaf is parked/rejected, escalated, or an unapproved split
  | 'building'        // leaves in flight AND nothing left to discover/verify (quietest non-terminal state)
  | 'needs-verify'    // some criterion's serving epic landed, verdict not yet recorded
  | 'needs-discovery' // some criterion has no LIVE serving epic (per-criterion — others may be building)
  | 'converged';      // every criterion met

/** A mission is terminal (the loop has stopped) when it converged or a human abandoned it.
 *  Replaces the removed isTerminalPhase(phase) — reads the derived status, not stored phase. */
export function isMissionTerminal(m: Pick<MissionRow, 'status' | 'abandonedAt'>): boolean {
  return m.abandonedAt != null || m.status === 'converged';
}

export interface MissionRow {
  /** The `[MISSION]` node's todo id (FK into the work-graph). */
  todoId: string;
  createdAt: number;
  updatedAt: number;
  /** Last time the mission-loop pass nudged the steward for this mission (ms epoch),
   *  or null — the nudge debounce so the pass doesn't spam every tick. */
  lastNudgeAt: number | null;
  /** Fingerprint (status:met/total) of the last nudge, or null. Used to suppress
   *  re-nudges when the mission state hasn't changed materially. */
  lastNudgeKey: string | null;
  /** Debounce fingerprint of the last AUTONOMOUS CONDUCTOR pass (status + criteria actions). The
   *  conductor pass no-ops while this is unchanged, so it only spends a node when state moved. */
  lastConductorKey: string | null;
  /** Whether this is the ACTIVE mission for its owning session. A steward drives ONE
   *  mission at a time, so at most one mission per session is active; the mission-loop
   *  pass only drives active missions. Default true (a lone mission just works). */
  active: boolean;
  /** Human-set abandonment stamp (ms epoch), or null = active. A mission-requirements
   *  concept: an abandoned mission with unmet criteria is otherwise indistinguishable
   *  from an in-progress one; this makes "done with it" explicit. */
  abandonedAt: number | null;
  /** Set (ms epoch) when a mission was FORGED but not yet human-approved (e.g. by the doc→node
   *  forge). Null = approved / not applicable (all hand-created + legacy missions). While set the
   *  derived status is 'unapproved' and the mission-loop never drives it. approve_mission clears it. */
  awaitingApprovalSince: number | null;
  /** Per-mission USD budget ceiling, or null = project default. */
  budgetUsd: number | null;
  /** The mission's CONSTITUTION: the handoff/brief document id (session doc) carrying the
   *  locked constraints, sequencing rationale, and out-of-scope list the conductor must
   *  honor. Durable link, not description-text convention. Null = none recorded. */
  handoffDocId: string | null;
  /** Archive stamp (ms epoch), or null = live. Archived missions are excluded from
   *  listMissions by default (see includeArchived/onlyArchived). */
  archivedAt: number | null;
  /** Derived-on-read: populated by getMission, absent on the raw rowToMission row. */
  status?: MissionStatus;
}

export interface MissionCriterion {
  id: string;
  todoId: string;
  text: string;
  met: boolean;
  order: number;
  updatedAt: number;
  /** VERIFY-gate audit trail: why the judge ruled this met/unmet, WHO judged it,
   *  and WHEN — set by an INDEPENDENT verify (not the maker). Null until verified. */
  evidence: string | null;
  verifiedBy: string | null;
  verifiedAt: number | null;
  /** The sha the verdict was checked against (staleness pin). Null until verified. */
  verifiedAtSha: string | null;
  /** File paths the verdict cited (JSON array). A later leaf's land-diff ∩ evidencePaths
   *  re-opens this criterion when one of these files changes. Empty until verified. */
  evidencePaths: string[];
  /** Count of land-driven reopens (H7b churn bound). 0 until a land clears it. */
  reopenCount: number;
  /** The landedSha of the most recent land-driven reopen, or null. */
  lastReopenSha: string | null;
}

export interface MissionRecheck {
  criterionId: string;
  todoId: string;
  reason: string;
  landedSha: string | null;
  enqueuedAt: number;
}

/** Two convergence gauges: mechanical = this iteration's build progress; capability
 *  = the real "is the mission done" signal over acceptance criteria. */
export interface MissionRollup {
  todoId: string;
  /** Descendant `[EPIC]` children: done vs total. */
  mechanical: { done: number; total: number };
  /** Acceptance criteria: met vs total (the true convergence gauge). */
  capability: { met: number; total: number };
  /** True iff there is ≥1 criterion and every criterion is met. */
  converged: boolean;
  /** True when the mission is terminal (converged or abandoned). */
  stopped: boolean;
  /** Derived capability status, first-match-wins precedence. */
  status: MissionStatus;
  /** Criteria whose derived action is 'discover' — open gaps with no live serving epic.
   *  The conductor files one epic PER gap, all in the same pass. */
  gaps: number;
  /** Criteria whose derived action is 'verify' — landed, awaiting the independent gate. */
  awaitingVerify: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mission (
  todoId TEXT PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastNudgeAt INTEGER,
  lastNudgeKey TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  abandonedAt INTEGER,
  budgetUsd REAL,
  handoffDocId TEXT
);
CREATE TABLE IF NOT EXISTS mission_criterion (
  id TEXT PRIMARY KEY,
  todoId TEXT NOT NULL,
  text TEXT NOT NULL,
  met INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL,
  verifiedAtSha TEXT,
  evidencePaths TEXT,
  reopenCount INTEGER NOT NULL DEFAULT 0,
  lastReopenSha TEXT
);
CREATE INDEX IF NOT EXISTS idx_mission_criterion_todo ON mission_criterion(todoId);
CREATE TABLE IF NOT EXISTS mission_recheck (
  criterionId TEXT PRIMARY KEY,
  todoId TEXT NOT NULL,
  reason TEXT NOT NULL,
  landedSha TEXT,
  enqueuedAt INTEGER NOT NULL
);
`;

const dbCache = new Map<string, Database>();

function addColumnIfMissing(db: Database, table: string, column: string, decl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
}

function migrateDropPhaseMachine(db: Database): void {
  const cols = db.query('PRAGMA table_info(mission)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'phase')) return; // already migrated / fresh DB
  db.exec('BEGIN');
  db.exec(`CREATE TABLE mission_new (
    todoId TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    lastNudgeAt INTEGER, lastNudgeKey TEXT, active INTEGER NOT NULL DEFAULT 1, abandonedAt INTEGER, budgetUsd REAL);`);
  db.exec(`INSERT INTO mission_new (todoId, createdAt, updatedAt, lastNudgeAt, lastNudgeKey, active, abandonedAt, budgetUsd)
           SELECT todoId, createdAt, updatedAt, lastNudgeAt, NULL, active, abandonedAt, budgetUsd FROM mission;`);
  db.exec('DROP TABLE mission');
  db.exec('ALTER TABLE mission_new RENAME TO mission');
  db.exec('COMMIT');
}

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const dir = join(project, '.collab');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'mission.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // VERIFY-gate audit trail on each criterion (independent-judge evidence + provenance).
  addColumnIfMissing(db, 'mission_criterion', 'evidence', 'evidence TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedBy', 'verifiedBy TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedAt', 'verifiedAt INTEGER');
  addColumnIfMissing(db, 'mission', 'lastNudgeAt', 'lastNudgeAt INTEGER');
  addColumnIfMissing(db, 'mission', 'lastNudgeKey', 'lastNudgeKey TEXT');
  addColumnIfMissing(db, 'mission', 'lastConductorKey', 'lastConductorKey TEXT');
  addColumnIfMissing(db, 'mission', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'mission', 'abandonedAt', 'abandonedAt INTEGER');
  addColumnIfMissing(db, 'mission', 'awaitingApprovalSince', 'awaitingApprovalSince INTEGER');
  addColumnIfMissing(db, 'mission', 'budgetUsd', 'budgetUsd REAL');
  addColumnIfMissing(db, 'mission', 'handoffDocId', 'handoffDocId TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedAtSha', 'verifiedAtSha TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'evidencePaths', 'evidencePaths TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'reopenCount', 'reopenCount INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'mission_criterion', 'lastReopenSha', 'lastReopenSha TEXT');
  // Archive storage layer: additive, nullable column. New/existing rows read
  // archivedAt = NULL for free — hot by default, no backfill needed.
  addColumnIfMissing(db, 'mission', 'archivedAt', 'archivedAt INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mission_hot ON mission(active) WHERE archivedAt IS NULL');
  migrateDropPhaseMachine(db);
  dbCache.set(project, db);
  return db;
}

/** Drop a possibly-stale cached handle (test isolation / after a rebuild). */
export function _resetMissionDbCache(project?: string): void {
  if (project) {
    dbCache.get(project)?.close();
    dbCache.delete(project);
  } else {
    for (const db of dbCache.values()) db.close();
    dbCache.clear();
  }
}

const nowMs = (): number => Date.now();

function rowToMission(row: Record<string, unknown>): MissionRow {
  return {
    todoId: row.todoId as string,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    lastNudgeAt: (row.lastNudgeAt as number | null) ?? null,
    lastNudgeKey: (row.lastNudgeKey as string | null) ?? null,
    lastConductorKey: (row.lastConductorKey as string | null) ?? null,
    active: (row.active as number | null) == null ? true : (row.active as number) === 1,
    abandonedAt: (row.abandonedAt as number | null) ?? null,
    awaitingApprovalSince: (row.awaitingApprovalSince as number | null) ?? null,
    budgetUsd: (row.budgetUsd as number | null) ?? null,
    handoffDocId: (row.handoffDocId as string | null) ?? null,
    archivedAt: (row.archivedAt as number | null) ?? null,
  };
}

/** Stamp that the mission-loop pass nudged the steward (the nudge debounce). */
export function stampMissionNudge(project: string, todoId: string, key?: string): void {
  openDb(project)
    .prepare('UPDATE mission SET lastNudgeAt = ?, lastNudgeKey = ?, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), key ?? null, nowMs(), todoId);
}

/** Record the debounce fingerprint of the conductor pass's last run for a mission. */
export function stampConductorRun(project: string, todoId: string, key: string): void {
  openDb(project)
    .prepare('UPDATE mission SET lastConductorKey = ?, updatedAt = ? WHERE todoId = ?')
    .run(key, nowMs(), todoId);
}

/**
 * Read a mission's control ROW ONLY — the stored columns, with NO derived status.
 * Deliberately does NOT call collectMissionStatusFacts (a project-wide todo scan plus
 * one ledger scan per live epic), so a caller that only needs the stored fields — e.g.
 * the paginated list path — pays a single indexed row read instead of a full fan-out.
 * `status` on the returned row is whatever rowToMission's cheap default is; callers
 * needing the true derived status must use getMission.
 */
export function getMissionRaw(project: string, todoId: string): MissionRow | undefined {
  const db = openDb(project);
  let row = db.query('SELECT * FROM mission WHERE todoId = ?').get(todoId) as Record<string, unknown> | null;
  if (!row) {
    const resolved = resolveShortId(project, todoId);
    if (resolved && resolved !== todoId) {
      row = db.query('SELECT * FROM mission WHERE todoId = ?').get(resolved) as Record<string, unknown> | null;
    }
  }
  if (!row) return undefined;
  return rowToMission(row);
}

/** Read a mission's control state, or undefined if the node has none yet. */
export function getMission(project: string, todoId: string): MissionRow | undefined {
  const m = getMissionRaw(project, todoId);
  if (!m) return undefined;
  return { ...m, status: deriveMissionStatus(collectMissionStatusFacts(project, m)) };
}

/**
 * Attach (or return existing) loop-control state to a `[MISSION]` node. Idempotent:
 * a second call for the same node returns the existing row unchanged. The CALLER is
 * responsible for having created the `[MISSION]` graph node (via the normal todo path)
 * — this store owns control state only, never node creation, keeping the two concerns uncoupled.
 */
export function upsertMission(
  project: string,
  todoId: string,
  opts: { budgetUsd?: number | null; handoffDocId?: string | null; awaitingApprovalSince?: number | null } = {},
): MissionRow {
  const existing = getMission(project, todoId);
  if (existing) return existing;
  const ts = nowMs();
  openDb(project)
    .prepare(
      `INSERT INTO mission (todoId, createdAt, updatedAt, budgetUsd, handoffDocId, awaitingApprovalSince)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(todoId, ts, ts, opts.budgetUsd ?? null, opts.handoffDocId ?? null, opts.awaitingApprovalSince ?? null);
  return getMission(project, todoId)!;
}

/** Approve a forged mission: clear awaitingApprovalSince (→ status leaves 'unapproved') and make it
 *  ACTIVE for its session so the mission-loop / conductor can drive it. Idempotent. The CALLER
 *  ratifies the constitution separately (approve the mission's proposed constraint records). */
export function setMissionApproved(project: string, todoId: string): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  openDb(project)
    .prepare('UPDATE mission SET awaitingApprovalSince = NULL, active = 1, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), todoId);
  return getMission(project, todoId)!;
}

/** Human-set abandonment stamp. A mission-requirements concept: mark a mission
 *  "done with it" (abandonedAt = now, ms epoch) or clear it (null). Writes the A1
 *  `abandonedAt` column; readers (A2) surface it. Abandoning a mission also clears its
 *  active flag (a mission you're "done with" is not being driven) — see deactivateIfTerminal;
 *  clearing abandonedAt does NOT auto-reactivate (use activateMission to drive it again, which
 *  preserves the one-active-per-session invariant). */
export function setMissionAbandoned(project: string, todoId: string, abandonedAt: number | null): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  openDb(project)
    .prepare('UPDATE mission SET abandonedAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(abandonedAt, nowMs(), todoId);
  deactivateIfTerminal(project, todoId);
  return getMission(project, todoId)!;
}

/** Stamp archivedAt on a batch of missions by their todoId (idempotent). Used by the
 *  throttled archival sweep (archival-sweep.ts) to move converged/abandoned missions
 *  out of the hot (archivedAt IS NULL) index. Returns the row count updated. */
export function archiveMissionsByTodoIds(project: string, todoIds: string[], archivedAtMs: number): number {
  if (todoIds.length === 0) return 0;
  const db = openDb(project);
  const placeholders = todoIds.map(() => '?').join(',');
  const result = db
    .prepare(`UPDATE mission SET archivedAt = ? WHERE todoId IN (${placeholders})`)
    .run(archivedAtMs, ...todoIds);
  return result.changes;
}

export interface ArchivedMissionPage {
  items: MissionRow[];
  nextCursor: string | null; // opaque: `${archivedAt}:${todoId}`, null when exhausted
}

/** Browse the mission archive: newest-archivedAt-first, keyset-paginated over
 *  (archivedAt DESC, todoId DESC) — same cursor shape as listArchivedTodos
 *  (todo-store.ts). Queries the mission table directly (not listMissions, which joins
 *  the live work-graph and would drop a row whose node was itself archived/pruned);
 *  returns raw MissionRow via rowToMission, same as getMission. */
export function listArchivedMissions(
  project: string,
  opts: { limit?: number; cursor?: string | null } = {},
): ArchivedMissionPage {
  const db = openDb(project);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const where = ['archivedAt IS NOT NULL'];
  const params: unknown[] = [];
  if (opts.cursor) {
    const [atStr, todoId] = opts.cursor.split(':');
    const at = Number(atStr);
    if (Number.isFinite(at) && todoId) {
      where.push('(archivedAt < ? OR (archivedAt = ? AND todoId < ?))');
      params.push(at, at, todoId);
    }
  }
  const sql = `SELECT * FROM mission WHERE ${where.join(' AND ')} ORDER BY archivedAt DESC, todoId DESC LIMIT ${limit + 1}`;
  const rows = db.query(sql).all(...(params as never[])) as Record<string, unknown>[];
  const page = rows.slice(0, limit);
  const items = page.map(rowToMission);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? `${last.archivedAt}:${last.todoId}` : null;
  return { items, nextCursor };
}

/** Clear archivedAt on one mission (restore from history). No-op-safe if already hot.
 *  Resolves short ids via resolveShortId (same convention as getMission:270-278). */
export function restoreMission(project: string, todoId: string): MissionRow {
  const db = openDb(project);
  let resolvedId = todoId;
  if (!db.query('SELECT 1 FROM mission WHERE todoId = ?').get(todoId)) {
    const resolved = resolveShortId(project, todoId);
    if (resolved === null) throw new Error(`mission not found: ${todoId}`);
    resolvedId = resolved;
  }
  db.prepare('UPDATE mission SET archivedAt = NULL WHERE todoId = ?').run(resolvedId);
  const row = db.query('SELECT * FROM mission WHERE todoId = ?').get(resolvedId) as Record<string, unknown>;
  return rowToMission(row);
}

/** Delete a mission's control state (does NOT touch the graph node). */
export function deleteMission(project: string, todoId: string): void {
  const db = openDb(project);
  db.prepare('DELETE FROM mission_criterion WHERE todoId = ?').run(todoId);
  db.prepare('DELETE FROM mission WHERE todoId = ?').run(todoId);
}

/** Delete mission control rows (+ their criteria) whose todoId is NOT in the set of
 *  live [MISSION] node ids — i.e. the graph node was dropped/removed without going
 *  through delete_mission. Idempotent self-heal; returns the count pruned. */
export function pruneOrphanMissions(project: string, liveNodeIds: Set<string>): number {
  const db = openDb(project);
  const rows = db.query('SELECT todoId FROM mission').all() as Array<{ todoId: string }>;
  let pruned = 0;
  for (const { todoId } of rows) {
    if (!liveNodeIds.has(todoId)) {
      db.prepare('DELETE FROM mission_criterion WHERE todoId = ?').run(todoId);
      db.prepare('DELETE FROM mission WHERE todoId = ?').run(todoId);
      pruned++;
    }
  }
  return pruned;
}

/** Set a mission's active flag directly (low-level; prefer activateMission to keep
 *  the one-active-per-session invariant). */
export function setMissionActive(project: string, todoId: string, active: boolean): void {
  const res = openDb(project)
    .prepare('UPDATE mission SET active = ?, updatedAt = ? WHERE todoId = ?')
    .run(active ? 1 : 0, nowMs(), todoId);
  if (res.changes === 0) throw new Error(`mission not found: ${todoId}`);
}

/** Self-heal: a mission that has become TERMINAL (converged or human-abandoned) must not keep
 *  active=1. A terminal mission is not being driven, so a stale active flag both misleads the UI
 *  (the ● active badge) and pollutes first-wins conductor selection (the pass filters on
 *  m.mission.active, and every terminal-but-active mission it iterates is dead weight ahead of a
 *  live one). Idempotent: clears active only when the DERIVED status is terminal AND the row is
 *  still active, so it writes at most once per transition and is safe to call liberally. Call it at
 *  the transition points that can flip a mission terminal — abandonment and criterion met/verdict. */
export function deactivateIfTerminal(project: string, todoId: string): void {
  const m = getMission(project, todoId);
  if (m && m.active && isMissionTerminal(m)) {
    setMissionActive(project, todoId, false);
    // B6 observability — only when a write ACTUALLY happened (this branch clears active).
    // Kept cheap: this runs from the listMissions terminal-active sweep, so we record at
    // most once per transition (the guard is idempotent). Fail-open: never break the sweep.
    try {
      recordAutonomousMutation({
        kind: 'terminal-deactivate',
        actor: 'self-heal',
        reason: 'terminal',
        project,
        detail: todoId,
        at: Date.now(),
      });
    } catch { /* fail-open */ }
  }
}

/** Resolve the owning mission todoId for a criterion (criterion setters key off criterionId). */
function missionIdOfCriterion(project: string, criterionId: string): string | undefined {
  const row = openDb(project)
    .query('SELECT todoId FROM mission_criterion WHERE id = ?')
    .get(criterionId) as { todoId: string } | undefined;
  return row?.todoId;
}

/**
 * Make ONE mission the active one for its owning session: set it active and
 * deactivate every OTHER mission owned by the same session (a steward drives one
 * mission at a time). Missions owned by a DIFFERENT session are untouched. Returns
 * the set of todoIds that were deactivated.
 */
export function activateMission(project: string, todoId: string): string[] {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const all = listMissions(project);
  const self = all.find((x) => x.node.id === todoId);
  const session = self?.ownerSession ?? self?.assigneeSession ?? null;
  const deactivated: string[] = [];
  if (session) {
    for (const other of all) {
      if (other.node.id === todoId) continue;
      const os = other.ownerSession ?? other.assigneeSession ?? null;
      if (os === session && other.mission.active) {
        setMissionActive(project, other.node.id, false);
        deactivated.push(other.node.id);
      }
    }
  }
  setMissionActive(project, todoId, true);
  return deactivated;
}

export interface ConductorSelection {
  /** The mission the conductor should drive, or undefined when none is actionable. */
  target?: MissionSummary;
  /** Ids of the OTHER actionable missions — parked purely by NON-selection (never mutated); drives
   *  the caller's fail-open ">1 rival" advisory. */
  rivals: string[];
}

/** Status precedence for unpinned selection: a verify gap is most urgent (a landed epic awaiting its
 *  verdict), then discovery, then a building mission (quietest — work already in flight). Lower first. */
function missionStatusRank(status: string | null | undefined): number {
  switch (status) {
    case 'needs-verify': return 0;
    case 'needs-discovery': return 1;
    case 'building': return 2;
    default: return 3; // blocked / over-budget / any other still-actionable state
  }
}

/** B4 — deterministic TOTAL-ORDER selection of the mission the (unpinned) conductor drives, replacing
 *  first-wins. Filters to the SAME set the old loop considered (active + approved + non-terminal), then
 *  picks a stable winner by status-rank (verify>discover>building) → oldest createdAt → id. Pure over
 *  the store read (listMissions self-heals terminal-active rows first, so a converged mission can never
 *  win); it NEVER writes a mission's active flag — rivals are parked purely by not being selected (the
 *  H4 invariant). Returns the winner + the other actionable ids for a fail-open advisory. */
export function selectConductorMission(project: string): ConductorSelection {
  const actionable = listMissions(project).filter((m) =>
    m.mission.active && m.mission.awaitingApprovalSince == null && m.mission.status != null &&
    !['unapproved', 'abandoned', 'converged'].includes(m.mission.status));
  if (actionable.length === 0) return { rivals: [] };
  const sorted = [...actionable].sort((a, b) => {
    const ra = missionStatusRank(a.mission.status), rb = missionStatusRank(b.mission.status);
    if (ra !== rb) return ra - rb;
    if (a.mission.createdAt !== b.mission.createdAt) return a.mission.createdAt - b.mission.createdAt;
    return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
  });
  const [winner, ...rest] = sorted;
  return { target: winner, rivals: rest.map((m) => m.node.id) };
}

/** True iff the session already has an active, NON-TERMINAL mission (used to default
 *  a newly created mission inactive only when its session is genuinely driving one).
 *  A converged/abandoned mission still carries active=1 but must NOT block a new one. */
export function sessionHasActiveMission(project: string, session: string, excludeTodoId?: string): boolean {
  return listMissions(project).some(
    (m) => m.node.id !== excludeTodoId && m.mission.active && !isMissionTerminal(m.mission) &&
      (m.ownerSession === session || m.assigneeSession === session),
  );
}

// ── Acceptance criteria ─────────────────────────────────────────────────────

export function listCriteria(project: string, todoId: string): MissionCriterion[] {
  const rows = openDb(project)
    .query('SELECT * FROM mission_criterion WHERE todoId = ? ORDER BY "order" ASC, updatedAt ASC')
    .all(todoId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    todoId: r.todoId as string,
    text: r.text as string,
    met: (r.met as number) === 1,
    order: r.order as number,
    updatedAt: r.updatedAt as number,
    evidence: (r.evidence as string | null) ?? null,
    verifiedBy: (r.verifiedBy as string | null) ?? null,
    verifiedAt: (r.verifiedAt as number | null) ?? null,
    verifiedAtSha: (r.verifiedAtSha as string | null) ?? null,
    evidencePaths: r.evidencePaths ? (JSON.parse(r.evidencePaths as string) as string[]) : [],
    reopenCount: (r.reopenCount as number | null) ?? 0,
    lastReopenSha: (r.lastReopenSha as string | null) ?? null,
  }));
}

/** Add an acceptance criterion (a capability assertion the mission converges to). */
export function addCriterion(project: string, todoId: string, text: string): MissionCriterion {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('criterion text is empty');
  const existing = listCriteria(project, todoId);
  const id = `crit_${todoId.slice(0, 8)}_${existing.length + 1}_${nowMs().toString(36)}`;
  const order = existing.length;
  const ts = nowMs();
  openDb(project)
    .prepare('INSERT INTO mission_criterion (id, todoId, text, met, "order", updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
    .run(id, todoId, trimmed, order, ts);
  return { id, todoId, text: trimmed, met: false, order, updatedAt: ts, evidence: null, verifiedBy: null, verifiedAt: null, verifiedAtSha: null, evidencePaths: [], reopenCount: 0, lastReopenSha: null };
}

/** Mark a criterion met / unmet (bare — no verify provenance). Prefer
 *  setCriterionVerdict for a real VERIFY-gate ruling. */
export function setCriterionMet(project: string, criterionId: string, met: boolean): void {
  const res = openDb(project)
    .prepare('UPDATE mission_criterion SET met = ?, updatedAt = ? WHERE id = ?')
    .run(met ? 1 : 0, nowMs(), criterionId);
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);
  // Marking the last gap met can flip the mission to converged (terminal) — drop its active flag.
  const missionId = missionIdOfCriterion(project, criterionId);
  if (missionId) deactivateIfTerminal(project, missionId);
}

/** Normalize an evidence path to the repo-relative namespace that git diff --name-only emits.
 *  Returns null to DROP a path outside the repo, empty, or otherwise invalid. */
function normalizeEvidencePath(project: string, p: string): string | null {
  const trimmed = p.trim();
  if (!trimmed) return null;

  let normalized = trimmed;
  if (isAbsolute(trimmed)) {
    const rel = relative(project, trimmed);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    normalized = rel;
  }

  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  normalized = normalized.split('\\').join('/');

  return normalized === '' ? null : normalized;
}

/**
 * Record an INDEPENDENT VERIFY-gate verdict on a criterion: met/unmet PLUS the
 * evidence the judge cited and who judged it. This is the article's "real gate" —
 * the checker that fills this is meant to be separate from the maker (maker≠checker),
 * and it should fail CLOSED (a criterion it cannot confirm stays met=false).
 */
export function setCriterionVerdict(
  project: string,
  criterionId: string,
  verdict: { met: boolean; evidence?: string | null; verifiedBy?: string | null; verifiedAtSha?: string | null; evidencePaths?: string[] },
): void {
  const normalizedPaths = verdict.evidencePaths
    ? Array.from(new Set(
        verdict.evidencePaths
          .map((p) => normalizeEvidencePath(project, p))
          .filter((p): p is string => p != null),
      ))
    : null;

  const res = openDb(project)
    .prepare('UPDATE mission_criterion SET met = ?, evidence = ?, verifiedBy = ?, verifiedAt = ?, verifiedAtSha = ?, evidencePaths = ?, updatedAt = ? WHERE id = ?')
    .run(
      verdict.met ? 1 : 0,
      verdict.evidence ?? null,
      verdict.verifiedBy ?? null,
      nowMs(),
      verdict.verifiedAtSha ?? null,
      normalizedPaths ? JSON.stringify(normalizedPaths) : null,
      nowMs(),
      criterionId,
    );
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);
  // A verify verdict that meets the last gap can flip the mission to converged (terminal) — drop
  // its active flag so a converged mission never sits active=1 (misleads UI + first-wins selection).
  const missionId = missionIdOfCriterion(project, criterionId);
  if (missionId) deactivateIfTerminal(project, missionId);
}

/** Edit a criterion's text (the acceptance assertion). Does not change its met/verdict. */
export function updateCriterionText(project: string, criterionId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('criterion text is empty');
  const res = openDb(project)
    .prepare('UPDATE mission_criterion SET text = ?, updatedAt = ? WHERE id = ?')
    .run(trimmed, nowMs(), criterionId);
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);
}

export function removeCriterion(project: string, criterionId: string): void {
  openDb(project).prepare('DELETE FROM mission_criterion WHERE id = ?').run(criterionId);
}

/** Un-verify a criterion: null its entire VERIFY verdict so an independent re-check
 *  must re-judge it (met=false, verifiedAt/evidence/verifiedBy/verifiedAtSha → null).
 *  evidencePaths is PRESERVED so a subsequent land can still match it before re-verify. */
export function clearCriterionVerdict(
  project: string,
  criterionId: string,
  opts: { countReopen?: boolean; reopenSha?: string | null } = {},
): number {
  const setClause: string[] = ['met = 0', 'evidence = NULL', 'verifiedBy = NULL', 'verifiedAt = NULL', 'verifiedAtSha = NULL', 'updatedAt = ?'];
  const params: (string | number | null)[] = [nowMs()];

  if (opts.countReopen) {
    setClause.push('reopenCount = reopenCount + 1');
    setClause.push('lastReopenSha = ?');
    params.push(opts.reopenSha ?? null);
  }

  params.push(criterionId);

  const query = `UPDATE mission_criterion SET ${setClause.join(', ')} WHERE id = ?`;
  const res = openDb(project).prepare(query).run(...params);
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);

  const row = openDb(project)
    .query('SELECT reopenCount FROM mission_criterion WHERE id = ?')
    .get(criterionId) as Record<string, unknown> | null;
  return (row?.reopenCount as number) ?? 0;
}

export function enqueueRecheck(project: string, r: { criterionId: string; todoId: string; reason: string; landedSha?: string | null }): void {
  openDb(project)
    .prepare('INSERT INTO mission_recheck (criterionId, todoId, reason, landedSha, enqueuedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(criterionId) DO UPDATE SET reason=excluded.reason, landedSha=excluded.landedSha, enqueuedAt=excluded.enqueuedAt')
    .run(r.criterionId, r.todoId, r.reason, r.landedSha ?? null, nowMs());
}

export function listPendingRechecks(project: string): MissionRecheck[] {
  const rows = openDb(project)
    .prepare('SELECT * FROM mission_recheck ORDER BY enqueuedAt ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    criterionId: row.criterionId as string,
    todoId: row.todoId as string,
    reason: row.reason as string,
    landedSha: (row.landedSha as string | null) ?? null,
    enqueuedAt: row.enqueuedAt as number,
  }));
}

export function clearRecheck(project: string, criterionId: string): void {
  openDb(project).prepare('DELETE FROM mission_recheck WHERE criterionId = ?').run(criterionId);
}

// ── Reopen churn management ─────────────────────────────────────────────────

const REOPEN_CARD_THRESHOLD = 5;

function raiseReopenChurnCard(
  project: string, session: string, c: MissionCriterion,
): void {
  const text = c.text.length > 80 ? `${c.text.slice(0, 77)}...` : c.text;
  const questionText =
    `Mission criterion "${text}" (${c.id}) has been re-opened by ${REOPEN_CARD_THRESHOLD}+ lands ` +
    `invalidating its evidence — its evidencePaths pin may be too broad; review/narrow it.`;
  try {
    createEscalation({
      project, session, kind: 'mission-criterion-churn',
      questionText, todoId: c.todoId, operatorGated: false,
    });
  } catch {
    // The card is advisory. A supervisor-db hiccup must NEVER break the safety clear.
  }
}

/** Verification-as-event: given the paths a land touched, un-verify every MET criterion
 *  whose evidencePaths intersect them and enqueue a per-criterion re-check. Pure path-set
 *  intersection — NO LLM. Returns the affected {criterionId, todoId} list (for audit). */
export function unverifyCriteriaForLandedPaths(
  project: string,
  landedPaths: string[],
  opts: { landedSha?: string | null } = {},
): { criterionId: string; todoId: string }[] {
  if (landedPaths.length === 0) return [];
  const landed = new Set(landedPaths);
  const affected: { criterionId: string; todoId: string }[] = [];
  for (const m of listMissions(project)) {
    for (const c of listCriteria(project, m.node.id)) {
      if (!c.met) continue;
      if (!c.evidencePaths.some((p) => landed.has(p))) continue;
      const session = m.ownerSession ?? m.assigneeSession ?? 'mission-loop';
      const reopenCount = clearCriterionVerdict(project, c.id, {
        countReopen: true, reopenSha: opts.landedSha ?? null,
      });
      enqueueRecheck(project, { criterionId: c.id, todoId: c.todoId, reason: 'land-diff-intersects-evidence', landedSha: opts.landedSha ?? null });
      affected.push({ criterionId: c.id, todoId: c.todoId });
      if (reopenCount >= REOPEN_CARD_THRESHOLD) raiseReopenChurnCard(project, session, { ...c, reopenCount });
    }
  }
  return affected;
}

// ── Convergence rollup ──────────────────────────────────────────────────────

export interface MissionCriterionFacts {
  /** Criterion id — lets consumers zip facts back onto listCriteria rows. */
  id: string;
  met: boolean;
  verifiedAt: number | null;
  servingEpicState: 'landed' | 'open' | 'none';
  /** True when a serving OPEN epic has live motion (a pending/paused leaf run, or a
   *  ready/in_progress child leaf). An open epic with NO motion — e.g. filed but never
   *  approved, or orphaned by a conductor context recycle — is NOT live: its criterion
   *  derives 'discover' so the nudge loop keeps pointing at it instead of a mission
   *  sitting silently at 'building' forever (the unattended-stall trap). */
  servingEpicLive: boolean;
  /** LIFETIME count of epics EVER filed for this criterion — INCLUDING dropped and done
   *  ones (the `servingEpic*` fields above only see non-dropped epics and miss the thrash
   *  history). This is the SERVE-CAP thrash signal: the autonomous conductor re-files a
   *  serving epic every tick a criterion reads 'discover', so a criterion that structurally
   *  needs a HUMAN action (a live measurement / deploy / rescope) accrues an unbounded pile
   *  of dropped serving epics. Once this hits CRITERION_SERVE_CAP the conductor stops
   *  re-filing and escalates once instead (see deriveCriterionAction). */
  servedEpicCount: number;
}

export interface MissionStatusFacts {
  /** Optional (defaults falsy) so existing fact fixtures need no change; set by collectMissionStatusFacts. */
  awaitingApproval?: boolean;
  abandonedAt: number | null;
  budgetUsd: number | null;
  spendUsd: number;
  hasBlockedLeaf: boolean;   // a leaf run rejected or blocked (parked/rejected/escalation/unapproved-split)
  hasBuildingLeaf: boolean;  // a leaf run in flight (pending/paused)
  hasLandedEpic: boolean;    // a mission epic reached status 'done'
  hasOpenEpic: boolean;      // a mission epic is neither done nor dropped
  criteria: MissionCriterionFacts[];
}

/** Per-criterion next action. The mission converges criterion by criterion,
 *  CONCURRENTLY — the scalar MissionStatus is only the headline; this is the
 *  actionable state the conductor drives from. */
export type CriterionAction =
  | 'met'       // criterion satisfied — nothing to do
  | 'building'  // a serving epic is open WITH live motion — wait for it
  | 'verify'    // a serving epic landed, verdict not yet recorded — run the independent gate
  | 'discover'  // no live serving epic (none filed, filed-but-stalled, or landed-and-verify-said-no) — file/approve an epic
  | 'escalate'; // capped: CRITERION_SERVE_CAP+ serving epics filed and still unmet — stop re-filing, escalate to a human ONCE

/** After this many serving epics have been filed for ONE criterion and it is STILL
 *  unmet (a fresh 'discover'), stop re-filing and escalate to a human once. A criterion
 *  whose satisfaction structurally needs a HUMAN action the headless daemon cannot do
 *  (a live measurement, a deploy, a rescope) otherwise makes the conductor file a new
 *  serving epic every tick — the overnight thrash this cap kills. */
export const CRITERION_SERVE_CAP = 3;

export function deriveCriterionAction(c: MissionCriterionFacts): CriterionAction {
  // verify BEFORE met: a met-but-unverified criterion still owes the independent gate a
  // verdict (verification-as-event — `met` alone is a self-grade until verifiedAt stamps it).
  if (c.servingEpicState === 'landed' && c.verifiedAt == null) return 'verify';
  if (c.met) return 'met';
  if (c.servingEpicState === 'open' && c.servingEpicLive) return 'building';
  // Would be 'discover' — but if we have already filed CRITERION_SERVE_CAP serving epics
  // for this criterion and it is STILL unmet with no live serving epic, re-filing is thrash:
  // escalate to a human once instead. ONLY the discover path caps — verify/building/met are
  // never flipped (they mean real progress, not a stuck re-file loop).
  if (c.servedEpicCount >= CRITERION_SERVE_CAP) return 'escalate';
  return 'discover';
}

/** First-match-wins. PER-CRITERION since decision mission-discovery-per-criterion (f9bc952f)
 *  (supersedes the A2 brief's global `!hasOpenEpic` clause and its building>discovery
 *  precedence): one epic building no longer masks discovery for OTHER criteria, so a
 *  conductor can serve every open gap concurrently. 'building' is now the QUIETEST
 *  non-terminal state — it only surfaces when nothing is left to discover or verify. */
export function deriveMissionStatus(f: MissionStatusFacts): MissionStatus {
  if (f.abandonedAt != null) return 'abandoned';
  if (f.awaitingApproval) return 'unapproved'; // forged, not yet human-approved — never driven
  if (f.budgetUsd != null && f.spendUsd >= f.budgetUsd) return 'over-budget';
  if (f.hasBlockedLeaf) return 'blocked';
  const actions = f.criteria.map(deriveCriterionAction);
  if (actions.includes('verify')) return 'needs-verify';
  if (actions.includes('discover')) return 'needs-discovery';
  if (f.hasBuildingLeaf || actions.includes('building')) return 'building';
  if (f.criteria.length > 0 && actions.every((a) => a === 'met')) return 'converged';
  return 'needs-discovery'; // default: nothing landed/built/verified yet (incl. no criteria)
}

/**
 * A CHEAP, facts-free approximation of deriveMissionStatus for the paginated list glance.
 * Uses only the stored mission columns plus the epic-status slice the list path has already
 * read — no collectMissionStatusFacts, so no project-wide todo scan and no ledger scan.
 *
 * The terminal flags (abandoned/unapproved) are EXACT because they read stored columns.
 * The 'converged' arm is a PROXY (all epics done) — good enough for a list badge, but not
 * the real capability gauge, which needs criteria verdicts. Anything else reads 'building'.
 * A caller that needs the true status must ask for it: getMission, or listMissions with
 * `withFacts: true`.
 */
export function deriveCheapMissionStatus(
  m: Pick<MissionRow, 'abandonedAt' | 'awaitingApprovalSince'>,
  epics: readonly { status: string }[],
): MissionStatus {
  if (m.abandonedAt != null) return 'abandoned';
  if (m.awaitingApprovalSince != null) return 'unapproved';
  if (epics.length > 0 && epics.every((e) => e.status === 'done')) return 'converged';
  return 'building';
}

/** Gather the facts deriveMissionStatus needs from the work-graph + ledger. Does NOT call
 *  getMission/getMissionRollup (no recursion); the caller passes the already-read MissionRow. */
/** Blocked/building state is LIVE only from epics still in play — a done/landed epic's historical
 *  parked/building leaf-runs are not a live blocker (they would otherwise pin a converged, landed
 *  mission at "blocked" forever, per the precedence blocked>converged). Pure + exported for test. */
export function liveRunsOf<T extends { epicId: string | null }>(
  runs: readonly T[],
  epics: readonly { id: string; status: string }[],
): T[] {
  const liveEpicIds = new Set(epics.filter((e) => e.status !== 'done').map((e) => e.id));
  return runs.filter((r) => r.epicId != null && liveEpicIds.has(r.epicId));
}

export function collectMissionStatusFacts(project: string, m: MissionRow): MissionStatusFacts {
  // listTodos defaults to archivedAt IS NULL (hot-only) — archived todos never leak into
  // allTodos/epics/runs below, so an archived leaf is invisible to the facts scan.
  const allTodos = listTodos(project, { includeCompleted: true });
  const epics = allTodos.filter(
    (t) => t.parentId === m.todoId && t.status !== 'dropped' && isEpic(t),
  );
  // Serve-cap thrash signal: ALL epic children EVER filed under this mission, INCLUDING
  // dropped ones (the non-dropped `epics` list above cannot see the re-file history). Used
  // ONLY to count servedEpicCount per criterion — never for live/landed state.
  const allEpicsEver = allTodos.filter((t) => t.parentId === m.todoId && isEpic(t));
  // getMission is a hot, fundamental read — it must NOT crash because the OPTIONAL worker-ledger
  // read failed (e.g. the ledger DB is momentarily unavailable / not yet created). Degrade to
  // no run-facts: the mission still derives a status from its criteria + epic states.
  let runs: ReturnType<typeof listLeafRuns> = [];
  try {
    runs = epics.flatMap((e) => listLeafRuns({ project, epicId: e.id }));
  } catch {
    runs = [];
  }
  // Blocked/building state is LIVE only from epics still in play (see liveRunsOf) — a converged
  // mission that once had a parked leaf under a since-landed epic must not read "blocked" forever
  // (and nudge). Spend still counts ALL runs (total cost is historical by nature).
  const liveRuns = liveRunsOf(runs, epics);
  const liveEpicIds = new Set(epics.filter((e) => e.status !== 'done').map((e) => e.id));
  const byId = new Map(allTodos.map((t) => [t.id, t]));
  // A leaf (non-epic) child of a LIVE epic that is ready-to-claim or in-flight is
  // building even before any ledger run exists — closes the approve→claim gap and
  // the ready-unclaimed case that pending/paused ledger runs alone miss.
  const hasBuildingChildLeaf = allTodos.some(
    (t) => t.parentId != null && liveEpicIds.has(t.parentId) && !isEpic(t) &&
      (derivedStatus(t, byId) === 'ready' || derivedStatus(t, byId) === 'in_progress'),
  );
  const criteria = listCriteria(project, m.todoId);
  return {
    awaitingApproval: m.awaitingApprovalSince != null,
    abandonedAt: m.abandonedAt,
    budgetUsd: m.budgetUsd,
    spendUsd: runs.reduce((s, r) => s + r.costUsd, 0),
    hasBlockedLeaf: liveRuns.some((r) => r.finalOutcome === 'rejected' || r.finalOutcome === 'blocked'),
    hasBuildingLeaf: liveRuns.some((r) => r.finalOutcome === 'pending' || r.finalOutcome === 'paused') || hasBuildingChildLeaf,
    hasLandedEpic: epics.some((e) => e.status === 'done'),
    hasOpenEpic: epics.some((e) => e.status !== 'done'), // dropped already filtered out
    criteria: criteria.map((c) => {
      // MULTI-EDGE (e7d3c02b): an epic serves a criterion via the primary edge OR the
      // servesCriterionIds set — one right-sized epic can serve several aspect criteria.
      const serving = epics.filter((e) => e.servesCriterionId === c.id || (e.servesCriterionIds ?? []).includes(c.id));
      const servingEpicState: 'landed' | 'open' | 'none' =
        serving.some((e) => e.status !== 'done') ? 'open'
        : serving.some((e) => e.status === 'done') ? 'landed'
        : 'none';
      // Live = the serving open epic has actual motion: a pending/paused ledger run, or a
      // ready/in_progress child leaf (covers approve→claim gap AND a ready land leaf).
      // A filed-but-unapproved epic is NOT live — its criterion stays 'discover'.
      const servingEpicLive = serving.some((e) =>
        e.status !== 'done' && (
          runs.some((r) => r.epicId === e.id && (r.finalOutcome === 'pending' || r.finalOutcome === 'paused')) ||
          allTodos.some((t) => t.parentId === e.id && !isEpic(t) &&
            (derivedStatus(t, byId) === 'ready' || derivedStatus(t, byId) === 'in_progress'))
        ));
      // Lifetime serve count — dropped/done included, so a criterion re-served every tick
      // accrues its true thrash history (the serve-cap escalation trigger).
      const servedEpicCount = allEpicsEver.filter(
        (e) => e.servesCriterionId === c.id || (e.servesCriterionIds ?? []).includes(c.id),
      ).length;
      return { id: c.id, met: c.met, verifiedAt: c.verifiedAt, servingEpicState, servingEpicLive, servedEpicCount };
    }),
  };
}

/** listCriteria rows enriched with the derived per-criterion action + serving-epic state.
 *  This is what get_mission exposes so a conductor can act on EVERY open gap in one pass
 *  instead of driving off the scalar status alone. */
export function listCriteriaWithActions(
  project: string,
  todoId: string,
): (MissionCriterion & { action: CriterionAction; servingEpicState: 'landed' | 'open' | 'none'; servedEpicCount: number })[] {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const facts = collectMissionStatusFacts(project, m);
  const byId = new Map(facts.criteria.map((c) => [c.id, c]));
  return listCriteria(project, todoId).map((c) => {
    const f = byId.get(c.id);
    return {
      ...c,
      action: f ? deriveCriterionAction(f) : 'discover',
      servingEpicState: f?.servingEpicState ?? 'none',
      servedEpicCount: f?.servedEpicCount ?? 0,
    };
  });
}

/**
 * Compute the mission's two convergence gauges. MECHANICAL counts the mission
 * node's direct `[EPIC]` children (this iteration's build lanes) done-vs-total.
 * CAPABILITY counts acceptance criteria met-vs-total — the real "is the mission
 * done" signal. `converged` is true iff ≥1 criterion exists and all are met.
 *
 * Reads descendant status from the work-graph (todo-store) at call time — no
 * denormalized copy, so it can never drift from the board.
 */
/** A mission's node identity + control state + rollup + criteria + the mechanical
 *  epics under it, for the UI. `ownerSession`/`assigneeSession` tie the mission to a
 *  session (attribution + session-scoped filtering). */
export interface MissionSummary {
  node: { id: string; title: string; status: string };
  /** The session that owns/drives this mission (mission ↔ session tie). */
  ownerSession: string | null;
  assigneeSession: string | null;
  mission: MissionRow;
  rollup: MissionRollup;
  /** Acceptance criteria (the CAPABILITY gauge's underlying items). */
  criteria: MissionCriterion[];
  /** The mission's direct `[EPIC]` children (the MECHANICAL gauge's items). */
  epics: Array<{ id: string; title: string; status: string; acceptanceStatus: string | null }>;
}

/**
 * List missions in a project: each `[MISSION]` work-graph root that HAS loop-control
 * state (upsertMission was called). Joins the graph node (by `kind === 'mission'`)
 * with the sidecar mission row + rollup + criteria + its epic children.
 * Missions with a node but no control row are skipped. For the Plan-board Missions
 * surface. Pass `opts.session` to return ONLY missions owned by / assigned to that
 * session (the mission↔session tie) — omit for all project missions.
 *
 * `opts.withFacts` (DEFAULT TRUE) controls per-mission cost. With facts, each mission
 * costs two full collectMissionStatusFacts scans (one via getMission, one via
 * getMissionRollup) — i.e. ~2N project-wide todo scans plus ~2 ledger scans per epic for
 * N missions. That fan-out is what wedges a high-live-row project. Pass `withFacts: false`
 * to take the cheap path: a single indexed mission-row read per mission, with `status` and
 * `rollup` built from deriveCheapMissionStatus + the already-read epic/criteria slices —
 * zero collectMissionStatusFacts calls. The default stays TRUE so every existing caller's
 * output is bit-identical; opting into the cheap path is explicit, per call site.
 */
export function listMissions(
  project: string,
  opts: { session?: string; includeArchived?: boolean; onlyArchived?: boolean; withFacts?: boolean } = {},
): MissionSummary[] {
  const withFacts = opts.withFacts !== false;
  const all = listTodos(project, { includeCompleted: true });
  const roots = all.filter(
    (t) => t.parentId == null && t.status !== 'dropped' && isMission(t),
  );
  // Self-heal: prune mission control rows whose graph node is gone/dropped (e.g. a
  // mission removed via a node-drop rather than delete_mission). Keeps mission.db
  // from accumulating orphans. Cheap: we already have the live node id set.
  pruneOrphanMissions(project, new Set(roots.map((t) => t.id)));
  const out: MissionSummary[] = [];
  for (const node of roots) {
    // Cheap path: read the stored row only, then layer on a facts-free status derived from
    // the epic slice below. Full path: getMission, which derives from a full facts scan.
    const epicsForNode = all
      .filter((t) => t.parentId === node.id && t.status !== 'dropped' && isEpic(t))
      .map((e) => ({ id: e.id, title: e.title, status: e.status, acceptanceStatus: e.acceptanceStatus ?? null }));
    const raw = withFacts ? getMission(project, node.id) : getMissionRaw(project, node.id);
    let mission = raw && !withFacts
      ? { ...raw, status: deriveCheapMissionStatus(raw, epicsForNode) }
      : raw;
    if (!mission) continue; // a mission-kind node without control state — not a real mission
    if (opts.onlyArchived) { if (mission.archivedAt == null) continue; }
    else if (!opts.includeArchived) { if (mission.archivedAt != null) continue; }
    // Self-heal: a TERMINAL mission (converged/abandoned) must not linger active=1. The transition
    // setters (setMissionAbandoned / criterion setters) clear it going forward; this sweep also
    // catches historical rows and any active flip set outside those paths, since a stale active pads
    // first-wins conductor selection and lights the UI ● active badge. One write per mission, then inert.
    if (mission.active && isMissionTerminal(mission)) {
      setMissionActive(project, node.id, false);
      mission = { ...mission, active: false };
    }
    if (opts.session && node.ownerSession !== opts.session && node.assigneeSession !== opts.session) {
      continue; // session-scoped filter (mission↔session tie)
    }
    const epics = epicsForNode;
    const criteria = listCriteria(project, node.id); // per-mission indexed lookup, not a facts scan
    // Cheap rollup: the same two gauges, counted from the epic slice + criteria rows we
    // already hold. `gaps`/`awaitingVerify` are per-criterion ACTIONS, which are only
    // derivable from facts — the cheap path reports 0 rather than pay the scan.
    const mechDone = epics.filter((e) => e.status === 'done').length;
    const capMet = criteria.filter((c) => c.met).length;
    const rollup: MissionRollup = withFacts
      ? getMissionRollup(project, node.id)
      : {
          todoId: node.id,
          mechanical: { done: mechDone, total: epics.length },
          capability: { met: capMet, total: criteria.length },
          converged: criteria.length > 0 && capMet === criteria.length,
          stopped: isMissionTerminal(mission),
          status: mission.status ?? deriveCheapMissionStatus(mission, epics),
          gaps: 0,
          awaitingVerify: 0,
        };
    out.push({
      node: { id: node.id, title: node.title, status: node.status },
      ownerSession: node.ownerSession ?? null,
      assigneeSession: node.assigneeSession ?? null,
      mission,
      rollup,
      criteria,
      epics,
    });
  }
  return out;
}

/** Hard ceiling on live (non-terminal) missions per project — guards against mass-minting
 *  (e.g. a runaway forge loop). Counts missions whose derived status is not terminal
 *  (see isMissionTerminal): converged/abandoned missions don't count against the ceiling. */
export const MAX_MISSIONS_PER_PROJECT = 25;

/** Rolling window + burst ceiling for mission CREATION calls (not mission count) — catches
 *  a tight retry/loop minting many missions in a short span even under the count ceiling. */
export const MISSION_CREATE_RATE_WINDOW_MS = 10 * 60_000; // 10 min
export const MAX_MISSIONS_PER_WINDOW = 5;

/** Per-project rolling log of mission-creation call timestamps (ms epoch), for the burst-rate
 *  throttle. In-memory only — same proven shape as coordinator-live.ts's lastBuildPassMs; a
 *  process restart resets the window, which is fine (it only bounds bursts within a live process). */
const missionCreateTimestamps = new Map<string, number[]>();

/** Escape hatch for the smoke-test harness ONLY. Defaults to enforced (unset/any value other
 *  than '1' enforces the ceiling); set MERMAID_SKIP_MISSION_CEILING=1 to bypass in a harness
 *  that intentionally mints many missions. */
const CEILING_BYPASS_ENV = 'MERMAID_SKIP_MISSION_CEILING';

/**
 * Guard called at the START of every mission-creation path (create_mission, forge_mission)
 * BEFORE any row/node is created. Throws a teaching Error when either:
 *   (a) the project already has >= MAX_MISSIONS_PER_PROJECT non-terminal missions, or
 *   (b) >= MAX_MISSIONS_PER_WINDOW missions were created for this project within the last
 *       MISSION_CREATE_RATE_WINDOW_MS.
 * On success, records `now` into the rolling creation-timestamp log (so the call itself
 * counts toward the next check). `now` is injectable for deterministic tests.
 */
export function assertMissionCreationAllowed(project: string, now: number = nowMs()): void {
  if (process.env[CEILING_BYPASS_ENV] === '1') return;

  const nonTerminalCount = listMissions(project).filter((m) => !isMissionTerminal(m.mission)).length;
  if (nonTerminalCount >= MAX_MISSIONS_PER_PROJECT) {
    throw new Error(
      `assertMissionCreationAllowed: project already has ${nonTerminalCount} non-terminal missions ` +
      `(ceiling ${MAX_MISSIONS_PER_PROJECT}). Converge, abandon, or delete an existing mission before ` +
      `creating another — set ${CEILING_BYPASS_ENV}=1 to bypass in a test harness only.`
    );
  }

  const recent = (missionCreateTimestamps.get(project) ?? []).filter(
    (t) => now - t < MISSION_CREATE_RATE_WINDOW_MS,
  );
  if (recent.length >= MAX_MISSIONS_PER_WINDOW) {
    throw new Error(
      `assertMissionCreationAllowed: ${recent.length} missions created for this project in the last ` +
      `${MISSION_CREATE_RATE_WINDOW_MS}ms (ceiling ${MAX_MISSIONS_PER_WINDOW} per window). Slow down — ` +
      `set ${CEILING_BYPASS_ENV}=1 to bypass in a test harness only.`
    );
  }
  recent.push(now);
  missionCreateTimestamps.set(project, recent);
}

/** Test seam: clear the per-project mission-creation rate-throttle log (all projects, or one). */
export function _resetMissionCreateThrottle(project?: string): void {
  if (project === undefined) missionCreateTimestamps.clear();
  else missionCreateTimestamps.delete(project);
}

export function getMissionRollup(project: string, todoId: string): MissionRollup {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const epics = listTodos(project, { includeCompleted: true }).filter(
    (t) => t.parentId === todoId && t.status !== 'dropped' && isEpic(t),
  );
  const mechDone = epics.filter((e) => e.status === 'done').length;
  const criteria = listCriteria(project, todoId);
  const capMet = criteria.filter((c) => c.met).length;
  const facts = collectMissionStatusFacts(project, m);
  const actions = facts.criteria.map(deriveCriterionAction);
  return {
    todoId,
    mechanical: { done: mechDone, total: epics.length },
    capability: { met: capMet, total: criteria.length },
    converged: criteria.length > 0 && capMet === criteria.length,
    stopped: isMissionTerminal(m),
    status: deriveMissionStatus(facts),
    gaps: actions.filter((a) => a === 'discover').length,
    awaitingVerify: actions.filter((a) => a === 'verify').length,
  };
}
