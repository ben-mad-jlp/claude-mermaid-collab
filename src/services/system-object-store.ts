import Database from 'bun:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  SystemObject,
  SystemObjectType,
  SystemRevision,
  JSONSchema,
} from './domain-plugin';

/**
 * Per-PROJECT durable system-object store (design-system-object-primitive §3,
 * Phase 2 #2). A NEW `.collab/system-objects.db` (bun:sqlite), cloning the
 * todo-store idioms (openDb cache, addColumnIfMissing, withLock, WAL).
 *
 * Three tables: `types` (the registry — schema, grammar, gate binding), `instances`
 * (durable object identity + composition), `revisions` (content-hash snapshots).
 *
 * THE WORK-VS-DURABLE FIREWALL (§4): the `instances` table has NO status,
 * claimedBy, or leaseExpiresAt columns — by construction. Work to build/change an
 * object lives on a Todo via the one-directional Todo.objectRef link, never here.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS types (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  domain TEXT NOT NULL,
  attributeSchema TEXT NOT NULL DEFAULT '{}',
  allowedChildTypes TEXT NOT NULL DEFAULT '[]',
  requiredArtifacts TEXT NOT NULL DEFAULT '[]',
  gateBinding TEXT,
  agentProfile TEXT,
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  typeId TEXT NOT NULL,
  typeVersion INTEGER NOT NULL,
  parentObjectId TEXT,
  qty REAL NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  currentRevisionId TEXT
);
CREATE INDEX IF NOT EXISTS idx_instances_parent ON instances(parentObjectId);
CREATE INDEX IF NOT EXISTS idx_instances_type ON instances(typeId);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  objectId TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  gateVerdict TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_revisions_object ON revisions(objectId);
CREATE INDEX IF NOT EXISTS idx_revisions_hash ON revisions(objectId, contentHash);
`;

function addColumnIfMissing(db: Database, table: string, col: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'system-objects.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Forward-compat hooks (mirror todo-store): additive columns land via
  // addColumnIfMissing so an existing DB upgrades in place. None yet.
  void addColumnIfMissing;
  void existsSync;
  dbCache.set(project, db);
  return db;
}

/** Internal accessor: the project's (cached, schema-applied) DB handle. Used by
 *  sibling read-only query modules (e.g. system-object-bom.ts) so they reuse the
 *  same connection + schema rather than re-opening it. */
export function getStoreDb(project: string): Database {
  return openDb(project);
}

/** For tests: drop the cached handle so a fresh dir opens a fresh DB. */
export function _closeProject(project: string): void {
  const db = dbCache.get(project);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    dbCache.delete(project);
  }
}

// Per-project serialized write lock (mirrors todo-store.withLock).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

const nowMs = () => Date.now();

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

/** Stable JSON: object keys sorted recursively so equal content ⇒ equal string.
 *  Arrays keep order (caller sorts where order is not semantic). */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return null; // defensive: break cycles
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

/** Canonical content serialization for the revision hash: attributes (key-sorted)
 *  + child refs sorted by id then qty + artifact hashes sorted. */
export function canonicalContent(
  attributes: Record<string, unknown>,
  children: Array<{ id: string; qty: number }>,
  artifactHashes: string[],
): string {
  const childRefs = [...children]
    .map((c) => ({ id: c.id, qty: c.qty }))
    .sort((a, b) => (a.id === b.id ? a.qty - b.qty : a.id < b.id ? -1 : 1));
  return stableStringify({
    attributes,
    children: childRefs,
    artifacts: [...artifactHashes].sort(),
  });
}

/** Content hash over the canonical serialization. */
export function contentHash(
  attributes: Record<string, unknown>,
  children: Array<{ id: string; qty: number }>,
  artifactHashes: string[],
): string {
  return createHash('sha256')
    .update(canonicalContent(attributes, children, artifactHashes))
    .digest('hex');
}

/** Minimal attribute validation against a JSON-Schema-shaped object: enforces
 *  `required` keys and, when `additionalProperties === false`, rejects keys not
 *  in `properties`. Returns the list of violations (empty = valid). A full
 *  JSON-Schema validator is out of scope for the core store (§3 keeps it thin). */
export function validateAttributes(
  schema: JSONSchema | null | undefined,
  attributes: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== 'object') return errors;
  const required = Array.isArray((schema as Record<string, unknown>).required)
    ? ((schema as Record<string, unknown>).required as string[])
    : [];
  for (const key of required) {
    if (!(key in attributes)) errors.push(`missing required attribute: ${key}`);
  }
  const props = (schema as Record<string, unknown>).properties;
  if (
    (schema as Record<string, unknown>).additionalProperties === false &&
    props && typeof props === 'object'
  ) {
    const allowed = new Set(Object.keys(props as Record<string, unknown>));
    for (const key of Object.keys(attributes)) {
      if (!allowed.has(key)) errors.push(`unexpected attribute: ${key}`);
    }
  }
  return errors;
}

/** Composition-grammar check: is `childTypeId` allowed under `parentType`? The
 *  default inlines the array membership; plugin-registry's richer validateChild
 *  can be injected via createObject's `validators` once it lands (Phase 2 #4). */
export function validateChild(childTypeId: string, parentType: SystemObjectType): boolean {
  return parentType.allowedChildTypes.includes(childTypeId);
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

interface TypeRow {
  id: string; version: number; domain: string; attributeSchema: string;
  allowedChildTypes: string; requiredArtifacts: string;
  gateBinding: string | null; agentProfile: string | null;
}
interface InstanceRow {
  id: string; typeId: string; typeVersion: number; parentObjectId: string | null;
  qty: number; name: string; attributes: string; currentRevisionId: string | null;
}
interface RevisionRow {
  id: string; objectId: string; contentHash: string; createdAt: number; gateVerdict: string;
}

function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToType(r: TypeRow): SystemObjectType {
  return {
    id: r.id,
    version: r.version,
    domain: r.domain,
    attributeSchema: parseJson<JSONSchema>(r.attributeSchema, {}),
    allowedChildTypes: parseJson<string[]>(r.allowedChildTypes, []),
    requiredArtifacts: parseJson<string[]>(r.requiredArtifacts, []),
    gateBinding: r.gateBinding,
    agentProfile: r.agentProfile,
  };
}

function rowToObject(r: InstanceRow): SystemObject {
  return {
    id: r.id,
    typeId: r.typeId,
    typeVersion: r.typeVersion,
    parentObjectId: r.parentObjectId,
    qty: r.qty,
    name: r.name,
    attributes: parseJson<Record<string, unknown>>(r.attributes, {}),
    currentRevisionId: r.currentRevisionId,
  };
}

function rowToRevision(r: RevisionRow): SystemRevision {
  const v = r.gateVerdict;
  const gateVerdict: SystemRevision['gateVerdict'] =
    v === 'pass' || v === 'fail' ? v : 'unknown';
  return { id: r.id, objectId: r.objectId, contentHash: r.contentHash, createdAt: r.createdAt, gateVerdict };
}

// ─── Type registry CRUD ──────────────────────────────────────────────────────

/** Insert or replace a type version (the registry/plugin seeder writes here). */
export function upsertType(project: string, type: SystemObjectType): Promise<SystemObjectType> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare(
      `INSERT OR REPLACE INTO types
       (id, version, domain, attributeSchema, allowedChildTypes, requiredArtifacts, gateBinding, agentProfile)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      type.id, type.version, type.domain,
      JSON.stringify(type.attributeSchema ?? {}),
      JSON.stringify(type.allowedChildTypes ?? []),
      JSON.stringify(type.requiredArtifacts ?? []),
      type.gateBinding ?? null, type.agentProfile ?? null,
    );
    return getType(project, type.id, type.version)!;
  });
}

/** Read a type. With `version`, the exact row; without, the HIGHEST version. */
export function getType(project: string, id: string, version?: number): SystemObjectType | null {
  const db = openDb(project);
  const row = version == null
    ? (db.query('SELECT * FROM types WHERE id = ? ORDER BY version DESC LIMIT 1').get(id) as TypeRow | null)
    : (db.query('SELECT * FROM types WHERE id = ? AND version = ?').get(id, version) as TypeRow | null);
  return row ? rowToType(row) : null;
}

export function listTypes(project: string): SystemObjectType[] {
  const db = openDb(project);
  const rows = db.query('SELECT * FROM types ORDER BY id ASC, version ASC').all() as TypeRow[];
  return rows.map(rowToType);
}

// ─── Instance CRUD ───────────────────────────────────────────────────────────

export interface CreateObjectInput {
  typeId: string;
  name: string;
  attributes?: Record<string, unknown>;
  parentObjectId?: string | null;
  qty?: number;
  /** Pin a specific type version; defaults to the type's highest version. */
  typeVersion?: number;
}

export interface CreateObjectValidators {
  /** Override the default composition-grammar check (plugin-registry, Phase 2 #4). */
  validateChild?: (childTypeId: string, parentType: SystemObjectType) => boolean;
}

/**
 * Create a durable object: resolve + PIN the type version, validate attributes
 * against the type's schema, enforce the composition grammar against the parent,
 * and insert. No revision is created here — call newRevision to snapshot content.
 */
export function createObject(
  project: string,
  input: CreateObjectInput,
  validators: CreateObjectValidators = {},
): Promise<SystemObject> {
  return withLock(project, () => {
    const type = getType(project, input.typeId, input.typeVersion);
    if (!type) {
      throw new Error(
        `createObject: unknown type ${input.typeId}${input.typeVersion != null ? `@${input.typeVersion}` : ''}`,
      );
    }
    const attributes = input.attributes ?? {};
    const attrErrors = validateAttributes(type.attributeSchema, attributes);
    if (attrErrors.length) {
      throw new Error(`createObject: attribute validation failed for ${type.id}: ${attrErrors.join('; ')}`);
    }
    const parentId = input.parentObjectId ?? null;
    if (parentId) {
      const parent = getObject(project, parentId);
      if (!parent) throw new Error(`createObject: parent object not found: ${parentId}`);
      const parentType = getType(project, parent.typeId, parent.typeVersion);
      if (!parentType) throw new Error(`createObject: parent type not found: ${parent.typeId}@${parent.typeVersion}`);
      const check = validators.validateChild ?? validateChild;
      if (!check(input.typeId, parentType)) {
        throw new Error(`createObject: type ${input.typeId} is not an allowed child of ${parentType.id}`);
      }
    }
    const db = openDb(project);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO instances (id, typeId, typeVersion, parentObjectId, qty, name, attributes, currentRevisionId)
       VALUES (?,?,?,?,?,?,?,NULL)`
    ).run(
      id, type.id, type.version, parentId,
      input.qty ?? 1, input.name, JSON.stringify(attributes),
    );
    return getObject(project, id)!;
  });
}

export function getObject(project: string, id: string): SystemObject | null {
  const db = openDb(project);
  const row = db.query('SELECT * FROM instances WHERE id = ?').get(id) as InstanceRow | null;
  return row ? rowToObject(row) : null;
}

/** List objects, optionally only the direct children of a parent. */
export function listObjects(
  project: string,
  opts: { parentObjectId?: string | null } = {},
): SystemObject[] {
  const db = openDb(project);
  let rows: InstanceRow[];
  if ('parentObjectId' in opts) {
    rows = opts.parentObjectId == null
      ? (db.query('SELECT * FROM instances WHERE parentObjectId IS NULL ORDER BY id ASC').all() as InstanceRow[])
      : (db.query('SELECT * FROM instances WHERE parentObjectId = ? ORDER BY id ASC').all(opts.parentObjectId) as InstanceRow[]);
  } else {
    rows = db.query('SELECT * FROM instances ORDER BY id ASC').all() as InstanceRow[];
  }
  return rows.map(rowToObject);
}

// ─── Revisions (content-hash snapshots) ──────────────────────────────────────

/**
 * Snapshot an object's current content as a revision. Hash is over the canonical
 * { attributes, child refs (sorted), artifact hashes (sorted) }. On an identical
 * hash the existing revision is REUSED (no duplicate row); otherwise a fresh
 * revision is inserted with gateVerdict='unknown'. Either way the object's
 * currentRevisionId is set to the resulting revision.
 *
 * @param artifactHashes content hashes of attached artifacts (none wired yet → []).
 */
export function newRevision(
  project: string,
  objectId: string,
  artifactHashes: string[] = [],
): Promise<SystemRevision> {
  return withLock(project, () => {
    const db = openDb(project);
    const obj = getObject(project, objectId);
    if (!obj) throw new Error(`newRevision: object not found: ${objectId}`);
    const children = (db.query('SELECT id, qty FROM instances WHERE parentObjectId = ?').all(objectId) as Array<{ id: string; qty: number }>);
    const hash = contentHash(obj.attributes, children, artifactHashes);

    const existing = db.query('SELECT * FROM revisions WHERE objectId = ? AND contentHash = ? LIMIT 1')
      .get(objectId, hash) as RevisionRow | null;
    const rev = existing ?? (() => {
      const id = randomUUID();
      db.prepare('INSERT INTO revisions (id, objectId, contentHash, createdAt, gateVerdict) VALUES (?,?,?,?,?)')
        .run(id, objectId, hash, nowMs(), 'unknown');
      return db.query('SELECT * FROM revisions WHERE id = ?').get(id) as RevisionRow;
    })();

    db.prepare('UPDATE instances SET currentRevisionId = ? WHERE id = ?').run(rev.id, objectId);
    return rowToRevision(rev);
  });
}

export function getRevision(project: string, id: string): SystemRevision | null {
  const db = openDb(project);
  const row = db.query('SELECT * FROM revisions WHERE id = ?').get(id) as RevisionRow | null;
  return row ? rowToRevision(row) : null;
}

export function listRevisions(project: string, objectId: string): SystemRevision[] {
  const db = openDb(project);
  const rows = db.query('SELECT * FROM revisions WHERE objectId = ? ORDER BY createdAt ASC').all(objectId) as RevisionRow[];
  return rows.map(rowToRevision);
}
