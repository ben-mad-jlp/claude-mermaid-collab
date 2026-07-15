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
import { listTodos } from './todo-store.ts';
import { isEpic, isMission } from './todo-kind.ts';
import { listLeafRuns } from './ledger-stats.ts';
import { derivedStatus } from './claimability.ts';
import { createEscalation } from './supervisor-store.ts';

/** Derived-on-read capability status of a mission (never stored; computed from the
 *  work-graph + criteria + leaf-run ledger each read). Precedence is first-match-wins in
 *  the order listed in deriveMissionStatus. */
export type MissionStatus =
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
  /** Whether this is the ACTIVE mission for its owning session. A steward drives ONE
   *  mission at a time, so at most one mission per session is active; the mission-loop
   *  pass only drives active missions. Default true (a lone mission just works). */
  active: boolean;
  /** Human-set abandonment stamp (ms epoch), or null = active. A mission-requirements
   *  concept: an abandoned mission with unmet criteria is otherwise indistinguishable
   *  from an in-progress one; this makes "done with it" explicit. */
  abandonedAt: number | null;
  /** Per-mission USD budget ceiling, or null = project default. */
  budgetUsd: number | null;
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
  budgetUsd REAL
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
  addColumnIfMissing(db, 'mission', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'mission', 'abandonedAt', 'abandonedAt INTEGER');
  addColumnIfMissing(db, 'mission', 'budgetUsd', 'budgetUsd REAL');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedAtSha', 'verifiedAtSha TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'evidencePaths', 'evidencePaths TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'reopenCount', 'reopenCount INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'mission_criterion', 'lastReopenSha', 'lastReopenSha TEXT');
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
    active: (row.active as number | null) == null ? true : (row.active as number) === 1,
    abandonedAt: (row.abandonedAt as number | null) ?? null,
    budgetUsd: (row.budgetUsd as number | null) ?? null,
  };
}

/** Stamp that the mission-loop pass nudged the steward (the nudge debounce). */
export function stampMissionNudge(project: string, todoId: string, key?: string): void {
  openDb(project)
    .prepare('UPDATE mission SET lastNudgeAt = ?, lastNudgeKey = ?, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), key ?? null, nowMs(), todoId);
}

/** Read a mission's control state, or undefined if the node has none yet. */
export function getMission(project: string, todoId: string): MissionRow | undefined {
  const row = openDb(project)
    .query('SELECT * FROM mission WHERE todoId = ?')
    .get(todoId) as Record<string, unknown> | null;
  if (!row) return undefined;
  const m = rowToMission(row);
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
  opts: { budgetUsd?: number | null } = {},
): MissionRow {
  const existing = getMission(project, todoId);
  if (existing) return existing;
  const ts = nowMs();
  openDb(project)
    .prepare(
      `INSERT INTO mission (todoId, createdAt, updatedAt, budgetUsd)
       VALUES (?, ?, ?, ?)`,
    )
    .run(todoId, ts, ts, opts.budgetUsd ?? null);
  return getMission(project, todoId)!;
}

/** Human-set abandonment stamp. A mission-requirements concept: mark a mission
 *  "done with it" (abandonedAt = now, ms epoch) or clear it (null → active again).
 *  Writes the A1 `abandonedAt` column; readers (A2) surface it. */
export function setMissionAbandoned(project: string, todoId: string, abandonedAt: number | null): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  openDb(project)
    .prepare('UPDATE mission SET abandonedAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(abandonedAt, nowMs(), todoId);
  return getMission(project, todoId)!;
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
}

export interface MissionStatusFacts {
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
  | 'discover'; // no live serving epic (none filed, filed-but-stalled, or landed-and-verify-said-no) — file/approve an epic

export function deriveCriterionAction(c: MissionCriterionFacts): CriterionAction {
  // verify BEFORE met: a met-but-unverified criterion still owes the independent gate a
  // verdict (verification-as-event — `met` alone is a self-grade until verifiedAt stamps it).
  if (c.servingEpicState === 'landed' && c.verifiedAt == null) return 'verify';
  if (c.met) return 'met';
  if (c.servingEpicState === 'open' && c.servingEpicLive) return 'building';
  return 'discover';
}

/** First-match-wins. PER-CRITERION since decision mission-discovery-per-criterion (f9bc952f)
 *  (supersedes the A2 brief's global `!hasOpenEpic` clause and its building>discovery
 *  precedence): one epic building no longer masks discovery for OTHER criteria, so a
 *  conductor can serve every open gap concurrently. 'building' is now the QUIETEST
 *  non-terminal state — it only surfaces when nothing is left to discover or verify. */
export function deriveMissionStatus(f: MissionStatusFacts): MissionStatus {
  if (f.abandonedAt != null) return 'abandoned';
  if (f.budgetUsd != null && f.spendUsd >= f.budgetUsd) return 'over-budget';
  if (f.hasBlockedLeaf) return 'blocked';
  const actions = f.criteria.map(deriveCriterionAction);
  if (actions.includes('verify')) return 'needs-verify';
  if (actions.includes('discover')) return 'needs-discovery';
  if (f.hasBuildingLeaf || actions.includes('building')) return 'building';
  if (f.criteria.length > 0 && actions.every((a) => a === 'met')) return 'converged';
  return 'needs-discovery'; // default: nothing landed/built/verified yet (incl. no criteria)
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
  const allTodos = listTodos(project, { includeCompleted: true });
  const epics = allTodos.filter(
    (t) => t.parentId === m.todoId && t.status !== 'dropped' && isEpic(t),
  );
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
    abandonedAt: m.abandonedAt,
    budgetUsd: m.budgetUsd,
    spendUsd: runs.reduce((s, r) => s + r.costUsd, 0),
    hasBlockedLeaf: liveRuns.some((r) => r.finalOutcome === 'rejected' || r.finalOutcome === 'blocked'),
    hasBuildingLeaf: liveRuns.some((r) => r.finalOutcome === 'pending' || r.finalOutcome === 'paused') || hasBuildingChildLeaf,
    hasLandedEpic: epics.some((e) => e.status === 'done'),
    hasOpenEpic: epics.some((e) => e.status !== 'done'), // dropped already filtered out
    criteria: criteria.map((c) => {
      const serving = epics.filter((e) => e.servesCriterionId === c.id);
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
      return { id: c.id, met: c.met, verifiedAt: c.verifiedAt, servingEpicState, servingEpicLive };
    }),
  };
}

/** listCriteria rows enriched with the derived per-criterion action + serving-epic state.
 *  This is what get_mission exposes so a conductor can act on EVERY open gap in one pass
 *  instead of driving off the scalar status alone. */
export function listCriteriaWithActions(
  project: string,
  todoId: string,
): (MissionCriterion & { action: CriterionAction; servingEpicState: 'landed' | 'open' | 'none' })[] {
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
 */
export function listMissions(project: string, opts: { session?: string } = {}): MissionSummary[] {
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
    const mission = getMission(project, node.id);
    if (!mission) continue; // a mission-kind node without control state — not a real mission
    if (opts.session && node.ownerSession !== opts.session && node.assigneeSession !== opts.session) {
      continue; // session-scoped filter (mission↔session tie)
    }
    const epics = all
      .filter((t) => t.parentId === node.id && t.status !== 'dropped' && isEpic(t))
      .map((e) => ({ id: e.id, title: e.title, status: e.status, acceptanceStatus: e.acceptanceStatus ?? null }));
    out.push({
      node: { id: node.id, title: node.title, status: node.status },
      ownerSession: node.ownerSession ?? null,
      assigneeSession: node.assigneeSession ?? null,
      mission,
      rollup: getMissionRollup(project, node.id),
      criteria: listCriteria(project, node.id),
      epics,
    });
  }
  return out;
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
