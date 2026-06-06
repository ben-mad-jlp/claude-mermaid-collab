import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Decision-record store (PCS open-problem #9). Project-scoped first-class
 * records of planning decisions, active constraints, and assumptions — a
 * SEPARATE table, NOT a todo kind. Every planner pass reads current constraints
 * and proposes updates; `/focus <epic>` pulls the epic + project-level active
 * constraints from here. Mirrors the todo-store per-project bun:sqlite pattern.
 *
 * Lifecycle: proposed → approved → active → superseded.
 *  - kind='decision'    → auto-approved: created 'active'.
 *  - kind='assumption'  → recorded as 'active' (a working assumption).
 *  - kind='constraint'  → created 'proposed'; needs HUMAN approval (→ 'active').
 *  - kind='requirement' → created 'proposed' (like constraints); carries a
 *      machine-checkable spec {metric, op, target}. The spec→Planner bridge.
 */

export type DecisionKind = 'decision' | 'constraint' | 'assumption' | 'requirement';
export type DecisionStatus = 'proposed' | 'approved' | 'active' | 'superseded';

/** Machine-checkable target for a requirement: e.g. {metric:'p95_latency_ms', op:'<=', target:200}. Null for non-requirement kinds. */
export interface RequirementSpec {
  metric: string;
  op: string;
  target: number | string;
}

export interface DecisionRecord {
  id: string;
  project: string;
  epicId: string | null; // null = project-level
  kind: DecisionKind;
  status: DecisionStatus;
  title: string;
  rationale: string | null;
  alternatives: string[];
  spec: RequirementSpec | null; // populated only for kind='requirement'
  supersededBy: string | null;
  linkedTodos: string[];
  authorSession: string | null;
  approvedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDecisionInput {
  epicId?: string | null;
  kind: DecisionKind;
  title: string;
  rationale?: string | null;
  alternatives?: string[];
  spec?: RequirementSpec | null;
  linkedTodos?: string[];
  authorSession?: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS decision_record (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  epicId TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  alternatives TEXT NOT NULL DEFAULT '[]',
  spec TEXT,
  supersededBy TEXT,
  linkedTodos TEXT NOT NULL DEFAULT '[]',
  authorSession TEXT,
  approvedBy TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dr_epic ON decision_record(project, epicId);
CREATE INDEX IF NOT EXISTS idx_dr_kind_status ON decision_record(project, kind, status);
`;

const dbCache = new Map<string, Database>();

function addColumnIfMissing(d: Database, table: string, col: string, ddl: string): void {
  const cols = d.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'decision-records.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Idempotent migration for existing DBs: nullable requirement spec ({metric,op,target}).
  addColumnIfMissing(db, 'decision_record', 'spec', 'spec TEXT');
  dbCache.set(project, db);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens next call. */
export function _closeProject(project: string): void {
  const db = dbCache.get(project);
  if (db) { try { db.close(); } catch { /* ignore */ } dbCache.delete(project); }
}

function rowToRecord(r: any): DecisionRecord {
  return {
    id: r.id, project: r.project, epicId: r.epicId ?? null, kind: r.kind, status: r.status,
    title: r.title, rationale: r.rationale ?? null,
    alternatives: safeArr(r.alternatives), spec: safeSpec(r.spec), supersededBy: r.supersededBy ?? null,
    linkedTodos: safeArr(r.linkedTodos), authorSession: r.authorSession ?? null,
    approvedBy: r.approvedBy ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
function safeArr(s: unknown): string[] { try { return JSON.parse(String(s)); } catch { return []; } }
function safeSpec(s: unknown): RequirementSpec | null {
  if (s == null) return null;
  try { const v = JSON.parse(String(s)); return v && typeof v === 'object' ? v as RequirementSpec : null; } catch { return null; }
}

/** Initial status by kind: constraints & requirements await human approval; decisions/assumptions are active. */
function initialStatus(kind: DecisionKind): DecisionStatus {
  return kind === 'constraint' || kind === 'requirement' ? 'proposed' : 'active';
}

export function createDecisionRecord(project: string, input: CreateDecisionInput): DecisionRecord {
  const db = openDb(project);
  const now = Date.now();
  const rec: DecisionRecord = {
    id: crypto.randomUUID(),
    project,
    epicId: input.epicId ?? null,
    kind: input.kind,
    status: initialStatus(input.kind),
    title: input.title,
    rationale: input.rationale ?? null,
    alternatives: input.alternatives ?? [],
    spec: input.spec ?? null,
    supersededBy: null,
    linkedTodos: input.linkedTodos ?? [],
    authorSession: input.authorSession ?? null,
    approvedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO decision_record (id, project, epicId, kind, status, title, rationale, alternatives,
      spec, supersededBy, linkedTodos, authorSession, approvedBy, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(rec.id, rec.project, rec.epicId, rec.kind, rec.status, rec.title, rec.rationale,
    JSON.stringify(rec.alternatives), rec.spec ? JSON.stringify(rec.spec) : null,
    rec.supersededBy, JSON.stringify(rec.linkedTodos),
    rec.authorSession, rec.approvedBy, rec.createdAt, rec.updatedAt);
  return rec;
}

export function getDecisionRecord(project: string, id: string): DecisionRecord | null {
  const db = openDb(project);
  const row = db.query(`SELECT * FROM decision_record WHERE id = ?`).get(id);
  return row ? rowToRecord(row) : null;
}

export function listDecisionRecords(
  project: string,
  filter?: { epicId?: string | null; kind?: DecisionKind; status?: DecisionStatus },
): DecisionRecord[] {
  const db = openDb(project);
  const where: string[] = ['project = ?'];
  const params: Array<string | null> = [project];
  if (filter && 'epicId' in filter) { where.push('epicId IS ?'); params.push(filter.epicId ?? null); }
  if (filter?.kind) { where.push('kind = ?'); params.push(filter.kind); }
  if (filter?.status) { where.push('status = ?'); params.push(filter.status); }
  return (db.query(`SELECT * FROM decision_record WHERE ${where.join(' AND ')} ORDER BY createdAt`)
    .all(...params) as any[]).map(rowToRecord);
}

/** Approve a proposed/approved record (human gate for constraints). */
export function approveDecisionRecord(project: string, id: string, approvedBy: string): DecisionRecord | null {
  const db = openDb(project);
  db.prepare(`UPDATE decision_record SET status='active', approvedBy=?, updatedAt=? WHERE id=? AND status IN ('proposed','approved')`)
    .run(approvedBy, Date.now(), id);
  return getDecisionRecord(project, id);
}

/** Supersede `id` with `bySupersedingId` (the new record should already exist). */
export function supersedeDecisionRecord(project: string, id: string, bySupersedingId: string): DecisionRecord | null {
  const db = openDb(project);
  db.prepare(`UPDATE decision_record SET status='superseded', supersededBy=?, updatedAt=? WHERE id=?`)
    .run(bySupersedingId, Date.now(), id);
  return getDecisionRecord(project, id);
}

/**
 * Active constraints in scope for an epic: epic-level + project-level (epicId
 * null). The decision-record half of `/focus <epic>` (the todo-subtree queries
 * live in todo-store). Only kind='constraint', status='active'.
 */
export function getActiveConstraints(project: string, epicId?: string | null): DecisionRecord[] {
  const all = listDecisionRecords(project, { kind: 'constraint', status: 'active' });
  if (epicId === undefined) return all;
  return all.filter((r) => r.epicId === null || r.epicId === epicId);
}

/**
 * Active requirements in scope for an epic: epic-level + project-level (epicId
 * null). Peer of getActiveConstraints — the spec→Planner bridge the Planner's
 * Orient step reads alongside constraints. Only kind='requirement', status='active'.
 */
export function getActiveRequirements(project: string, epicId?: string | null): DecisionRecord[] {
  const all = listDecisionRecords(project, { kind: 'requirement', status: 'active' });
  if (epicId === undefined) return all;
  return all.filter((r) => r.epicId === null || r.epicId === epicId);
}
