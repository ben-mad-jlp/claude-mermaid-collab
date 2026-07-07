/**
 * mission-store.ts — durable loop-control state for the convergence-loop MISSION
 * (Phase 2a of the autonomous convergence loop; companion to context-recycle).
 *
 * A MISSION is a durable capability goal the steward converges the app toward by
 * repeating DOGFOOD → FIND GAP → PLAN → STEWARD → LAND → ASSESS, iteration after
 * iteration, until the app does the thing. Each iteration's gaps become transient
 * `[EPIC]` children under a `[MISSION]` graph node; the mission node itself is a
 * durable non-closing root (see claimability.isMissionTitle + the two rollup
 * exemptions in todo-store).
 *
 * DESIGN (locked via Grok consult, doc phase2-grok-consult-synthesis): the mission
 * NODE lives in the todo work-graph (for board visibility + epic parenting +
 * descendant rollup), but ALL loop-control state — phase, iteration, acceptance
 * criteria — lives HERE in a SEPARATE `.collab/mission.db`, keyed by the node's
 * todo id. This keeps the control state OFF the `todos` aggregate (whose invariants
 * were never built for a long-lived phase machine) while still letting the node
 * participate in the graph. Phase 2a is steward-HAND-driven: there is NO autonomous
 * advancing pass yet (that is Phase 2b, earned once a phase is mechanized), so this
 * store is a plain durable record the steward reads and advances by hand.
 */
import Database from 'bun:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { listTodos } from './todo-store.ts';
import { isEpicTitle, isMissionTitle } from './claimability.ts';

/**
 * The convergence-loop phases — the canonical agentic loop
 * DISCOVER → PLAN → EXECUTE → VERIFY → (ITERATE = loop back, iteration++).
 * ITERATE is not a phase; it's the transition VERIFY makes: converge, stop, or
 * loop back to DISCOVER. Two terminal states:
 *   - `converged` — VERIFY passed (all acceptance criteria met). The goal is done.
 *   - `stopped`   — the STOP-WHEN guard fired (maxIterations reached un-converged).
 */
export type MissionPhase =
  | 'discover' // work out what needs doing
  | 'plan'     // decide how to do it
  | 'execute'  // do the work (daemon-buildable)
  | 'verify'   // check against the goal
  | 'converged'
  | 'stopped';

/** The active cycle (terminals excluded). VERIFY's next is decided by advanceMission
 *  (converge / stop / loop back to DISCOVER), not a plain wrap. */
export const MISSION_CYCLE: MissionPhase[] = ['discover', 'plan', 'execute', 'verify'];

export const MISSION_PHASES: MissionPhase[] = [...MISSION_CYCLE, 'converged', 'stopped'];

/** A phase is terminal when the loop has stopped (goal met, or gave up). */
export const isTerminalPhase = (p: MissionPhase): boolean => p === 'converged' || p === 'stopped';

export interface MissionRow {
  /** The `[MISSION]` node's todo id (FK into the work-graph). */
  todoId: string;
  phase: MissionPhase;
  iteration: number;
  createdAt: number;
  updatedAt: number;
  /** STOP-WHEN guard: max iterations before the loop stops un-converged. Null =
   *  unbounded (converge-or-run-forever — use with care). */
  maxIterations: number | null;
  /** The EACH-ITERATION recipe (freeform markdown/text): what to do each lap. */
  procedure: string | null;
  /** ON-STOP: why the loop is in a terminal state ('converged' | 'max-iterations'
   *  | freeform), or null while still running. */
  stopReason: string | null;
  /** Last time DISCOVER was stamped this iteration (ms epoch), or null. */
  lastDiscoverAt: number | null;
  /** Last time VERIFY was stamped (ms epoch), or null. */
  lastVerifyAt: number | null;
  /** Last time the mission-loop pass nudged the steward for this mission (ms epoch),
   *  or null — the nudge debounce so the pass doesn't spam every tick. */
  lastNudgeAt: number | null;
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
}

/** Two convergence gauges: mechanical = this iteration's build progress; capability
 *  = the real "is the mission done" signal over acceptance criteria. */
export interface MissionRollup {
  todoId: string;
  phase: MissionPhase;
  iteration: number;
  /** STOP-WHEN cap (null = unbounded). */
  maxIterations: number | null;
  /** Descendant `[EPIC]` children: done vs total (this iteration's build progress). */
  mechanical: { done: number; total: number };
  /** Acceptance criteria: met vs total (the true convergence gauge). */
  capability: { met: number; total: number };
  /** True iff there is ≥1 criterion and every criterion is met (VERIFY passes). */
  converged: boolean;
  /** True once the loop reached a terminal phase (converged or stopped). */
  stopped: boolean;
  /** Why the loop stopped ('converged' | 'max-iterations' | …), or null if running. */
  stopReason: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mission (
  todoId TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  lastDogfoodAt INTEGER,
  lastAssessAt INTEGER
);
CREATE TABLE IF NOT EXISTS mission_criterion (
  id TEXT PRIMARY KEY,
  todoId TEXT NOT NULL,
  text TEXT NOT NULL,
  met INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_criterion_todo ON mission_criterion(todoId);
`;

const dbCache = new Map<string, Database>();

function addColumnIfMissing(db: Database, table: string, column: string, decl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
}

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const dir = join(project, '.collab');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'mission.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // v2 (loop-spec) additive columns — the STOP-WHEN guard, the EACH-ITERATION
  // procedure, and the ON-STOP reason. The lastDiscoverAt/lastVerifyAt stamps reuse
  // the legacy lastDogfoodAt/lastAssessAt columns (renamed in the API, not the DB).
  addColumnIfMissing(db, 'mission', 'maxIterations', 'maxIterations INTEGER');
  addColumnIfMissing(db, 'mission', 'procedure', 'procedure TEXT');
  addColumnIfMissing(db, 'mission', 'stopReason', 'stopReason TEXT');
  // VERIFY-gate audit trail on each criterion (independent-judge evidence + provenance).
  addColumnIfMissing(db, 'mission_criterion', 'evidence', 'evidence TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedBy', 'verifiedBy TEXT');
  addColumnIfMissing(db, 'mission_criterion', 'verifiedAt', 'verifiedAt INTEGER');
  addColumnIfMissing(db, 'mission', 'lastNudgeAt', 'lastNudgeAt INTEGER');
  // v2 one-shot phase migration: remap the legacy 6-phase vocabulary onto the
  // canonical 5 (dogfood/find_gap→discover, steward/land→execute, assess→verify).
  db.exec(`UPDATE mission SET phase='discover' WHERE phase IN ('dogfood','find_gap')`);
  db.exec(`UPDATE mission SET phase='execute'  WHERE phase IN ('steward','land')`);
  db.exec(`UPDATE mission SET phase='verify'   WHERE phase='assess'`);
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
    phase: row.phase as MissionPhase,
    iteration: row.iteration as number,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    maxIterations: (row.maxIterations as number | null) ?? null,
    procedure: (row.procedure as string | null) ?? null,
    stopReason: (row.stopReason as string | null) ?? null,
    // lastDiscoverAt/lastVerifyAt live in the legacy lastDogfoodAt/lastAssessAt columns.
    lastDiscoverAt: (row.lastDogfoodAt as number | null) ?? null,
    lastVerifyAt: (row.lastAssessAt as number | null) ?? null,
    lastNudgeAt: (row.lastNudgeAt as number | null) ?? null,
  };
}

/** Stamp that the mission-loop pass nudged the steward (the nudge debounce). */
export function stampMissionNudge(project: string, todoId: string): void {
  openDb(project)
    .prepare('UPDATE mission SET lastNudgeAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(nowMs(), nowMs(), todoId);
}

/** Read a mission's control state, or undefined if the node has none yet. */
export function getMission(project: string, todoId: string): MissionRow | undefined {
  const row = openDb(project)
    .query('SELECT * FROM mission WHERE todoId = ?')
    .get(todoId) as Record<string, unknown> | null;
  return row ? rowToMission(row) : undefined;
}

/**
 * Attach (or return existing) loop-control state to a `[MISSION]` node. Idempotent:
 * a second call for the same node returns the existing row unchanged. Starts at
 * phase='dogfood', iteration=1. The CALLER is responsible for having created the
 * `[MISSION]` graph node (via the normal todo path) — this store owns control
 * state only, never node creation, keeping the two concerns uncoupled.
 */
export function upsertMission(
  project: string,
  todoId: string,
  opts: { maxIterations?: number | null; procedure?: string | null } = {},
): MissionRow {
  const existing = getMission(project, todoId);
  if (existing) return existing;
  const ts = nowMs();
  openDb(project)
    .prepare(
      `INSERT INTO mission (todoId, phase, iteration, createdAt, updatedAt, maxIterations, procedure, lastDogfoodAt, lastAssessAt)
       VALUES (?, 'discover', 1, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(todoId, ts, ts, opts.maxIterations ?? null, opts.procedure ?? null);
  return getMission(project, todoId)!;
}

/** Set a mission's phase explicitly (e.g. jump straight to 'converged' or back).
 *  Setting a non-terminal phase clears any stopReason (the loop resumes). */
export function setMissionPhase(project: string, todoId: string, phase: MissionPhase): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const stopReason = isTerminalPhase(phase) ? (m.stopReason ?? phase) : null;
  openDb(project)
    .prepare('UPDATE mission SET phase = ?, stopReason = ?, updatedAt = ? WHERE todoId = ?')
    .run(phase, stopReason, nowMs(), todoId);
  return getMission(project, todoId)!;
}

/** Update a mission's loop-spec config (STOP-WHEN cap + EACH-ITERATION procedure).
 *  Pass a field to change it; omit to leave unchanged. */
export function setMissionConfig(
  project: string,
  todoId: string,
  cfg: { maxIterations?: number | null; procedure?: string | null },
): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const maxIterations = cfg.maxIterations !== undefined ? cfg.maxIterations : m.maxIterations;
  const procedure = cfg.procedure !== undefined ? cfg.procedure : m.procedure;
  openDb(project)
    .prepare('UPDATE mission SET maxIterations = ?, procedure = ?, updatedAt = ? WHERE todoId = ?')
    .run(maxIterations, procedure, nowMs(), todoId);
  return getMission(project, todoId)!;
}

/** The naive next phase in the active cycle (VERIFY wraps to DISCOVER). Terminal
 *  states stay put. advanceMission owns the VERIFY→converge/stop/iterate decision. */
export function nextPhase(phase: MissionPhase): MissionPhase {
  if (isTerminalPhase(phase)) return phase;
  const i = MISSION_CYCLE.indexOf(phase);
  if (i < 0) return 'discover';
  return MISSION_CYCLE[(i + 1) % MISSION_CYCLE.length];
}

/**
 * Advance a mission one step through DISCOVER→PLAN→EXECUTE→VERIFY. The interesting
 * step is VERIFY (the ITERATE decision, embodying STOP-WHEN):
 *   - all criteria met            → `converged`   (goal achieved)
 *   - else maxIterations reached  → `stopped`     (STOP-WHEN guard fired)
 *   - else                        → `discover`, iteration++  (loop back)
 * No-op once terminal. Phase 2a: the steward calls this by hand; Phase 2b's pass
 * will call the same function.
 */
export function advanceMission(project: string, todoId: string): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  if (isTerminalPhase(m.phase)) return m;

  let phase: MissionPhase;
  let iteration = m.iteration;
  let stopReason: string | null = null;

  if (m.phase === 'verify') {
    const conv = getMissionRollup(project, todoId).converged;
    if (conv) {
      phase = 'converged';
      stopReason = 'converged';
    } else if (m.maxIterations != null && m.iteration >= m.maxIterations) {
      phase = 'stopped';
      stopReason = 'max-iterations';
    } else {
      phase = 'discover';
      iteration = m.iteration + 1; // ITERATE: a new lap begins
    }
  } else {
    phase = nextPhase(m.phase);
  }

  openDb(project)
    .prepare('UPDATE mission SET phase = ?, iteration = ?, stopReason = ?, updatedAt = ? WHERE todoId = ?')
    .run(phase, iteration, stopReason, nowMs(), todoId);
  return getMission(project, todoId)!;
}

/** Stamp that DISCOVER ran this iteration (the discover-phase activity signal). */
export function stampDiscover(project: string, todoId: string): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const ts = nowMs();
  openDb(project)
    .prepare('UPDATE mission SET lastDogfoodAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(ts, ts, todoId);
  return getMission(project, todoId)!;
}

/** Stamp that a VERIFY check ran (the verify-phase activity signal). */
export function stampVerify(project: string, todoId: string): MissionRow {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);
  const ts = nowMs();
  openDb(project)
    .prepare('UPDATE mission SET lastAssessAt = ?, updatedAt = ? WHERE todoId = ?')
    .run(ts, ts, todoId);
  return getMission(project, todoId)!;
}

/** Delete a mission's control state (does NOT touch the graph node). */
export function deleteMission(project: string, todoId: string): void {
  const db = openDb(project);
  db.prepare('DELETE FROM mission_criterion WHERE todoId = ?').run(todoId);
  db.prepare('DELETE FROM mission WHERE todoId = ?').run(todoId);
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
  return { id, todoId, text: trimmed, met: false, order, updatedAt: ts, evidence: null, verifiedBy: null, verifiedAt: null };
}

/** Mark a criterion met / unmet (bare — no verify provenance). Prefer
 *  setCriterionVerdict for a real VERIFY-gate ruling. */
export function setCriterionMet(project: string, criterionId: string, met: boolean): void {
  const res = openDb(project)
    .prepare('UPDATE mission_criterion SET met = ?, updatedAt = ? WHERE id = ?')
    .run(met ? 1 : 0, nowMs(), criterionId);
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);
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
  verdict: { met: boolean; evidence?: string | null; verifiedBy?: string | null },
): void {
  const res = openDb(project)
    .prepare('UPDATE mission_criterion SET met = ?, evidence = ?, verifiedBy = ?, verifiedAt = ?, updatedAt = ? WHERE id = ?')
    .run(
      verdict.met ? 1 : 0,
      verdict.evidence ?? null,
      verdict.verifiedBy ?? null,
      nowMs(),
      nowMs(),
      criterionId,
    );
  if (res.changes === 0) throw new Error(`criterion not found: ${criterionId}`);
}

export function removeCriterion(project: string, criterionId: string): void {
  openDb(project).prepare('DELETE FROM mission_criterion WHERE id = ?').run(criterionId);
}

// ── Convergence rollup ──────────────────────────────────────────────────────

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
 * state (upsertMission was called). Joins the graph node (by the `[MISSION]` title
 * convention) with the sidecar mission row + rollup + criteria + its epic children.
 * Missions with a node but no control row are skipped. For the Plan-board Missions
 * surface. Pass `opts.session` to return ONLY missions owned by / assigned to that
 * session (the mission↔session tie) — omit for all project missions.
 */
export function listMissions(project: string, opts: { session?: string } = {}): MissionSummary[] {
  const all = listTodos(project, { includeCompleted: true });
  const roots = all.filter(
    (t) => t.parentId == null && t.status !== 'dropped' && isMissionTitle(t.title),
  );
  const out: MissionSummary[] = [];
  for (const node of roots) {
    const mission = getMission(project, node.id);
    if (!mission) continue; // a [MISSION]-titled node without control state — not a real mission
    if (opts.session && node.ownerSession !== opts.session && node.assigneeSession !== opts.session) {
      continue; // session-scoped filter (mission↔session tie)
    }
    const epics = all
      .filter((t) => t.parentId === node.id && t.status !== 'dropped' && isEpicTitle(t.title))
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
    (t) => t.parentId === todoId && t.status !== 'dropped' && isEpicTitle(t.title),
  );
  const mechDone = epics.filter((e) => e.status === 'done').length;
  const criteria = listCriteria(project, todoId);
  const capMet = criteria.filter((c) => c.met).length;
  return {
    todoId,
    phase: m.phase,
    iteration: m.iteration,
    maxIterations: m.maxIterations,
    mechanical: { done: mechDone, total: epics.length },
    capability: { met: capMet, total: criteria.length },
    converged: criteria.length > 0 && capMet === criteria.length,
    stopped: isTerminalPhase(m.phase),
    stopReason: m.stopReason,
  };
}
