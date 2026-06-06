import { randomUUID } from 'node:crypto';
import { getStoreDb } from './system-object-store';

/**
 * Traceability edges over the system-object graph (design-system-object-primitive
 * §1b, Phase 3). Typed NON-tree edges in the system-objects.db `edges` table,
 * homogeneous: every endpoint is an opaque id string (an object id, or a
 * decision-record requirement id) — the same one-directional FK pattern as
 * Todo.objectRef, never a hard cross-table FK.
 *
 * The 4 SysML verbs:
 *   derive   req → req       (a requirement derived from another)
 *   allocate req → object    (a requirement allocated to an object)
 *   satisfy  object → req    (an object claims to satisfy a requirement)
 *   verify   verdict → req   (a gate verdict proves a requirement)
 *
 * Coverage = the active requirements with NO active satisfy/verify edge.
 * STALE-on-bump = a content-hash revision bump (object) or a requirement
 * supersede flips that object's/requirement's satisfy+verify edges to `stale`.
 */

export type EdgeKind = 'derive' | 'allocate' | 'satisfy' | 'verify';
export type EdgeStatus = 'active' | 'stale';

export interface TraceEdge {
  id: string;
  kind: EdgeKind;
  /** Source endpoint id (req id, object id, or verdict/revision ref per kind). */
  srcId: string;
  /** Destination endpoint id. */
  dstId: string;
  /** The object a satisfy/verify edge concerns — the stale-on-bump key. Null for
   *  derive/allocate (not subject to revision staleness). */
  aboutObjectId: string | null;
  status: EdgeStatus;
  createdAt: number;
}

interface EdgeRow {
  id: string; kind: string; srcId: string; dstId: string;
  aboutObjectId: string | null; status: string; createdAt: number;
}

const EDGES_DDL = `
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  srcId TEXT NOT NULL,
  dstId TEXT NOT NULL,
  aboutObjectId TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dstId);
CREATE INDEX IF NOT EXISTS idx_edges_about ON edges(aboutObjectId);
`;

const ensured = new WeakSet<object>();
function db(project: string) {
  const d = getStoreDb(project);
  if (!ensured.has(d)) { d.exec(EDGES_DDL); ensured.add(d); }
  return d;
}

const nowMs = () => Date.now();

function rowToEdge(r: EdgeRow): TraceEdge {
  return {
    id: r.id,
    kind: r.kind as EdgeKind,
    srcId: r.srcId,
    dstId: r.dstId,
    aboutObjectId: r.aboutObjectId,
    status: r.status === 'stale' ? 'stale' : 'active',
    createdAt: r.createdAt,
  };
}

/** Create a typed edge. `aboutObjectId` is the stale-on-bump key for satisfy/verify. */
export function createEdge(
  project: string,
  kind: EdgeKind,
  srcId: string,
  dstId: string,
  aboutObjectId: string | null = null,
): TraceEdge {
  const d = db(project);
  const id = randomUUID();
  d.prepare('INSERT INTO edges (id, kind, srcId, dstId, aboutObjectId, status, createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, kind, srcId, dstId, aboutObjectId, 'active', nowMs());
  return rowToEdge(d.query('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow);
}

/** derive: a requirement derived from another requirement (req → req). */
export function derive(project: string, fromReqId: string, toReqId: string): TraceEdge {
  return createEdge(project, 'derive', fromReqId, toReqId, null);
}

/** allocate: a requirement allocated to an object (req → object). */
export function allocate(project: string, reqId: string, objectId: string): TraceEdge {
  return createEdge(project, 'allocate', reqId, objectId, null);
}

/** satisfy: an object claims to satisfy a requirement (object → req). The object
 *  is the stale-on-bump subject. */
export function satisfy(project: string, objectId: string, reqId: string): TraceEdge {
  return createEdge(project, 'satisfy', objectId, reqId, objectId);
}

/** verify: a gate verdict proves a requirement (verdict/revision ref → req).
 *  Pass the object the verdict is about so a later revision bump can stale it. */
export function verify(
  project: string,
  verdictRef: string,
  reqId: string,
  aboutObjectId: string | null = null,
): TraceEdge {
  return createEdge(project, 'verify', verdictRef, reqId, aboutObjectId);
}

/** All edges, optionally filtered by kind and/or status. */
export function listEdges(
  project: string,
  opts: { kind?: EdgeKind; status?: EdgeStatus } = {},
): TraceEdge[] {
  const d = db(project);
  const where: string[] = [];
  const args: string[] = [];
  if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
  if (opts.status) { where.push('status = ?'); args.push(opts.status); }
  const sql = `SELECT * FROM edges${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt ASC`;
  return (d.query(sql).all(...args) as EdgeRow[]).map(rowToEdge);
}

export interface CoverageResult {
  covered: string[];
  uncovered: string[];
}

/**
 * Requirement coverage: of the given active requirement ids, which have an ACTIVE
 * satisfy- or verify-edge pointing at them (covered) and which do not (uncovered).
 * The LEFT JOIN of (active requirements × edges) from §1b — a requirement with no
 * satisfy/verify path is uncovered. Stale edges do NOT count as coverage.
 */
export function coverage(project: string, requirementIds: string[]): CoverageResult {
  if (requirementIds.length === 0) return { covered: [], uncovered: [] };
  const d = db(project);
  const placeholders = requirementIds.map(() => '?').join(',');
  const rows = d.query(
    `SELECT DISTINCT dstId FROM edges
     WHERE status = 'active' AND kind IN ('satisfy','verify') AND dstId IN (${placeholders})`,
  ).all(...requirementIds) as Array<{ dstId: string }>;
  const coveredSet = new Set(rows.map((r) => r.dstId));
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const id of requirementIds) (coveredSet.has(id) ? covered : uncovered).push(id);
  return { covered, uncovered };
}

/**
 * STALE-on-bump (object): a content-hash revision bump on `objectId` invalidates
 * its downstream proof — flip that object's ACTIVE satisfy + verify edges to
 * `stale`. Returns the number of edges marked. Idempotent.
 */
export function markStaleForObject(project: string, objectId: string): number {
  const d = db(project);
  const res = d.prepare(
    `UPDATE edges SET status = 'stale'
     WHERE aboutObjectId = ? AND status = 'active' AND kind IN ('satisfy','verify')`,
  ).run(objectId);
  return res.changes;
}

/**
 * STALE-on-bump (requirement): a requirement supersede invalidates the proofs
 * pointing at it — flip ACTIVE satisfy + verify edges whose `dstId` is that
 * requirement to `stale`. Returns the number marked. Idempotent.
 */
export function markStaleForRequirement(project: string, reqId: string): number {
  const d = db(project);
  const res = d.prepare(
    `UPDATE edges SET status = 'stale'
     WHERE dstId = ? AND status = 'active' AND kind IN ('satisfy','verify')`,
  ).run(reqId);
  return res.changes;
}

/**
 * The staleness signal for the Spec Sheet (todo 9fd5fce8): object ids that have a
 * STALE satisfy/verify edge whose requirement is NOT re-covered by an ACTIVE one.
 * An object's proof goes stale when its content-hash revision bumps
 * (newRevision → markStaleForObject); RE-AUTHORING (a fresh satisfy/verify edge to
 * the same requirement) restores an active edge, which clears the signal — so the
 * glyph disappears on re-author rather than lingering behind a dead stale edge.
 * Pure read; deterministic.
 */
export function staleObjectIds(project: string): string[] {
  const d = db(project);
  const rows = d.query(
    `SELECT DISTINCT s.aboutObjectId AS oid FROM edges s
     WHERE s.status = 'stale' AND s.kind IN ('satisfy','verify') AND s.aboutObjectId IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM edges a
         WHERE a.status = 'active' AND a.kind IN ('satisfy','verify') AND a.dstId = s.dstId
       )`,
  ).all() as Array<{ oid: string }>;
  return rows.map((r) => r.oid);
}
