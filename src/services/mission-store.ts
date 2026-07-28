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
import { listTodos, resolveShortId, isHollowLand, stampMissionNodeApprovedIfNull, type Todo } from './todo-store.ts';
import { isEpic, isMission } from './todo-kind.ts';
import { listLeafRuns, getMissionSpend } from './ledger-stats.ts';
import { derivedStatus } from './claimability.ts';
import { createEscalation } from './supervisor-store.ts';
import { recordAutonomousMutation } from './autonomy-log.ts';
import { CRITERION_SERVE_CAP, REOPEN_CARD_THRESHOLD, CHILDLESS_SERVE_GRACE_MS, CONDUCTOR_LEADER_STALE_TICKS, CONDUCTOR_BEAT_MS } from './harness-caps.ts';
import { fireConductorKick } from './orchestrator-kick.ts';
import { isMissionStalled } from './mission-stall.ts';
import { isLanded, isEpicStatusDone } from './epic-landedness.ts';
import { criterionEdgesOf, todoServesCriterion } from './criterion-edges.ts';
import { getEpicLandRecord } from './epic-land-record-store.ts';
import { proofForEpic as predProofForEpic, servingEpicLive as predServingEpicLive, isHollowDone as predIsHollowDone, countsTowardServeCap as predCountsTowardServeCap, servingLandIsNewerThanVerdict as predServingLandIsNewerThanVerdict } from './mission-status-predicates.ts';
export { CHILDLESS_SERVE_GRACE_MS } from './harness-caps.ts';

/** Derived-on-read capability status of a mission (never stored; computed from the
 *  work-graph + criteria + leaf-run ledger each read). Precedence is first-match-wins in
 *  the order listed in deriveMissionStatus. */
export type MissionStatus =
  | 'unapproved'      // awaitingApprovalSince set — forged (e.g. from a doc) but not yet human-approved
  | 'abandoned'       // abandonedAt set
  | 'over-budget'     // spendUsd >= budgetUsd
  | 'stalled'         // the mission loop has taken no action for a STALLED reason past the grace window
  | 'blocked'         // a mission leaf is parked/rejected, escalated, or an unapproved split
  | 'building'        // leaves in flight AND nothing left to discover/verify (quietest non-terminal state)
  | 'needs-verify'    // some criterion's serving epic landed, verdict not yet recorded
  | 'needs-discovery' // some criterion has no LIVE serving epic (per-criterion — others may be building)
  | 'converged'       // every criterion met
  | 'closed';         // closedAt set — frozen converged history

/** A mission is terminal (the loop has stopped) when it converged, a human abandoned it, or it
 *  was closed (a converged mission's terminality frozen durably — see setMissionClosed). */
export function isMissionTerminal(
  m: Pick<MissionRow, 'status' | 'abandonedAt'> & { closedAt?: number | null },
): boolean {
  return m.closedAt != null || m.abandonedAt != null || m.status === 'converged' || m.status === 'closed';
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
  /** Wall-clock ms of the last conductor pass — the pass clock a later throttle reads. Null
   *  until the first conductor pass runs for this mission. */
  lastConductorPassAt: number | null;
  /** The pass's own self-issued key from its last run, distinct from the debounce
   *  lastConductorKey. Null until the first pass supplies one. */
  lastConductorSelfKey: string | null;
  /** Whether this is the ACTIVE mission for its owning session. A steward drives ONE
   *  mission at a time, so at most one mission per session is active; the mission-loop
   *  pass only drives active missions. Default true (a lone mission just works). */
  active: boolean;
  /** FIFO position within the owning session's queue while active=0 and approved
   *  (set by enqueueMission). Null when not queued (active, terminal, or unapproved
   *  and never enqueued). Cleared by activateMission/promoteQueuedMissions on promotion. */
  queuePos: number | null;
  /** Human-set abandonment stamp (ms epoch), or null = active. A mission-requirements
   *  concept: an abandoned mission with unmet criteria is otherwise indistinguishable
   *  from an in-progress one; this makes "done with it" explicit. */
  abandonedAt: number | null;
  /** Durable "converged and frozen" stamp (ms epoch), or null. Set once by deactivateIfTerminal
   *  the first time a mission's derived status reads 'converged' — makes terminality durable
   *  against a later reopened criterion verdict (a `closed` mission's status stays 'closed'
   *  even if a stray land reopens one of its criteria; see unverifyCriteriaForLandedPaths,
   *  which skips closed missions entirely so this can't happen going forward). Never set for
   *  abandonment (setMissionAbandoned does not touch this column). */
  closedAt: number | null;
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

export interface CriterionVerdictHistoryEntry {
  id: string;
  criterionId: string;
  todoId: string;
  met: boolean;
  evidence: string | null;
  verifiedBy: string | null;
  verifiedAt: number | null;
  verifiedAtSha: string | null;
  evidencePaths: string[];
  clearedAt: number;
  clearReason: string | null;
  reopenSha: string | null;
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
  /** True when this rollup came from the CHEAP (facts-free) path — listMissions with
   *  `withFacts: false`. `gaps`/`awaitingVerify` are reported as 0 (not computed — they
   *  need the per-criterion serving-epic/ledger facts scan the cheap path deliberately
   *  skips) and `status` is deriveCheapMissionStatus's approximation, not the true derived
   *  status (which can disagree — e.g. cheap reads 'building' while the full path reads
   *  'needs-discovery'). A caller making a scheduling/conductor decision off gaps/
   *  awaitingVerify/status MUST check this flag and fall back to getMission /
   *  getMissionRollup (or listMissions with withFacts:true) when it's true. False (the
   *  default) when computed from the full collectMissionStatusFacts scan. */
  factsOmitted: boolean;
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
  closedAt INTEGER,
  budgetUsd REAL,
  handoffDocId TEXT,
  queuePos INTEGER
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
CREATE TABLE IF NOT EXISTS mission_criterion_verdict_history (
  id TEXT PRIMARY KEY,
  criterionId TEXT NOT NULL,
  todoId TEXT NOT NULL,
  met INTEGER NOT NULL,
  evidence TEXT,
  verifiedBy TEXT,
  verifiedAt INTEGER,
  verifiedAtSha TEXT,
  evidencePaths TEXT,
  clearedAt INTEGER NOT NULL,
  clearReason TEXT,
  reopenSha TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcvh_criterion ON mission_criterion_verdict_history(criterionId);
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
  addColumnIfMissing(db, 'mission', 'lastConductorPassAt', 'lastConductorPassAt INTEGER');
  addColumnIfMissing(db, 'mission', 'lastConductorSelfKey', 'lastConductorSelfKey TEXT');
  addColumnIfMissing(db, 'mission', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'mission', 'abandonedAt', 'abandonedAt INTEGER');
  // Note: migrateDropPhaseMachine (below) rebuilds the pre-closedAt mission table shape when
  // it runs (a legacy DB still carrying a `phase` column), which would drop this column on
  // that pass. Left alone deliberately (see the blueprint) — a legacy DB re-gets closedAt on
  // the NEXT openDb() call, since this addColumnIfMissing runs before migrateDropPhaseMachine
  // every time and no-ops once the column already exists.
  addColumnIfMissing(db, 'mission', 'closedAt', 'closedAt INTEGER');
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
  addColumnIfMissing(db, 'mission', 'queuePos', 'queuePos INTEGER');
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
    lastConductorPassAt: (row.lastConductorPassAt as number | null) ?? null,
    lastConductorSelfKey: (row.lastConductorSelfKey as string | null) ?? null,
    active: (row.active as number | null) == null ? true : (row.active as number) === 1,
    queuePos: (row.queuePos as number | null) ?? null,
    abandonedAt: (row.abandonedAt as number | null) ?? null,
    closedAt: (row.closedAt as number | null) ?? null,
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

/** Record the debounce fingerprint of the conductor pass's last run for a mission, plus the
 *  pass clock (lastConductorPassAt) and, when supplied, the pass's self-issued key
 *  (lastConductorSelfKey). selfKey is written only when present in opts — omitting it leaves
 *  a previously-stamped self key untouched. */
export function stampConductorRun(
  project: string,
  todoId: string,
  key: string,
  opts?: { at?: number; selfKey?: string | null }
): void {
  const at = opts?.at ?? nowMs();
  const db = openDb(project);
  if (opts && 'selfKey' in opts) {
    db.prepare('UPDATE mission SET lastConductorKey = ?, lastConductorPassAt = ?, lastConductorSelfKey = ?, updatedAt = ? WHERE todoId = ?')
      .run(key, at, opts.selfKey ?? null, nowMs(), todoId);
  } else {
    db.prepare('UPDATE mission SET lastConductorKey = ?, lastConductorPassAt = ?, updatedAt = ? WHERE todoId = ?')
      .run(key, at, nowMs(), todoId);
  }
}

/**
 * Centralized short-id resolution for every public mission-store entry point keyed by a
 * todoId/missionId. Repo convention: a short id is the LEADING 8 hex chars of the full
 * todo id, resolved by `startsWith` (see resolveShortId, todo-store.ts). A store function
 * that looks a mission (or its criteria/rollup) up by SQL-exact todoId would silently see
 * EMPTY results for a short id — that bug already bit once (get_mission had to hand-roll a
 * resolve-then-reuse workaround in mission-tools.ts before this helper existed, because
 * getMissionRollup/listCriteriaWithActions did not resolve on their own). Every public
 * entry point that takes a todoId now resolves through this ONE helper first, so a short
 * id behaves identically everywhere — no more per-call re-resolution.
 *
 * Tries the id as given first (the common, cheap full-id case — a single indexed lookup).
 * On a miss, resolves the prefix via resolveShortId. resolveShortId THROWS on an ambiguous
 * prefix (matches >1 todo); this swallows that and returns undefined instead — resolveDepId
 * -style (claimability.ts:152): an ambiguous OR dangling short id is NOT-FOUND, never a
 * silently-picked guess.
 */
function resolveMissionTodoId(project: string, todoId: string): string | undefined {
  const db = openDb(project);
  if (db.query('SELECT 1 FROM mission WHERE todoId = ?').get(todoId)) return todoId;
  try {
    return resolveShortId(project, todoId) ?? undefined;
  } catch {
    return undefined; // ambiguous prefix — never guess
  }
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
  const resolved = resolveMissionTodoId(project, todoId);
  if (!resolved) return undefined;
  const db = openDb(project);
  const row = db.query('SELECT * FROM mission WHERE todoId = ?').get(resolved) as Record<string, unknown> | null;
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

export function stampMissionNodeApproved(project: string, todoId: string, approvedBy: string): boolean {
  return stampMissionNodeApprovedIfNull(project, todoId, approvedBy);
}

/** Approve a forged mission: clear awaitingApprovalSince (→ status leaves 'unapproved'), then either
 *  activate it for its session (no rival active mission) or enqueue it behind the session's
 *  already-active mission — a rival's active flag is never clobbered. Idempotent. The CALLER
 *  ratifies the constitution separately (approve the mission's proposed constraint records). */
export function setMissionApproved(project: string, todoId: string, approvedBy?: string | null): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const id = m.todoId; // canonical — a short id must behave identically from here on
  openDb(project)
    .prepare('UPDATE mission SET awaitingApprovalSince = NULL, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), id);
  if (approvedBy) stampMissionNodeApproved(project, id, approvedBy);
  const all = listMissions(project);
  const self = all.find((x) => x.node.id === id);
  const session = self?.ownerSession ?? self?.assigneeSession ?? null;
  if (session && sessionHasActiveMission(project, session, id)) {
    enqueueMission(project, id);
  } else {
    setMissionActive(project, id, true);
  }
  return getMission(project, id)!;
}

/** One-shot idempotent backfill: reconcile mission approval state between mission.db
 *  and todos.db. Iterates approved missions (those without awaitingApprovalSince set)
 *  and stamps their [mission]-kind todo nodes with approvedAt/approvedBy if not already set.
 *  Returns the count of stamped rows so callers can log progress. */
export function backfillMissionNodeApproval(project: string, approvedBy = 'backfill'): number {
  const missions = listMissions(project, { withFacts: false, includeArchived: true });
  let stamped = 0;
  for (const m of missions) {
    if (m.mission.awaitingApprovalSince != null) continue; // still unapproved — skip
    if (stampMissionNodeApprovedIfNull(project, m.node.id, approvedBy)) stamped++;
  }
  return stamped;
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
  const id = m.todoId; // canonical — a short id must behave identically from here on
  openDb(project)
    .prepare('UPDATE mission SET abandonedAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(abandonedAt, nowMs(), id);
  deactivateIfTerminal(project, id);
  return getMission(project, id)!;
}

/** Durable "converged and frozen" stamp. Called ONCE by deactivateIfTerminal the first time a
 *  mission's derived status reads 'converged' — makes terminality durable so a later land that
 *  happens to reopen one of the mission's criteria (unverifyCriteriaForLandedPaths) cannot
 *  un-converge stopped history. NOT called for abandonment — setMissionAbandoned keeps its own
 *  status and never touches this column. */
export function setMissionClosed(project: string, todoId: string, at: number | null): void {
  const id = resolveMissionTodoId(project, todoId) ?? todoId;
  const res = openDb(project)
    .prepare('UPDATE mission SET closedAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(at, nowMs(), id);
  if (res.changes === 0) throw new Error(`mission not found: ${todoId}`);
}

/** Auditable budget mutation: the ONLY supported path for raising/lowering/clearing a
 *  mission's `budgetUsd` ceiling (formerly a raw-SQL free-for-all). Every call is attributed
 *  (`actor`) and logged to the autonomy ring (`kind: 'budget-change'`) so a later raise is
 *  traceable to who did it and why. A lower value that would silently flip the mission
 *  over-budget is refused unless `opts.allowBelowSpend` is set; raising or clearing is
 *  never blocked. `null` clears the ceiling back to the project default. */
export function setMissionBudget(
  project: string,
  todoId: string,
  budgetUsd: number | null,
  opts: { actor: string; reason?: string; allowBelowSpend?: boolean },
): MissionRow {
  if (typeof opts?.actor !== 'string' || !opts.actor.trim()) {
    throw new Error('setMissionBudget requires a non-empty actor');
  }
  if (budgetUsd !== null && !(typeof budgetUsd === 'number' && Number.isFinite(budgetUsd) && budgetUsd > 0)) {
    throw new Error(`budgetUsd must be a finite number > 0 (or null to clear): ${String(budgetUsd)}`);
  }
  const id = resolveMissionTodoId(project, todoId);
  if (!id) throw new Error(`mission not found: ${todoId}`);
  const row = getMissionRaw(project, id)!;
  const previousBudgetUsd = row.budgetUsd;
  const spendUsdAtChange = collectMissionStatusFacts(project, row).spendUsd;
  if (
    budgetUsd != null &&
    previousBudgetUsd != null &&
    budgetUsd < previousBudgetUsd &&
    budgetUsd <= spendUsdAtChange &&
    !opts.allowBelowSpend
  ) {
    throw new Error(
      `budgetUsd ${budgetUsd} is at or below current spend ${spendUsdAtChange} — pass allowBelowSpend to force`,
    );
  }
  openDb(project)
    .prepare('UPDATE mission SET budgetUsd = ?, updatedAt = ? WHERE todoId = ?')
    .run(budgetUsd, nowMs(), id);
  recordAutonomousMutation({
    kind: 'budget-change',
    actor: opts.actor,
    reason: opts.reason?.trim() || 'budget-set',
    project,
    detail: JSON.stringify({ missionId: id, previousBudgetUsd, budgetUsd, spendUsdAtChange }),
  });
  return getMission(project, id)!;
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
 *  Resolves short ids via the centralized resolveMissionTodoId helper. */
export function restoreMission(project: string, todoId: string): MissionRow {
  const db = openDb(project);
  const resolvedId = resolveMissionTodoId(project, todoId);
  if (!resolvedId) throw new Error(`mission not found: ${todoId}`);
  db.prepare('UPDATE mission SET archivedAt = NULL WHERE todoId = ?').run(resolvedId);
  const row = db.query('SELECT * FROM mission WHERE todoId = ?').get(resolvedId) as Record<string, unknown>;
  return rowToMission(row);
}

/** Delete a mission's control state (does NOT touch the graph node). Resolves a short
 *  id; a not-found id is a silent no-op (unchanged prior behavior — this never threw). */
export function deleteMission(project: string, todoId: string): void {
  const db = openDb(project);
  const id = resolveMissionTodoId(project, todoId) ?? todoId;
  db.prepare('DELETE FROM mission_criterion WHERE todoId = ?').run(id);
  db.prepare('DELETE FROM mission WHERE todoId = ?').run(id);
  import('./mission-digest.ts').then((m) => m.deleteMissionDigest(project, id)).catch(() => {});
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
 *  the one-active-per-session invariant). Resolves a short id. */
export function setMissionActive(project: string, todoId: string, active: boolean): void {
  const id = resolveMissionTodoId(project, todoId) ?? todoId;
  const res = openDb(project)
    .prepare('UPDATE mission SET active = ?, updatedAt = ? WHERE todoId = ?')
    .run(active ? 1 : 0, nowMs(), id);
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
  if (!m) return;
  if (isMissionTerminal(m) && m.status === 'converged' && m.closedAt == null) {
    setMissionClosed(project, m.todoId, Date.now());
  }
  if (m.active && isMissionTerminal(m)) {
    setMissionActive(project, m.todoId, false);
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
export function missionIdOfCriterion(project: string, criterionId: string): string | undefined {
  const row = openDb(project)
    .query('SELECT todoId FROM mission_criterion WHERE id = ?')
    .get(criterionId) as { todoId: string } | undefined;
  return row?.todoId;
}

/**
 * Make ONE mission the active one for its project: set it active and deactivate
 * every OTHER mission in the project that is active (a steward drives one mission
 * at a time, per project). Returns the set of todoIds that were deactivated.
 */
export function activateMission(project: string, todoId: string): string[] {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const id = m.todoId; // canonical — a short id must behave identically from here on
  const all = listMissions(project);
  const deactivated: string[] = [];
  for (const other of all) {
    if (other.node.id === id) continue;
    if (other.mission.active) {
      enqueueMission(project, other.node.id);
      deactivated.push(other.node.id);
    }
  }
  setMissionActive(project, id, true);
  openDb(project)
    .prepare('UPDATE mission SET queuePos = NULL, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), id);
  return deactivated;
}

/**
 * Enqueue a mission for its project: set active=0 and assign the next FIFO queuePos
 * (1 + max queuePos over every OTHER queued mission in the project, any owner). Ordering
 * is per project. Does not touch awaitingApprovalSince (approval gate is orthogonal to queueing).
 */
export function enqueueMission(project: string, todoId: string): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const id = m.todoId; // canonical — a short id must behave identically from here on
  const all = listMissions(project);
  let maxPos = 0;
  for (const other of all) {
    if (other.node.id === id) continue;
    if (other.mission.queuePos != null) {
      maxPos = Math.max(maxPos, other.mission.queuePos);
    }
  }
  const nextPos = maxPos + 1;
  openDb(project)
    .prepare('UPDATE mission SET active = 0, queuePos = ?, updatedAt = ? WHERE todoId = ?')
    .run(nextPos, nowMs(), id);
  return getMission(project, id)!;
}

/**
 * Promote the next queued mission for the project if it currently has no active
 * non-terminal mission. A candidate is queued (active=0), APPROVED
 * (awaitingApprovalSince == null), non-terminal, and has queuePos set. Never touches
 * a mission whose awaitingApprovalSince is set, and never writes awaitingApprovalSince
 * itself (the approval gate is untouched). No-op if the project already has an active mission.
 * Returns the todoIds that were promoted (at most one).
 */
export function promoteQueuedMissions(project: string): string[] {
  if (projectHasActiveMission(project)) return [];
  const all = listMissions(project);
  const candidates = all.filter((m) =>
    !m.mission.active &&
    m.mission.awaitingApprovalSince == null &&
    m.mission.queuePos != null &&
    !isMissionTerminal(m.mission)
  );
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => (a.mission.queuePos! - b.mission.queuePos!));
  const winner = candidates[0];
  openDb(project)
    .prepare('UPDATE mission SET active = 1, queuePos = NULL, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), winner.node.id);
  return [winner.node.id];
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

/** True iff `m` was selected as the conductor's leader (by the total order below) too long
 *  ago to still be trusted: its pass clock (lastConductorPassAt, falling back to createdAt
 *  for a never-run mission) is older than CONDUCTOR_LEADER_STALE_TICKS beats AND it still
 *  has a 'discover' or 'verify' gap (a fresh 'building' leader is legitimately quiet, not
 *  stalled). The listCriteriaWithActions call is only paid for clock-stale candidates —
 *  it re-derives the full status facts and is not cheap. Fails OPEN (returns false) if the
 *  mission can't be read (listCriteriaWithActions throws 'mission not found') — an
 *  unreadable mission keeps the turn rather than being skipped. */
function isStalledLeader(project: string, m: MissionSummary, now: number, beatMs: number): boolean {
  const last = m.mission.lastConductorPassAt ?? m.mission.createdAt;
  if (now - last <= CONDUCTOR_LEADER_STALE_TICKS * beatMs) return false;
  try {
    const withActions = listCriteriaWithActions(project, m.node.id);
    return withActions.some((c) => c.action === 'discover' || c.action === 'verify');
  } catch {
    return false;
  }
}

/** B4 — deterministic TOTAL-ORDER selection of the mission the (unpinned) conductor drives, replacing
 *  first-wins. Filters to the SAME set the old loop considered (active + approved + non-terminal), then
 *  orders by status-rank (verify>discover>building) → oldest createdAt → id. Pure over the store read
 *  (listMissions self-heals terminal-active rows first, so a converged mission can never win); it NEVER
 *  writes a mission's active flag — rivals are parked purely by not being selected (the H4 invariant).
 *
 *  LEADER-YIELD: the head of the total order does not win unconditionally. If it was selected long ago
 *  (its lastConductorPassAt is stale by CONDUCTOR_LEADER_STALE_TICKS beats) and still has an actionable
 *  discover/verify gap, it is treated as stalled and the first non-stalled entry of the SAME order wins
 *  instead — a leader whose fingerprint debounce keeps returning "no change" no longer starves every
 *  rival forever. If every candidate is stalled, index 0 still wins (the conductor must never go idle).
 *  This is still read-only selection: a skipped stale leader remains in `rivals`, never has `active`
 *  written, and the H4 invariant (rivals parked purely by non-selection) holds unchanged. */
export function selectConductorMission(
  project: string,
  opts: { now?: number; beatMs?: number } = {},
): ConductorSelection {
  const actionable = listMissions(project).filter((m) =>
    m.mission.active && m.mission.awaitingApprovalSince == null && m.mission.status != null &&
    !['unapproved', 'abandoned', 'converged', 'closed'].includes(m.mission.status));
  if (actionable.length === 0) return { rivals: [] };
  const sorted = [...actionable].sort((a, b) => {
    const ra = missionStatusRank(a.mission.status), rb = missionStatusRank(b.mission.status);
    if (ra !== rb) return ra - rb;
    if (a.mission.createdAt !== b.mission.createdAt) return a.mission.createdAt - b.mission.createdAt;
    return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
  });
  if (sorted.length === 1) {
    return { target: sorted[0], rivals: [] };
  }
  const now = opts.now ?? nowMs();
  const beatMs = opts.beatMs ?? CONDUCTOR_BEAT_MS;
  let winnerIndex = sorted.findIndex((m) => !isStalledLeader(project, m, now, beatMs));
  if (winnerIndex === -1) winnerIndex = 0;
  const winner = sorted[winnerIndex];
  const rivals = sorted.filter((_, i) => i !== winnerIndex).map((m) => m.node.id);
  return { target: winner, rivals };
}

/** True iff the project already has an active, NON-TERMINAL mission (ignoring any
 *  mission with the given excludeTodoId). A converged/abandoned mission still carries
 *  active=1 but must NOT count as active per this check. */
export function projectHasActiveMission(project: string, excludeTodoId?: string): boolean {
  return listMissions(project).some(
    (m) => m.node.id !== excludeTodoId && m.mission.active && !isMissionTerminal(m.mission),
  );
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

/** Add an acceptance criterion (a capability assertion the mission converges to).
 *  Resolves a short todoId to the canonical id first — inserting against the raw short id
 *  would create a mission_criterion row that listCriteria(fullId) can never see. */
export function addCriterion(project: string, todoId: string, text: string): MissionCriterion {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('criterion text is empty');
  const resolved = resolveMissionTodoId(project, todoId);
  if (!resolved) throw new Error(`mission not found: ${todoId}`);
  const existing = listCriteria(project, resolved);
  const id = `crit_${resolved.slice(0, 8)}_${existing.length + 1}_${nowMs().toString(36)}`;
  const order = existing.length;
  const ts = nowMs();
  openDb(project)
    .prepare('INSERT INTO mission_criterion (id, todoId, text, met, "order", updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
    .run(id, resolved, trimmed, order, ts);
  return { id, todoId: resolved, text: trimmed, met: false, order, updatedAt: ts, evidence: null, verifiedBy: null, verifiedAt: null, verifiedAtSha: null, evidencePaths: [], reopenCount: 0, lastReopenSha: null };
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
  fireConductorKick(`criterion-verdict:${criterionId.slice(0, 8)}`);
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
 *  evidencePaths is PRESERVED so a subsequent land can still match it before re-verify.
 *  If the criterion had provenance (verifiedAt/evidence/verifiedBy not all null), preserves
 *  the prior verdict in mission_criterion_verdict_history for audit. */
export function clearCriterionVerdict(
  project: string,
  criterionId: string,
  opts: { countReopen?: boolean; reopenSha?: string | null; reason?: string } = {},
): number {
  const db = openDb(project);
  const nowTs = nowMs();

  // SELECT prior verdict columns before UPDATE to preserve in history if needed.
  const priorRow = db
    .query('SELECT id, todoId, met, evidence, verifiedBy, verifiedAt, verifiedAtSha, evidencePaths FROM mission_criterion WHERE id = ?')
    .get(criterionId) as Record<string, unknown> | null;

  if (!priorRow) throw new Error(`criterion not found: ${criterionId}`);

  // Only insert history row if verdict has provenance (at least one of verifiedAt/evidence/verifiedBy is set).
  const hasProvenance = priorRow.verifiedAt != null || priorRow.evidence != null || priorRow.verifiedBy != null;

  db.transaction(() => {
    if (hasProvenance) {
      const historyId = crypto.randomUUID();
      const priorMet = priorRow.met as number;
      const priorEvidence = (priorRow.evidence as string | null) ?? null;
      const priorVerifiedBy = (priorRow.verifiedBy as string | null) ?? null;
      const priorVerifiedAt = (priorRow.verifiedAt as number | null) ?? null;
      const priorVerifiedAtSha = (priorRow.verifiedAtSha as string | null) ?? null;
      const priorEvidencePaths = (priorRow.evidencePaths as string | null) ?? null;
      db.prepare(
        'INSERT INTO mission_criterion_verdict_history (id, criterionId, todoId, met, evidence, verifiedBy, verifiedAt, verifiedAtSha, evidencePaths, clearedAt, clearReason, reopenSha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        historyId,
        priorRow.id as string,
        priorRow.todoId as string,
        priorMet,
        priorEvidence,
        priorVerifiedBy,
        priorVerifiedAt,
        priorVerifiedAtSha,
        priorEvidencePaths,
        nowTs,
        opts.reason ?? null,
        opts.reopenSha ?? null,
      );
    }

    const setClause: string[] = ['met = 0', 'evidence = NULL', 'verifiedBy = NULL', 'verifiedAt = NULL', 'verifiedAtSha = NULL', 'updatedAt = ?'];
    const params: (string | number | null)[] = [nowTs];

    if (opts.countReopen) {
      setClause.push('reopenCount = reopenCount + 1');
      setClause.push('lastReopenSha = ?');
      params.push(opts.reopenSha ?? null);
    }

    params.push(criterionId);

    const query = `UPDATE mission_criterion SET ${setClause.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...params);
  })();

  const row = db
    .query('SELECT reopenCount FROM mission_criterion WHERE id = ?')
    .get(criterionId) as Record<string, unknown> | null;
  return (row?.reopenCount as number) ?? 0;
}

export function listCriterionVerdictHistory(project: string, criterionId: string): CriterionVerdictHistoryEntry[] {
  const rows = openDb(project)
    .query('SELECT * FROM mission_criterion_verdict_history WHERE criterionId = ? ORDER BY clearedAt DESC, rowid DESC')
    .all(criterionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    criterionId: r.criterionId as string,
    todoId: r.todoId as string,
    met: (r.met as number) === 1,
    evidence: (r.evidence as string | null) ?? null,
    verifiedBy: (r.verifiedBy as string | null) ?? null,
    verifiedAt: (r.verifiedAt as number | null) ?? null,
    verifiedAtSha: (r.verifiedAtSha as string | null) ?? null,
    evidencePaths: r.evidencePaths ? (JSON.parse(r.evidencePaths as string) as string[]) : [],
    clearedAt: r.clearedAt as number,
    clearReason: (r.clearReason as string | null) ?? null,
    reopenSha: (r.reopenSha as string | null) ?? null,
  }));
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

// REOPEN_CARD_THRESHOLD moved to harness-caps.ts (the harness's single loop-breaker
// cap surface); imported above.

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
  const skipped: string[] = [];
  for (const m of listMissions(project)) {
    if (!m.mission.active || isMissionTerminal(m.mission)) {
      skipped.push(m.node.id);
      continue;
    }
    for (const c of listCriteria(project, m.node.id)) {
      if (!c.met) continue;
      if (!c.evidencePaths.some((p) => landed.has(p))) continue;
      const session = m.ownerSession ?? m.assigneeSession ?? 'mission-loop';
      const reopenCount = clearCriterionVerdict(project, c.id, {
        countReopen: true, reopenSha: opts.landedSha ?? null, reason: 'land-diff-intersects-evidence',
      });
      enqueueRecheck(project, { criterionId: c.id, todoId: c.todoId, reason: 'land-diff-intersects-evidence', landedSha: opts.landedSha ?? null });
      affected.push({ criterionId: c.id, todoId: c.todoId });
      if (reopenCount >= REOPEN_CARD_THRESHOLD) raiseReopenChurnCard(project, session, { ...c, reopenCount });
    }
  }
  if (skipped.length > 0) {
    console.warn(`[mission] unverify skipped ${skipped.length} terminal/inactive mission(s): ${skipped.join(', ')}`);
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
  /** Count of this criterion's serving-epic leaf runs whose `finalOutcome` is 'rejected' or
   *  'blocked'. Feeds the conductor debounce fingerprint so a leaf flipping to rejected/parked
   *  breaks debounce even when the derived action is unchanged (still 'building'). */
  rejectedParkedCount: number;
  /** Sha the last recorded verdict was measured against. Optional — absent ⇒ freshness check fails closed. */
  verifiedAtSha?: string | null;
  /** Sha the CURRENT serving epic landed at. */
  servingEpicLandSha?: string | null;
  /** Timestamp the current serving epic's land record was stamped. */
  servingEpicLandedAt?: number | null;
}

export interface MissionStatusFacts {
  /** Optional (defaults falsy) so existing fact fixtures need no change; set by collectMissionStatusFacts. */
  awaitingApproval?: boolean;
  abandonedAt: number | null;
  /** Optional (defaults falsy) so existing fact fixtures need no change; set by
   *  collectMissionStatusFacts from the mission row's closedAt column. */
  closedAt?: number | null;
  budgetUsd: number | null;
  spendUsd: number;
  hasBlockedLeaf: boolean;   // a leaf run rejected or blocked (parked/rejected/escalation/unapproved-split)
  hasBuildingLeaf: boolean;  // a leaf run in flight (pending/paused)
  hasLandedEpic: boolean;    // a mission epic reached status 'done'
  hasOpenEpic: boolean;      // a mission epic is neither done nor dropped
  /** NO SILENT STOP (mission a6ab522b): the mission-loop has been taking no action for a
   *  STALLED reason (see mission-stall.ts) longer than MISSION_STALL_GRACE_MS. Optional so
   *  existing fact fixtures need no change; set by collectMissionStatusFacts. */
  stalled?: boolean;
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

// CRITERION_SERVE_CAP moved to harness-caps.ts (the harness's single loop-breaker cap
// surface); imported above and re-exported here so existing importers (conductor-pass.ts,
// tests) keep working unchanged.
export { CRITERION_SERVE_CAP };

export function deriveCriterionAction(c: MissionCriterionFacts): CriterionAction {
  // verify BEFORE met: a met-but-unverified criterion, OR one whose serving epic has landed
  // a newer commit than the last verdict, still owes the independent gate a fresh verdict
  // (verification-as-event — `met` alone is a self-grade until verifiedAt stamps it).
  if (c.servingEpicState === 'landed' && (c.verifiedAt == null || predServingLandIsNewerThanVerdict(c))) return 'verify';
  if (c.met) return 'met';
  if (c.servingEpicState === 'open' && c.servingEpicLive) return 'building';
  // Would be 'discover' — but if we have already filed CRITERION_SERVE_CAP serving epics
  // for this criterion and it is STILL unmet with no live serving epic, re-filing is thrash:
  // escalate to a human once instead. ONLY the discover path caps — verify/building/met are
  // never flipped (they mean real progress, not a stuck re-file loop).
  if (c.servedEpicCount >= CRITERION_SERVE_CAP) return 'escalate';
  return 'discover';
}

/** Shared terminal-prefix deriver for both mission-status paths.
 *  Reads only terminal stored columns — exact on both facts-backed and cheap paths.
 *  Post-prefix arms deliberately differ: deriveMissionStatus is a facts-backed capability
 *  gauge; deriveCheapMissionStatus is a list-badge proxy. Precedence: closed > abandoned > unapproved. */
export function deriveTerminalMissionPrefix(
  t: { closedAt?: number | null; abandonedAt?: number | null; awaitingApproval: boolean },
): MissionStatus | null {
  if (t.closedAt != null) return 'closed';
  if (t.abandonedAt != null) return 'abandoned';
  if (t.awaitingApproval) return 'unapproved';
  return null;
}

/** First-match-wins. PER-CRITERION since decision mission-discovery-per-criterion (f9bc952f)
 *  (supersedes the A2 brief's global `!hasOpenEpic` clause and its building>discovery
 *  precedence): one epic building no longer masks discovery for OTHER criteria, so a
 *  conductor can serve every open gap concurrently. 'building' is now the QUIETEST
 *  non-terminal state — it only surfaces when nothing is left to discover or verify. */
export function deriveMissionStatus(f: MissionStatusFacts): MissionStatus {
  const terminal = deriveTerminalMissionPrefix({ ...f, awaitingApproval: f.awaitingApproval === true });
  if (terminal != null) return terminal;
  const actions = f.criteria.map(deriveCriterionAction);
  // CONVERGED WINS OVER OVER-BUDGET (missions f6b447fa / 0a497c22): a mission that met every
  // acceptance criterion SUCCEEDED — that is the strongest terminal state, and it must drop out
  // of the open-missions list rather than linger labelled 'over-budget'. A mission that crossed
  // its ceiling ON THE WAY to 5/5 was still a success; calling it over-budget misrepresents a win
  // as a blown-budget failure and keeps a done mission dangling "in play". The overspend stays
  // permanently in the cost ledger and the re-bet card history is untouched — only the status
  // stops lying. This also matches deriveCheapMissionStatus, which already ranks converged first.
  if (f.criteria.length > 0 && actions.every((a) => a === 'met')) return 'converged';
  // over-budget applies only to a mission that has NOT converged: the breaker fired, the loop
  // stopped serving, and a re-bet is genuinely owed — that one belongs in the open list.
  if (f.budgetUsd != null && f.spendUsd >= f.budgetUsd) return 'over-budget';
  // NO SILENT STOP (mission a6ab522b): a mission whose loop has been stuck past the grace
  // window must NOT keep reading like healthy work in flight. This sits ABOVE blocked/
  // building deliberately — 'blocked' says a leaf needs attention, 'stalled' says nobody is
  // coming at all, and the second fact is the one that went unseen for 1h45m. It sits BELOW
  // over-budget so the more specific (and separately carded) budget crossing keeps its own
  // status. The flag self-clears the moment the loop sees a QUIET reason or a nudge fires.
  if (f.stalled) return 'stalled';
  if (f.hasBlockedLeaf) return 'blocked';
  if (actions.includes('verify')) return 'needs-verify';
  if (actions.includes('discover')) return 'needs-discovery';
  if (f.hasBuildingLeaf || actions.includes('building')) return 'building';
  return 'needs-discovery'; // default: nothing landed/built/verified yet (incl. no criteria)
}

/**
 * A CHEAP, facts-free approximation of deriveMissionStatus for the paginated list glance.
 * Uses only the stored mission columns plus the epic-status slice the list path has already
 * read — no collectMissionStatusFacts, so no project-wide todo scan and no ledger scan.
 *
 * The 'converged' arm is a PROXY (all epics done) — good enough for a list badge, but not
 * the real capability gauge, which needs criteria verdicts. Anything else reads 'building'.
 * A caller that needs the true status must ask for it: getMission, or listMissions with
 * `withFacts: true`.
 */
export function deriveCheapMissionStatus(
  m: Pick<MissionRow, 'abandonedAt' | 'awaitingApprovalSince'> & { closedAt?: number | null },
  _epics: readonly { status: string }[],
  criteria: readonly { met: boolean }[] = [],
  stalled: boolean = false,
): MissionStatus {
  const terminal = deriveTerminalMissionPrefix({ closedAt: m.closedAt, abandonedAt: m.abandonedAt, awaitingApproval: m.awaitingApprovalSince != null });
  if (terminal != null) return terminal;
  // Converged = the CAPABILITY gauge: every acceptance criterion met (stored verdicts — cheap, no
  // facts scan), NOT "all epics done". Keying off epics gave the wrong badge both ways: a
  // criteria-converged mission with zero epics read 'building' (aad41fd5), and an all-epics-done
  // mission with an unmet criterion read 'converged' (b90bfa21). The criteria are the true
  // done-signal, so this keeps `status` consistent with the `converged` flag. Non-converged reads
  // 'building' (the list badge; the detail view carries the exact building/needs-discovery status).
  if (criteria.length > 0 && criteria.every((c) => c.met)) return 'converged';
  // NO SILENT STOP (mission a6ab522b). This is THE line that read "BUILDING" for 1h45m on a
  // mission that had crossed its budget and would never move again: the cheap path cannot
  // afford a spend scan, so everything non-converged fell through to 'building'. The stall
  // clock is an in-memory lookup (no scan), so the badge can now tell "the daemon is on it"
  // apart from "nobody is coming" without paying for facts.
  if (stalled) return 'stalled';
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

export function collectMissionStatusFacts(project: string, m: MissionRow, now: number = Date.now()): MissionStatusFacts {
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
  //
  // CRITICAL: a ledger-read failure is NOT the same signal as "no runs happened", and must NOT be
  // degraded to that. Treating a throw as empty runs would make servingEpicLive/hasBuildingLeaf
  // read false for a mission that is actually mid-build, flipping deriveCriterionAction/
  // deriveMissionStatus to 'discover'/'needs-discovery' — which makes the autonomous conductor
  // RE-FILE a serving epic for a criterion that's already being served. That direction of error
  // costs real money (a duplicate epic + build spend). The other direction — a momentary ledger
  // hiccup misread as "still building" — just delays one conductor pass. So on a ledger-read
  // failure we fail toward LIVE: every epic still open (status !== 'done') is treated as though it
  // has motion, via ledgerUnavailable below, rather than falling through to "no serving epic".
  let runs: ReturnType<typeof listLeafRuns> = [];
  let ledgerUnavailable = false;
  try {
    runs = epics.flatMap((e) => listLeafRuns({ project, epicId: e.id }));
  } catch {
    runs = [];
    ledgerUnavailable = true;
  }
  // SERVE-CAP LEDGER (dropped-inclusive). `runs` above is built from `epics`, which EXCLUDES
  // dropped epics — so a dropped serving epic has no ledger rows in it at all. The serve cap must
  // still see the work such an epic did: dropping an epic cascades its leaves to `dropped` and
  // clears their `acceptanceStatus`, so leaf acceptance alone cannot prove a dropped epic ever ran.
  // Used ONLY by countsTowardServeCap — `runs` keeps its live scoping for spend/liveness.
  let capRuns = runs;
  if (!ledgerUnavailable) {
    try {
      capRuns = runs.concat(
        allEpicsEver.filter((e) => e.status === 'dropped')
          .flatMap((e) => listLeafRuns({ project, epicId: e.id })),
      );
    } catch { capRuns = runs; }
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
  let spendUsd = 0;
  try {
    spendUsd = getMissionSpend(project, m.todoId, { listTodos: () => allTodos }).costUsd;
  } catch {
    spendUsd = 0;
  }
  // PROOF-AWARE LAND (verify-action-lies-on-partial-land / joining-leaf-omitted): a landed epic
  // must not flip a criterion to 'verify' (capability-landed, awaiting the gate) unless it actually
  // PROVED that criterion — a delivered (done, non-rejected) descendant leaf carries this
  // criterion's id in servesCriterionId(s). Without it, an epic that lands with its proving leaf
  // dropped/orphaned still advertises EVERY criterion it served as verify-ready, and a generous
  // verify can rubber-stamp the unproven one. LEGACY FALLBACK: an epic whose descendant leaves
  // carry NO criterion tags at all (pre-leaf-tagging authoring) cannot be proof-checked, so trust
  // the epic→criterion edge (prior behaviour) rather than wedge the criterion at 'discover' forever
  // — but ONLY once every descendant leaf has settled (done/accepted/dropped); an untagged epic
  // still holding an unfinished proof-leaf must not escape via this fallback.
  const childrenByParent = new Map<string, Todo[]>();
  for (const t of allTodos) {
    if (t.parentId == null) continue;
    const arr = childrenByParent.get(t.parentId);
    if (arr) arr.push(t); else childrenByParent.set(t.parentId, [t]);
  }
  const proofByEpic = new Map<string, { proven: Set<string>; tagsAnyLeaf: boolean; hasUnfinishedLeaf: boolean }>();
  const proofForEpic = (epicId: string) => predProofForEpic(epicId, childrenByParent, proofByEpic);
  return {
    awaitingApproval: m.awaitingApprovalSince != null,
    abandonedAt: m.abandonedAt,
    closedAt: m.closedAt,
    budgetUsd: m.budgetUsd,
    spendUsd,
    // Ledger unavailable: we cannot see the leaf runs that would normally reveal a blocked
    // (rejected/parked) leaf, so we can't claim 'blocked' either — false here, same as the prior
    // degrade-to-empty behavior (a ledger hiccup must never manufacture a block it can't see).
    hasBlockedLeaf: liveRuns.some((r) => r.finalOutcome === 'rejected' || r.finalOutcome === 'blocked'),
    // Ledger unavailable: force LIVE (building) rather than fall through to the ledger-derived
    // signal, which would read false and let a still-building mission misread as idle/discoverable
    // (see the comment above the try/catch — this is the safe-direction failure).
    hasBuildingLeaf: ledgerUnavailable
      ? liveEpicIds.size > 0
      : liveRuns.some((r) => r.finalOutcome === 'pending' || r.finalOutcome === 'paused') || hasBuildingChildLeaf,
    hasLandedEpic: epics.some((e) => isEpicStatusDone(e)), // Deliberately narrow: widening to landedAt-stamped epics would flip missions to needs-verify/converged earlier than today
    hasOpenEpic: epics.some((e) => e.status !== 'done'), // dropped already filtered out
    // In-memory lookup (mission-stall.ts) — no scan, no I/O, and TTL'd so a project whose
    // mission-loop stopped running cannot latch a mission at 'stalled' forever.
    stalled: isMissionStalled(project, m.todoId, now),
    criteria: criteria.map((c) => {
      // MULTI-EDGE (e7d3c02b): an epic serves a criterion via the primary edge OR the
      // servesCriterionIds set — one right-sized epic can serve several aspect criteria.
      const serving = epics.filter((e) => todoServesCriterion(e, c.id));
      // LANDED-ness is `status === 'done'` OR a stamped landedAt: the land paths can leave an
      // epic landed while its status lags at 'todo' (observed on 7 build123d epics, 2026-07-24),
      // and such an epic could never satisfy a status-only test — masking its criterion forever.
      // Live = the serving open epic has actual motion: a pending/paused ledger run, or a
      // ready/in_progress child leaf (covers approve→claim gap AND a ready land leaf).
      // A filed-but-unapproved epic is NOT live — its criterion stays 'discover'.
      //
      // ledgerUnavailable: we cannot read the run motion signal at all, so a real serving OPEN
      // epic must NOT fall back to "not live" — that would derive 'discover' for a criterion that
      // is actually mid-build and cause the conductor to re-file a duplicate serving epic (real
      // spend). Treat any open serving epic as live until the ledger is readable again.
      const servingEpicLive = serving.some((e) => predServingEpicLive(e, ledgerUnavailable, runs, allTodos, byId, now));
      // LIVENESS decides 'open', not mere existence. The old rule was
      //   serving.some(e => e.status !== 'done') ? 'open' : serving.some(done) ? 'landed' : 'none'
      // so ANY non-done serving epic — including a stale, motionless, never-approved one — masked
      // a sibling that had ALREADY LANDED. Since deriveCriterionAction only returns 'verify' for
      // 'landed', the verdict gate never ran; with no live motion the criterion then read
      // 'discover' and the conductor filed YET ANOTHER serving epic every tick, each a fresh
      // blueprint+implement spend (build123d 2026-07-24: one criterion accrued SEVEN serving
      // epics). Now: work genuinely in flight still wins ('open' ⇒ wait), but once nothing is
      // live, landed work asks for a VERDICT instead of another epic. A non-landed, non-live
      // serving epic still reads 'open'+not-live ⇒ 'discover', preserving the unattended-stall
      // trap for a filed-but-never-approved epic.
      // A landed serving epic only marks THIS criterion 'landed' (verify-ready) when it PROVED it
      // (a delivered descendant leaf tagged with c.id) OR the epic tags no leaf at all AND every
      // descendant leaf has settled (legacy → trust the edge, but only once nothing is still in
      // flight). A landed epic that did NOT prove c (its proof leaf was dropped/orphaned), or whose
      // untagged legacy proof-leaf is still unfinished, falls to 'open'→not-live→'discover', so the
      // conductor re-serves a real proof instead of the gate being handed an unproven criterion to
      // (maybe) rubber-stamp.
      const provingLanded = serving.filter((e) => {
        if (!isLanded(e)) return false;
        const pf = proofForEpic(e.id);
        return pf.proven.has(c.id) || (!pf.tagsAnyLeaf && !pf.hasUnfinishedLeaf);
      });
      const servingEpicState: 'landed' | 'open' | 'none' =
        servingEpicLive ? 'open'
        : provingLanded.length > 0 ? 'landed'
        : serving.length > 0 ? 'open'
        : 'none';
      // Lifetime serve count — dropped/done included, so a criterion re-served every tick
      // accrues its true thrash history (the serve-cap escalation trigger). EXCEPT hollow-
      // landed done epics, which don't burn the cap (LS-1).
      const isHollowDone = (e: Todo) => predIsHollowDone(e, allTodos);
      // SERVE-CAP REFUND (infra-flake serve): a serving epic that FILED leaves but was killed by an
      // INFRA hold (epic-base-red, spawn-ENOENT, auth-logout) BEFORE any of them ran must NOT burn
      // the anti-thrash cap — the cap exists to stop re-filing a criterion that has been genuinely
      // ATTEMPTED and still failed, not one whose serves never got to run. An epic counts toward the
      // cap iff it made a genuine attempt: it has NO leaf children (a thin re-file — preserved as
      // thrash history, the existing deliberate behaviour), OR at least one descendant leaf settled
      // (accepted|rejected), OR a ledger node actually spent under it. An epic whose leaves are all
      // filed-but-unrun (dropped/blocked at attempts=0, zero nodes, none settled) is refunded, so the
      // conductor can serve once more when the flake clears rather than the cap wedging a solvable
      // criterion into a human-only 'escalate'.
      const countsTowardServeCap = (e: Todo) => predCountsTowardServeCap(e, allTodos, capRuns, ledgerUnavailable);
      const servedEpicCount = allEpicsEver.filter(
        (e) => todoServesCriterion(e, c.id) &&
          !isHollowDone(e) && countsTowardServeCap(e),
      ).length;
      const servingEpicIds = new Set(serving.map((e) => e.id));
      const rejectedParkedCount = runs.filter(
        (r) => r.epicId != null && servingEpicIds.has(r.epicId) &&
          (r.finalOutcome === 'rejected' || r.finalOutcome === 'blocked'),
      ).length;
      let servingEpicLandSha: string | null = null;
      let servingEpicLandedAt: number | null = null;
      try {
        let best: { sha: string; at: number } | null = null;
        for (const e of provingLanded) {
          const rec = getEpicLandRecord(project, e.id);
          if (rec && (best == null || rec.landedAt > best.at)) {
            best = { sha: rec.landedMergeSha, at: rec.landedAt };
          }
        }
        if (best) { servingEpicLandSha = best.sha; servingEpicLandedAt = best.at; }
      } catch { /* fail closed to null, same as a missing record */ }
      return { id: c.id, met: c.met, verifiedAt: c.verifiedAt, verifiedAtSha: c.verifiedAtSha, servingEpicState, servingEpicLive, servedEpicCount, rejectedParkedCount, servingEpicLandSha, servingEpicLandedAt };
    }),
  };
}

/** listCriteria rows enriched with the derived per-criterion action + serving-epic state.
 *  This is what get_mission exposes so a conductor can act on EVERY open gap in one pass
 *  instead of driving off the scalar status alone. */
export function listCriteriaWithActions(
  project: string,
  todoId: string,
): (MissionCriterion & { action: CriterionAction; servingEpicState: 'landed' | 'open' | 'none'; servedEpicCount: number; rejectedParkedCount: number })[] {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const facts = collectMissionStatusFacts(project, m);
  const byId = new Map(facts.criteria.map((c) => [c.id, c]));
  // Use the RESOLVED id (m.todoId), not the raw todoId param — a short id here used to
  // return empty criteria (listCriteria was queried on the unresolved arg).
  return listCriteria(project, m.todoId).map((c) => {
    const f = byId.get(c.id);
    return {
      ...c,
      action: f ? deriveCriterionAction(f) : 'discover',
      servingEpicState: f?.servingEpicState ?? 'none',
      servedEpicCount: f?.servedEpicCount ?? 0,
      rejectedParkedCount: f?.rejectedParkedCount ?? 0,
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
    const criteriaForNode = listCriteria(project, node.id); // cheap indexed lookup — the capability gauge
    const raw = withFacts ? getMission(project, node.id) : getMissionRaw(project, node.id);
    let mission = raw && !withFacts
      ? { ...raw, status: deriveCheapMissionStatus(raw, epicsForNode, criteriaForNode, isMissionStalled(project, node.id)) }
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
    const criteria = criteriaForNode; // loaded above (capability gauge), not a facts scan
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
          status: mission.status ?? deriveCheapMissionStatus(mission, epics, criteria, isMissionStalled(project, node.id)),
          gaps: 0,
          awaitingVerify: 0,
          // Cheap path: gaps/awaitingVerify are NOT computed (see MissionRollup.factsOmitted) and
          // status is deriveCheapMissionStatus's approximation — flag it so a caller relying on this
          // for a scheduling decision knows to fall back to the full (withFacts:true) path instead.
          factsOmitted: true,
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
  // Use the RESOLVED id (m.todoId), not the raw todoId param — a short id here used to
  // return an empty rollup (epics/criteria were both queried on the unresolved arg).
  const id = m.todoId;
  const epics = listTodos(project, { includeCompleted: true }).filter(
    (t) => t.parentId === id && t.status !== 'dropped' && isEpic(t),
  );
  const mechDone = epics.filter((e) => e.status === 'done').length;
  const criteria = listCriteria(project, id);
  const capMet = criteria.filter((c) => c.met).length;
  const facts = collectMissionStatusFacts(project, m);
  const actions = facts.criteria.map(deriveCriterionAction);
  return {
    todoId: id,
    mechanical: { done: mechDone, total: epics.length },
    capability: { met: capMet, total: criteria.length },
    converged: criteria.length > 0 && capMet === criteria.length,
    stopped: isMissionTerminal(m),
    status: deriveMissionStatus(facts),
    gaps: actions.filter((a) => a === 'discover').length,
    awaitingVerify: actions.filter((a) => a === 'verify').length,
    factsOmitted: false,
  };
}
