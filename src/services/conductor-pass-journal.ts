/**
 * conductor_pass journal — a durable per-pass record of what a conductor pass did:
 * which fingerprints it saw, which arm it took, which criteria it acted on, what it
 * filed/declined, and how it ended. Lives beside worker-ledger.db under
 * MERMAID_SUPERVISOR_DIR. Modeled on criterion-approach-store.ts's connection and
 * fail-open discipline. Standalone module — nothing wires into it yet.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type ConductorPassArm = 'infra' | 'redecompose' | 'verify-panel' | 'test-only-close' | 'land' | 'node' | 'none';

export interface ConductorFiledRef { kind: 'epic' | 'leaf' | 'card'; id: string; title: string }

export interface ConductorPassJournalRow {
  id: string;
  project: string;
  missionId: string | null;
  startedAt: number;
  endedAt: number | null;
  serveFp: string | null;
  passFp: string | null;
  selfFp: string | null;
  arm: ConductorPassArm | null;
  criteriaActed: Array<{ criterionId: string; action: string; servedEpicId?: string | null; servedEpicNickname?: string | null }>;
  filed: ConductorFiledRef[] | unknown;
  declined: Array<{ what: string; why: string; entityType?: 'epic' | 'leaf' | 'card'; entityId?: string }>;
  outcome: string | null;
  ran: boolean | null;
  /** Whether the node spend on this row is a genuine, countable attempt (a real node ran and
   *  made no progress) vs a transient fault (rateLimited/startFailure/timedOut) that must never
   *  consume a bounded retry counter. Set on a 'node-failed' outcome, and ALSO set true on an
   *  EMPTY CONDUCT (see {@link isEmptyConductRow}) — a pass that ran a real node, exited ok, and
   *  moved nothing IS a countable no-progress attempt, and saying so is the whole point of the
   *  field. null on rows where the distinction doesn't apply (debounced / productive / etc.). */
  failCounted: boolean | null;
  /** Criterion ids this pass deferred past its batch cap (CONDUCTOR_VERIFY_BATCH_MAX /
   *  CONDUCTOR_SERVE_BATCH_MAX) rather than acting on this tick — null when nothing was
   *  carried (or on legacy rows predating this column). */
  carried: { verify: string[]; serve: string[]; count: number } | null;
  /** SHORT node-authored account of what this pass concluded and why — the only surface on which
   *  the conductor's REASONING survives the pass. Structure (arm/filed/declined) says what moved;
   *  this says why nothing did. Load-bearing exactly on the rows that look inert: a `declined`
   *  pass, and an empty conduct (`ran=1` with `filed: []`) — the shape that wedged mission
   *  949dda42 (253s of Opus, 15.9k output tokens, filed NOTHING, no record of what it decided).
   *  Capped at {@link CONDUCTOR_PASS_SUMMARY_MAX_CHARS}. null when no node ran on this pass
   *  (a debounced early return has no reasoning to record) or on legacy rows predating the
   *  column — it is never fabricated. */
  summary: string | null;
  /** True when an OPERATOR forced this pass through the fingerprint debounce (the one-shot kick,
   *  POST /api/conductor/kick). The journal is the only place the WHY of an otherwise-inexplicable
   *  pass survives: without it a kicked pass is indistinguishable from a spontaneous one in
   *  `list_conductor_passes` and the activity panel. null on every ordinary pass and on legacy
   *  rows predating the column. Optional in the TYPE (not just nullable) so the many hand-built
   *  row fixtures that predate it keep compiling — a row object without the key means exactly
   *  what a null means: nobody forced this pass. */
  forced?: boolean | null;
  /** Number of conductor nodes spawned and run on this pass. 0 for debounced/early-returns,
   *  1 for a pass that ran the node. null on legacy rows predating the column. */
  nodesSpent?: number | null;
  /** Per-arm watermark: JSON.stringify'd object keying which arms' admission keys were last
   *  executed. null on legacy rows or passes that took no arms. */
  armWatermark?: string | null;
  /** Classification of this pass outcome (quiet/stuck). null on legacy rows or early returns. */
  outcomeClass?: string | null;
}

/** Hard cap on the persisted pass summary. This is a SUMMARY, not a transcript: the full node
 *  output already lives in `worker_ledger.outputText`, and the journal is read on every
 *  `list_conductor_passes` call. Truncated defensively on write. */
export const CONDUCTOR_PASS_SUMMARY_MAX_CHARS = 600;

/** Clamp an arbitrary node-authored string to the journal's summary bound. Returns null for
 *  null/undefined/blank input so an absent summary stays honestly absent. */
export function clampPassSummary(text: string | null | undefined): string | null {
  if (text == null) return null;
  const t = text.trim();
  if (t.length === 0) return null;
  return t.length <= CONDUCTOR_PASS_SUMMARY_MAX_CHARS ? t : t.slice(0, CONDUCTOR_PASS_SUMMARY_MAX_CHARS);
}

const DDL = `
CREATE TABLE IF NOT EXISTS conductor_pass (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  missionId TEXT,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  serveFp TEXT,
  passFp TEXT,
  selfFp TEXT,
  arm TEXT,
  criteriaActed TEXT,
  filed TEXT,
  declined TEXT,
  outcome TEXT,
  ran INTEGER,
  failCounted INTEGER,
  carried TEXT,
  summary TEXT,
  forced INTEGER,
  nodesSpent INTEGER,
  armWatermark TEXT,
  outcomeClass TEXT
);
CREATE INDEX IF NOT EXISTS idx_conductor_pass_lookup ON conductor_pass (project, missionId, startedAt);
`;

let db: Database | null = null;

function addColumnIfMissing(d: Database, table: string, col: string, ddl: string): void {
  const cols = d.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function openDb(): Database {
  if (db) return db;
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  db = new Database(join(dir, 'worker-ledger.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  addColumnIfMissing(db, 'conductor_pass', 'carried', 'carried TEXT');
  // Additive + NULLABLE: legacy rows written before the conductor recorded its reasoning read
  // back as summary:null, which is the correct answer for them (nothing was captured).
  addColumnIfMissing(db, 'conductor_pass', 'summary', 'summary TEXT');
  // Additive + NULLABLE, same idiom: legacy rows read back as forced:null, which is correct for
  // them (no kick existed when they were written).
  addColumnIfMissing(db, 'conductor_pass', 'forced', 'forced INTEGER');
  // Additive + NULLABLE: legacy rows read back as nodesSpent:null.
  addColumnIfMissing(db, 'conductor_pass', 'nodesSpent', 'nodesSpent INTEGER');
  // Additive + NULLABLE: legacy rows read back as armWatermark:null.
  addColumnIfMissing(db, 'conductor_pass', 'armWatermark', 'armWatermark TEXT');
  // Additive + NULLABLE: legacy rows read back as outcomeClass:null.
  addColumnIfMissing(db, 'conductor_pass', 'outcomeClass', 'outcomeClass TEXT');
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeConductorJournalDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Open an in-flight pass row. Returns the new id, or null on throw. */
export function openPassRow(project: string, missionId: string | null, startedAt: number): string | null {
  try {
    const id = crypto.randomUUID();
    const d = openDb();
    d.prepare(
      `INSERT INTO conductor_pass (id, project, missionId, startedAt, endedAt, serveFp, passFp, selfFp, arm, criteriaActed, filed, declined, outcome, ran, failCounted)
       VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,NULL,?,NULL,NULL,NULL)`,
    ).run(id, project, missionId, startedAt, JSON.stringify([]), JSON.stringify([]));
    return id;
  } catch {
    return null;
  }
}

type JsonPatchKey = 'criteriaActed' | 'filed' | 'declined' | 'carried';
const JSON_PATCH_KEYS: JsonPatchKey[] = ['criteriaActed', 'filed', 'declined', 'carried'];
type ScalarPatchKey = 'missionId' | 'serveFp' | 'passFp' | 'selfFp' | 'arm' | 'armWatermark' | 'outcomeClass';
const SCALAR_PATCH_KEYS: ScalarPatchKey[] = ['missionId', 'serveFp', 'passFp', 'selfFp', 'arm', 'armWatermark', 'outcomeClass'];
type BoolPatchKey = 'failCounted' | 'forced';
const BOOL_PATCH_KEYS: BoolPatchKey[] = ['failCounted', 'forced'];
/** Free-text keys clamped on write (never stored raw — see CONDUCTOR_PASS_SUMMARY_MAX_CHARS). */
type TextPatchKey = 'summary';
const TEXT_PATCH_KEYS: TextPatchKey[] = ['summary'];
type NumericPatchKey = 'nodesSpent';
const NUMERIC_PATCH_KEYS: NumericPatchKey[] = ['nodesSpent'];

function buildProgressSet(patch: Partial<Pick<ConductorPassJournalRow, ScalarPatchKey | JsonPatchKey | BoolPatchKey | TextPatchKey | NumericPatchKey>>): {
  clauses: string[];
  values: (string | number | null)[];
} {
  const clauses: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of SCALAR_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(patch[key] ?? null);
    }
  }
  for (const key of NUMERIC_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(patch[key] ?? null);
    }
  }
  for (const key of BOOL_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      const v = patch[key];
      values.push(v == null ? null : v ? 1 : 0);
    }
  }
  for (const key of TEXT_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(clampPassSummary(patch[key]));
    }
  }
  for (const key of JSON_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(JSON.stringify(patch[key] ?? null));
    }
  }
  return { clauses, values };
}

/** Update partial mid-pass fields without touching endedAt/outcome/ran, so a killed pass
 *  still shows its partial progress. Returns whether a row was updated, false on throw. */
export function appendPassProgress(
  id: string,
  patch: Partial<Pick<ConductorPassJournalRow, ScalarPatchKey | JsonPatchKey | BoolPatchKey | TextPatchKey | NumericPatchKey>>,
): boolean {
  try {
    const { clauses, values } = buildProgressSet(patch);
    if (clauses.length === 0) return false;
    const d = openDb();
    const result = d.prepare(`UPDATE conductor_pass SET ${clauses.join(', ')} WHERE id=?`).run(...values, id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

/** Stamp endedAt/outcome/ran and any other patched fields. Returns whether a row was
 *  updated, false on throw. */
export function finalizePassRow(
  id: string,
  patch: Partial<Omit<ConductorPassJournalRow, 'id' | 'project' | 'startedAt'>>,
): boolean {
  try {
    const { clauses, values } = buildProgressSet(patch);
    clauses.push('endedAt=?');
    values.push(patch.endedAt ?? Date.now());
    clauses.push('outcome=?');
    values.push(patch.outcome ?? null);
    clauses.push('ran=?');
    values.push(patch.ran == null ? null : patch.ran ? 1 : 0);
    const d = openDb();
    const result = d.prepare(`UPDATE conductor_pass SET ${clauses.join(', ')} WHERE id=?`).run(...values, id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

function parseJsonArray(text: string | null, fallback: unknown[]): any {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseJsonValue(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rowFromRaw(r: any): ConductorPassJournalRow {
  return {
    id: r.id,
    project: r.project,
    missionId: r.missionId ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
    serveFp: r.serveFp ?? null,
    passFp: r.passFp ?? null,
    selfFp: r.selfFp ?? null,
    arm: r.arm ?? null,
    criteriaActed: parseJsonArray(r.criteriaActed, []),
    filed: parseJsonValue(r.filed),
    declined: parseJsonArray(r.declined, []),
    outcome: r.outcome ?? null,
    ran: r.ran == null ? null : r.ran === 1,
    failCounted: r.failCounted == null ? null : r.failCounted === 1,
    carried: r.carried == null ? null : parseJsonValue(r.carried) as ConductorPassJournalRow['carried'],
    summary: r.summary ?? null,
    forced: r.forced == null ? null : r.forced === 1,
    nodesSpent: r.nodesSpent ?? null,
    armWatermark: r.armWatermark ?? null,
    outcomeClass: r.outcomeClass ?? null,
  };
}

/** Normalize `row.filed` to a typed array of refs, returning [] for legacy shapes (e.g. the
 *  old count object) or any entry that doesn't match the typed shape. */
export function filedRefsOf(row: Pick<ConductorPassJournalRow, 'filed'>): ConductorFiledRef[] {
  const f = row.filed;
  if (!Array.isArray(f)) return [];
  return f.filter(
    (x): x is ConductorFiledRef =>
      x != null && typeof x === 'object' &&
      (x.kind === 'epic' || x.kind === 'leaf' || x.kind === 'card') &&
      typeof x.id === 'string' && typeof x.title === 'string',
  );
}

export interface ConductorPassListOpts {
  missionId?: string;
  limit?: number;
  /** Rows to skip, newest-first, before `limit` applies. Purely additive: omitting it is
   *  byte-identical to the pre-pagination behaviour. */
  offset?: number;
}

/**
 * List conductor passes for a project, newest-first. Returns [] on throw.
 *
 * The signature is deliberately unchanged (array return, optional opts) — `src/mcp/system-tools.ts`
 * (`list_conductor_passes`), `conductor-pass-liveness.ts` and `countConsecutiveFailedPasses`
 * consume the array directly. Pagination is ADDITIVE: `opts.offset` here, plus a sibling
 * `listConductorPassesPage` for callers that also need the filter's total.
 */
export function listConductorPasses(project: string, opts?: ConductorPassListOpts): ConductorPassJournalRow[] {
  try {
    const d = openDb();
    let sql = `SELECT * FROM conductor_pass WHERE project=?`;
    const params: (string | number)[] = [project];
    if (opts?.missionId !== undefined) {
      sql += ` AND missionId=?`;
      params.push(opts.missionId);
    }
    sql += ` ORDER BY startedAt DESC`;
    if (opts?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(opts.limit);
    } else if (opts?.offset !== undefined) {
      // SQLite accepts OFFSET only as a suffix of LIMIT; -1 means "no limit".
      sql += ` LIMIT -1`;
    }
    if (opts?.offset !== undefined) {
      sql += ` OFFSET ?`;
      params.push(opts.offset);
    }
    const rows = d.query(sql).all(...params) as Array<any>;
    return rows.map(rowFromRaw);
  } catch {
    return [];
  }
}

/** Total conductor passes matching the same (project, missionId) filter `listConductorPasses`
 *  applies — i.e. ignoring limit/offset. Returns 0 on throw. */
export function countConductorPasses(project: string, opts?: { missionId?: string }): number {
  try {
    const d = openDb();
    let sql = `SELECT COUNT(*) AS n FROM conductor_pass WHERE project=?`;
    const params: (string | number)[] = [project];
    if (opts?.missionId !== undefined) {
      sql += ` AND missionId=?`;
      params.push(opts.missionId);
    }
    const row = d.query(sql).get(...params) as { n: number } | null;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** One page of conductor passes plus the total for the same filter, for paginating surfaces.
 *  Degrades to `{ rows: [], total: 0 }` on throw. */
export function listConductorPassesPage(
  project: string,
  opts?: ConductorPassListOpts,
): { rows: ConductorPassJournalRow[]; total: number } {
  return { rows: listConductorPasses(project, opts), total: countConductorPasses(project, opts) };
}

/** Retrieve the durable per-arm last-execution watermark from the newest conductor pass
 *  that has the armWatermark field populated. Returns null if no watermark is found or if
 *  parsing fails. The watermark is a durable "since that arm last executed" record, per-mission. */
export function latestArmWatermark(
  project: string,
  missionId: string,
  arm: 'verify-panel' | 'land',
): string | null {
  try {
    const rows = listConductorPasses(project, { missionId });
    for (const row of rows) {
      if (row.armWatermark == null) continue;
      try {
        const parsed = JSON.parse(row.armWatermark) as Record<string, string | undefined>;
        const key = parsed[arm];
        if (key) return key;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Derive the contiguous run of node-failed passes for (project, missionId, serveFp),
 *  walking newest-first and stopping at the first non-matching row. Returns 0 on throw. */
export function countConsecutiveFailedPasses(
  project: string,
  missionId: string,
  serveFp: string,
  excludeId?: string | null,
): number {
  try {
    const rows = listConductorPasses(project, { missionId });
    let count = 0;
    for (const row of rows) {
      if (row.id === excludeId) continue;
      if (row.endedAt === null) break;
      if (row.serveFp !== serveFp) break;
      // A row with ran!==true represents no real attempt this tick (e.g. a debounced early
      // return, or a fail-open cap arm) — it carries the serveFp it saw but never spent a node,
      // so it is transparent to the walk: skip it without breaking the contiguous run.
      if (row.ran !== true) continue;
      if (row.outcome !== 'node-failed') break;
      if (row.failCounted === false) continue;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * An EMPTY CONDUCT: the pass RAN a real conductor node and the node exited as a success
 * (`ran === true`, `outcome === 'conducted'`) — but it filed NOTHING and carried NOTHING.
 *
 * This is the shape that wedged mission 949dda42 (2026-08-14): 253 seconds of Opus, 15,921
 * output tokens, exit 0, `filed: []`, `carried: {count: 0}`, and three criteria left sitting at
 * `discover`. Structurally it is INDISTINGUISHABLE from a successful conduct — which is exactly
 * why it has to be named: an empty conduct is a no-progress attempt wearing a success's clothes,
 * and treating it as a success is what locks a mission forever (see latestProductivePassFp).
 *
 * `carried: null` (the common case — nothing was deferred) reads as count 0, deliberately: a
 * pass that deferred nothing carried nothing.
 */
export function isEmptyConductRow(
  row: Pick<ConductorPassJournalRow, 'ran' | 'outcome' | 'filed' | 'carried'>,
): boolean {
  if (row.ran !== true || row.outcome !== 'conducted') return false;
  return filedRefsOf(row).length === 0 && (row.carried?.count ?? 0) === 0;
}

/**
 * Return the fingerprints of the pass the debounce may anchor on: the most recent finalized,
 * productive (outcome:'conducted', ran:true) pass — walking newest-first and skipping any
 * other row. Returns null on throw or if no such row exists.
 *
 * An EMPTY CONDUCT (isEmptyConductRow) is NOT such a pass — but ONLY when the caller says this
 * pass had something it could have FILED (`emptyConductAnchors: false`). Then hitting one STOPS
 * the walk and returns null: skipping it would fall back to an OLDER productive pass, and if that
 * older pass's fingerprint happens to equal the current one the mission debounces forever again —
 * the exact wedge. "The last thing the conductor did on this mission moved nothing" means there
 * is no valid anchor, so the next pass re-arms.
 *
 * DEFAULT `emptyConductAnchors: true` — an empty conduct anchors, exactly as it always did. The
 * caller (conductor-pass.ts) flips it only when a FILEABLE gap exists (isFileableServeGap),
 * because a pass with nothing fileable — every discover criterion already has an OPEN serving
 * epic, however inert or base-red — files nothing CORRECTLY and must settle into the fingerprint
 * debounce after ONE node (the 2026-07-23 self-excitation incident). The default is deliberately
 * the SAFE direction: a caller that forgets the distinction debounces rather than re-spins nodes.
 *
 * The re-arm is bounded by CONDUCTOR_EMPTY_CONDUCT_CAP at the call site; this function only tells
 * the truth about whether an anchor exists.
 */
export function latestProductivePassFp(
  project: string,
  missionId: string,
  opts?: { emptyConductAnchors?: boolean },
): { passFp: string | null; selfFp: string | null } | null {
  const emptyConductAnchors = opts?.emptyConductAnchors ?? true;
  try {
    const rows = listConductorPasses(project, { missionId });
    for (const row of rows) {
      if (row.endedAt === null) continue;
      if (row.outcome !== 'conducted' || row.ran !== true) continue;
      if (!emptyConductAnchors && isEmptyConductRow(row)) return null;
      return { passFp: row.passFp, selfFp: row.selfFp };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive the contiguous run of EMPTY CONDUCTS for (project, missionId, serveFp), walking
 * newest-first and stopping at the first row that breaks the run. Returns 0 on throw.
 *
 * Deliberately the same SHAPE as countConsecutiveFailedPasses: same walk, same serveFp break,
 * same "a row that never spent a node is transparent" skip. It is a separate counter for the
 * same reason CONDUCTOR_TIMEOUT_RECUR_CAP is: an empty conduct is a distinct fact about the
 * serve-state (a real node looked at it and had nothing to do) from a node FAILURE, and must
 * not consume — or be reset by — the other counter.
 */
export function countConsecutiveEmptyConducts(
  project: string,
  missionId: string,
  serveFp: string,
  excludeId?: string | null,
): number {
  try {
    const rows = listConductorPasses(project, { missionId });
    let count = 0;
    for (const row of rows) {
      if (row.id === excludeId) continue;
      if (row.endedAt === null) break;
      if (row.serveFp !== serveFp) break;
      // No node spent this tick (debounced early return, cap fail-open arm) ⇒ transparent.
      if (row.ran !== true) continue;
      if (!isEmptyConductRow(row)) break; // a productive pass (or any other arm) resets the run
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}
