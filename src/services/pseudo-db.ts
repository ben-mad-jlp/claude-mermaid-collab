/**
 * Pseudo DB Service
 *
 * SQLite database for indexed pseudocode files.
 * Supports full-text search, call graph analysis, and impact analysis.
 *
 * Stored at {project}/.collab/pseudo/pseudo.db (gitignored)
 */

import Database from 'bun:sqlite';
import { join, isAbsolute } from 'path';
import * as pseudoQuery from './pseudo-query.js';

// ============================================================================
// Types
// ============================================================================

export interface PseudoFileSummary {
  filePath: string;
  title: string;
  methodCount: number;
  exportCount: number;
  lastUpdated: string;
}

export interface PseudoMethodWithMeta {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  date: string | null;
  visibility: string | null;
  isAsync: boolean;
  kind: string | null;
  sourceLine: number | null;
  sourceLineEnd: number | null;
  paramCount: number;
  stepCount: number;
  owningSymbol: string | null;
  steps: Array<{ content: string; depth: number }>;
  calls: Array<{ name: string; fileStem: string }>;
}

export interface PseudoFileWithMethods {
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  proseUpdatedAt: string | null;
  hasProse: boolean;
  structuralIndexedAt: string;
  language: string | null;
  methods: PseudoMethodWithMeta[];
}

export interface SearchResult {
  filePath: string;
  methodName: string;
  snippet: string;
  rank: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'method';
  filePath: string;
  isExported: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface AffectedItem {
  filePath: string;
  methodName: string;
  depth: number;
}

export interface CoverageReport {
  coveredFiles: number;
  totalFiles: number;
  percent: number;
  missingFiles: string[];
}

export interface StatsReport {
  fileCount: number;
  methodCount: number;
  exportCount: number;
}

export interface SourceLinkCandidate {
  sourceFilePath: string;
  sourceLine: number;
  sourceLineEnd: number | null;
  language: string | null;
  isExported: boolean;
}

export interface FunctionForSource {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  sourceLine: number | null;
  sourceLineEnd: number | null;
  visibility: string | null;
  isAsync: boolean;
  kind: string | null;
}

// ---- shared types (V6 query surface) ----

export interface StructuralMethod {
  name: string;
  params: string;
  paramCount: number;
  returnType: string;
  sourceLine: number;
  sourceLineEnd: number | null;
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  isExported: boolean;
  owningSymbol: string | null;
}

export interface ScanResult {
  language: string;
  methods: StructuralMethod[];
  lineCount: number;
  sourceHash: string;
}

export interface ProseStep {
  content: string;
  depth: number;
}

export interface ProseMethod {
  name: string;
  params?: string;
  steps: ProseStep[];
  calls: Array<{ name: string; fileStem: string }>;
}

export interface ProseData {
  title?: string;
  purpose?: string;
  moduleContext?: string;
  methods: ProseMethod[];
}

// ============================================================================
// Singleton factory
// ============================================================================

const shimInstances = new Map<string, PseudoDbV6Shim>();

let warnedUpsertStructural = false;
let warnedUpsertProse = false;
let warnedDeleteStructural = false;
let warnedCheckpointWal = false;

export class PseudoDbV6Shim {
  public readonly needsInitialScan = false;

  constructor(
    private readonly project: string,
    private readonly handle: PseudoDbV6Handle,
  ) {}

  private get db() {
    return this.handle.db;
  }

  upsertStructural(_filePath: string, _language: string, _scan: unknown): void {
    if (!warnedUpsertStructural) {
      warnedUpsertStructural = true;
      console.warn('[pseudo-db-shim] upsertStructural is a no-op under V6; indexer runs automatically');
    }
  }

  upsertProse(_filePath: string, _data: unknown): void {
    if (!warnedUpsertProse) {
      warnedUpsertProse = true;
      console.warn('[pseudo-db-shim] upsertProse is a no-op under V6; use pseudo-indexer prose flow');
    }
  }

  deleteStructural(_filePath: string): void {
    if (!warnedDeleteStructural) {
      warnedDeleteStructural = true;
      console.warn('[pseudo-db-shim] deleteStructural is a no-op under V6');
    }
  }

  checkpointWal(): void {
    if (!warnedCheckpointWal) {
      warnedCheckpointWal = true;
      console.warn('[pseudo-db-shim] checkpointWal is a no-op under V6 (in-memory)');
    }
  }

  getFileState(filePath: string) {
    const file = pseudoQuery.getFile(this.db, filePath);
    if (!file) return null;
    return {
      filePath,
      sourceHash: null as string | null,
      scannedAt: null as string | null,
      proseUpdatedAt: null as string | null,
      hasProse: file.hasProse ?? false,
      methods: (file.methods ?? []).map((m: any) => ({
        name: m.name,
        params: m.params ?? null,
        sourceHash: null as string | null,
        hasSteps: (m.stepCount ?? 0) > 0,
      })),
    };
  }

  listFiles() {
    return pseudoQuery.listFiles(this.db);
  }

  getFileByStem(stem: string) {
    return pseudoQuery.getFileByStem(this.db, stem);
  }

  getFile(filePath: string) {
    return pseudoQuery.getFile(this.db, filePath);
  }

  search(query: string) {
    return pseudoQuery.search(this.db, query);
  }

  getReferences(methodName: string, fileStem: string) {
    const refs = pseudoQuery.getReferences(this.db, methodName, fileStem);
    return refs.map((r: any) => ({
      file: r.filePath,
      callerMethod: r.methodName,
      sourceLine: r.line ?? null,
    }));
  }

  getCallGraph() {
    return pseudoQuery.getCallGraph(this.db);
  }

  getExports() {
    const rows = this.db
      .query(
        `SELECT f.file_path AS file_path, m.name AS name,
                COALESCE(GROUP_CONCAT(ms.content, ' '), '') AS step_summary
         FROM methods m
         JOIN files f ON f.file_path = m.file_path
         LEFT JOIN method_steps ms ON ms.method_id = m.id
         WHERE m.is_exported = 1
         GROUP BY m.id
         ORDER BY f.file_path, m.name`,
      )
      .all() as Array<{ file_path: string; name: string; step_summary: string }>;
    return rows.map((r) => ({
      filePath: r.file_path,
      methodName: r.name,
      stepSummary: r.step_summary,
    }));
  }

  getFilesByDirectory(dir: string) {
    return pseudoQuery.getFilesByDirectory(this.db, dir);
  }

  getImpactAnalysis(methodName: string, fileStem: string) {
    return pseudoQuery.getImpactAnalysis(this.db, methodName, fileStem);
  }

  // Requires resolveCallEdges to have run; otherwise all methods appear orphan.
  getOrphanFunctions() {
    const rows = this.db
      .query(
        `SELECT m.file_path AS file_path, m.name AS name
         FROM methods m
         LEFT JOIN method_calls mc ON mc.callee_method_id = m.id
         WHERE m.is_exported = 0 AND mc.id IS NULL
         ORDER BY m.file_path, m.name`,
      )
      .all() as Array<{ file_path: string; name: string }>;
    return rows.map((r) => ({ filePath: r.file_path, methodName: r.name }));
  }

  getStaleFunctions(_daysThreshold: number) {
    return [] as Array<{ filePath: string; methodName: string; lastUpdated: string | null }>;
  }

  getStats() {
    return pseudoQuery.getStats(this.db);
  }

  getCoverage(directory?: string) {
    if (directory) {
      const rootDir = isAbsolute(directory) ? directory : join(this.project, directory);
      return pseudoQuery.getCoverage(this.db, rootDir);
    }
    return pseudoQuery.getCoverage(this.db, this.project);
  }

  getSourceLink(name: string, hintFileStem?: string) {
    return pseudoQuery.getSourceLink(this.db, name, hintFileStem);
  }

  getFunctionsForSource(sourceFilePath: string) {
    return pseudoQuery.getFunctionsForSource(this.db, sourceFilePath);
  }

  getMethodLocation(filePath: string, methodName: string) {
    const row = this.db
      .query(
        `SELECT start_line, file_path FROM methods
         WHERE file_path = ? AND name = ? LIMIT 1`,
      )
      .get(filePath, methodName) as { start_line: number | null; file_path: string } | undefined;
    if (!row) return null;
    return {
      sourceLine: row.start_line ?? null,
      sourceFilePath: row.file_path ?? null,
    };
  }

  close(): void {
    shimInstances.delete(this.project);
    void this.handle.dispose().catch(() => {});
  }
}

export function getPseudoDb(project: string): PseudoDbV6Shim {
  const cached = shimInstances.get(project);
  if (cached) return cached;
  const handle = initPseudoDbV6(project);
  const shim = new PseudoDbV6Shim(project, handle);
  shimInstances.set(project, shim);
  return shim;
}

// ============================================================================
// V6 in-memory factory (additive — does not replace getPseudoDb)
// ============================================================================

import { join as joinV6 } from 'node:path';
import { createHash as createHashV6 } from 'node:crypto';
import { promises as fspV6 } from 'node:fs';
import { spawn as spawnV6 } from 'node:child_process';
import { createSchema as createSchemaV6 } from './pseudo-schema.js';
import {
  validateSnapshot as validateSnapshotV6,
  loadSnapshot as loadSnapshotV6,
} from './pseudo-snapshot.js';
import { createPseudoIndexer, type PseudoIndexer } from './pseudo-indexer.js';
import { createDriftChecker, type DriftChecker } from './pseudo-drift.js';
import { createPseudoWatcher, type PseudoWatcher } from './pseudo-watcher.js';
import {
  runMigrationFromV1 as runMigrationFromV1V6,
  migrateProseFilesToRelative as migrateProseFilesToRelativeV6,
} from './pseudo-migration.js';

/**
 * Best-effort probe of the project to collect real inputs for validateSnapshotV6.
 * Uses `git ls-files` to count tracked files and picks up to 5 random file paths,
 * computing the sha1 of their current bytes. If git is unavailable or fails, we
 * return {count: 0, samples: new Map()} which causes validation to cold-fail
 * (forcing a full cold-scan). This fallback is intentional — a missing git
 * environment should not crash startup, merely skip the snapshot shortcut.
 */
async function probeSnapshotInputsV6(
  project: string,
): Promise<{ count: number; samples: Map<string, string> }> {
  return new Promise((resolve) => {
    try {
      const proc = spawnV6('git', ['ls-files', '-z'], { cwd: project });
      const chunks: Buffer[] = [];
      let errored = false;
      proc.stdout.on('data', (c: Buffer) => chunks.push(c));
      proc.on('error', () => {
        errored = true;
        resolve({ count: 0, samples: new Map() });
      });
      proc.on('close', async (code) => {
        if (errored) return;
        if (code !== 0) {
          resolve({ count: 0, samples: new Map() });
          return;
        }
        try {
          const out = Buffer.concat(chunks).toString('utf8');
          const rels = out.split('\0').filter((s) => s.length > 0);
          const count = rels.length;
          if (count === 0) {
            resolve({ count: 0, samples: new Map() });
            return;
          }
          // Pick up to 5 random tracked files.
          const pool = rels.slice();
          const picks: string[] = [];
          const n = Math.min(5, pool.length);
          for (let i = 0; i < n; i++) {
            const j = Math.floor(Math.random() * pool.length);
            picks.push(pool[j]);
            pool.splice(j, 1);
          }
          const samples = new Map<string, string>();
          for (const rel of picks) {
            const abs = joinV6(project, rel);
            try {
              const buf = await fspV6.readFile(abs);
              const hash = createHashV6('sha1').update(buf).digest('hex');
              samples.set(abs, hash);
            } catch {
              // Skip unreadable sample — validator simply checks fewer entries.
            }
          }
          resolve({ count, samples });
        } catch {
          resolve({ count: 0, samples: new Map() });
        }
      });
    } catch {
      resolve({ count: 0, samples: new Map() });
    }
  });
}

const V6_FAILURE_BACKOFF_MS = 5 * 60 * 1000;

export type PseudoDbV6Status =
  | 'init'
  | 'warm-loading'
  | 'warm-loaded'
  | 'cold-scanning'
  | 'ready'
  | 'failed';

export interface PseudoDbV6Handle {
  readonly project: string;
  readonly db: Database;
  readonly indexer: PseudoIndexer;
  readonly drift: DriftChecker | null;
  readonly watcher: PseudoWatcher | null;
  readonly ready: Promise<void>;
  status(): PseudoDbV6Status;
  lastError(): Error | null;
  retryScan(): Promise<void>;
  dispose(): Promise<void>;
}

interface V6Internal extends Omit<PseudoDbV6Handle, 'ready'> {
  ready: Promise<void>;
  _state: PseudoDbV6Status;
  _lastError: Error | null;
  _lastFailureAt: number;
  _scanInFlight: Promise<void> | null;
  _disposed: boolean;
}

const v6Instances = new Map<string, V6Internal>();

export function initPseudoDbV6(project: string, opts?: {
  attachWatcher?: boolean;
  attachDrift?: boolean;
}): PseudoDbV6Handle {
  const existing = v6Instances.get(project);
  if (existing && !existing._disposed) return existing;

  const attachWatcher = opts?.attachWatcher ?? true;
  const attachDrift = opts?.attachDrift ?? true;

  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys=ON');

  // B2: If a legacy v1 db exists, kick off migration before creating the v6
  // schema so prose files are written to disk early. runMigrationFromV1 is
  // a no-op if migration has already run or no legacy db is present. We
  // retain the resulting promise on the handle so `ready` can await it before
  // the initial scan picks up the migrated prose files. Failures are logged
  // and swallowed — v6 still cold-scans to populate its own tables.
  const migrationPromise: Promise<void> = (async () => {
    try {
      const report = await runMigrationFromV1V6(project);
      if (report.migrated > 0 || report.errors.length > 0) {
        console.error(
          `[pseudo-db-v6] migration report: migrated=${report.migrated} skipped=${report.skipped} errors=${report.errors.length}`,
        );
      }
    } catch (err) {
      console.warn('[pseudo-db-v6] migration failed:', err);
    }
    // Wave 2: rewrite prose files with absolute paths to project-relative paths.
    // Idempotent via .migrated-rel sentinel. Must run before first indexer scan
    // so the scan picks up the rewritten paths.
    try {
      const relReport = await migrateProseFilesToRelativeV6(project);
      if (relReport.migrated > 0 || relReport.orphaned > 0 || relReport.errors.length > 0) {
        console.error(
          `[pseudo-db-v6] rel-path migration report: migrated=${relReport.migrated} orphaned=${relReport.orphaned} skipped=${relReport.skipped} failed=${relReport.failed} errors=${relReport.errors.length}`,
        );
      }
    } catch (err) {
      console.warn('[pseudo-db-v6] rel-path migration failed:', err);
    }
  })();

  createSchemaV6(db);

  const indexer = createPseudoIndexer(project, db);

  let driftChecker: DriftChecker | null = null;
  let watcher: PseudoWatcher | null = null;
  if (attachDrift) {
    try {
      driftChecker = createDriftChecker(project, db, indexer);
    } catch (err) {
      console.warn('[pseudo-db-v6] drift checker attach failed:', err);
    }
  }
  if (attachWatcher) {
    try {
      watcher = createPseudoWatcher(project, indexer);
    } catch (err) {
      console.warn('[pseudo-db-v6] watcher attach failed:', err);
    }
  }

  // C1: Actually start the drift checker and watcher. createX() only wires them
  // up; without start() the timers/file-watchers are never armed. Start failures
  // are logged but do not block init — the handle still returns so queries work.
  if (driftChecker) {
    try {
      driftChecker.start();
    } catch (err) {
      console.warn('[pseudo-db-v6] drift checker start failed:', err);
    }
  }
  if (watcher) {
    // start() is async but we intentionally do not await here — watcher
    // initialization (chokidar import + initial scan) can take a moment and
    // we want init to return promptly. Errors are logged.
    void watcher.start().catch((err) => {
      console.warn('[pseudo-db-v6] watcher start failed:', err);
    });
  }

  const handle: V6Internal = {
    project,
    db,
    indexer,
    drift: driftChecker,
    watcher,
    ready: Promise.resolve(),
    _state: 'init',
    _lastError: null,
    _lastFailureAt: 0,
    _scanInFlight: null,
    _disposed: false,
    status() { return this._state; },
    lastError() { return this._lastError; },
    async retryScan() {
      if (this._disposed) return;
      const sinceFailure = Date.now() - this._lastFailureAt;
      if (this._lastError && sinceFailure < V6_FAILURE_BACKOFF_MS) return;
      if (this._scanInFlight) return this._scanInFlight;
      this._scanInFlight = (async () => {
        try {
          this._state = 'cold-scanning';
          await indexer.runFullScan({ trigger: 'manual' });
          this._state = 'ready';
          this._lastError = null;
        } catch (err) {
          this._state = 'failed';
          this._lastError = err instanceof Error ? err : new Error(String(err));
          this._lastFailureAt = Date.now();
        } finally {
          this._scanInFlight = null;
        }
      })();
      return this._scanInFlight;
    },
    async dispose() {
      if (this._disposed) return;
      this._disposed = true;
      try { await this.watcher?.stop(); } catch {}
      // I1: drift.stop() is synchronous but best-effort — internal timers
      // (periodic setInterval + idle setTimeout) are cleared, and any in-flight
      // checkNow() is guarded by drift's own `scanActive` flag so a new call
      // cannot start. Awaiting here is a no-op on a sync return but harmless
      // and future-proofs the contract. There is no mechanism to synchronously
      // await an in-flight idle hash_sample call; it completes against the
      // still-open db and any write-after-close is caught by the try/catch
      // inside drift. Documented as best-effort cleanup.
      try { await this.drift?.stop(); } catch {}
      try { indexer.cancel(); } catch {}
      if (this._scanInFlight) {
        try { await this._scanInFlight; } catch {}
      }
      try { db.close(); } catch {}
      v6Instances.delete(project);
    },
  };

  handle.ready = (async () => {
    // B2: ensure any legacy-v1 migration has finished writing prose files
    // before the initial scan starts, so migrated prose is picked up.
    try { await migrationPromise; } catch {}

    handle._state = 'warm-loading';
    const snapPath = joinV6(project, '.collab', 'pseudo', 'cache', 'derived.sqlite');
    let warmLoaded = false;
    try {
      // C3: use a real git-ls-files probe instead of placeholder args so the
      // snapshot validator actually gets meaningful file_count + sample_hash
      // inputs. If git is unavailable the probe returns empty inputs and
      // validation cold-fails — which forces a full cold-scan. See
      // probeSnapshotInputsV6 for the documented fallback.
      const probe = await probeSnapshotInputsV6(project);
      const validation = await validateSnapshotV6(snapPath, probe.count, probe.samples);
      if (validation.valid) {
        await loadSnapshotV6(db, snapPath);
        warmLoaded = true;
        handle._state = 'warm-loaded';
      }
    } catch (err) {
      handle._lastError = err instanceof Error ? err : new Error(String(err));
    }

    // C2: capture the inner scan promise locally and await it before the
    // outer IIFE resolves. Previously the outer IIFE returned immediately
    // after kicking off the scan, so `handle.ready` resolved before the DB
    // was populated. Consumers awaiting `ready` would query an empty DB.
    const scanPromise = (async () => {
      try {
        if (!warmLoaded) {
          handle._state = 'cold-scanning';
        }
        await indexer.runFullScan({
          trigger: warmLoaded ? 'auto' : 'sessionstart',
        });
        handle._state = 'ready';
        handle._lastError = null;
      } catch (err) {
        handle._state = 'failed';
        handle._lastError = err instanceof Error ? err : new Error(String(err));
        handle._lastFailureAt = Date.now();
      } finally {
        handle._scanInFlight = null;
      }
    })();
    handle._scanInFlight = scanPromise;
    await scanPromise;
  })();

  v6Instances.set(project, handle);
  return handle;
}

export async function disposeAllPseudoDbV6(): Promise<void> {
  const handles = Array.from(v6Instances.values());
  await Promise.all(handles.map(h => h.dispose().catch(() => {})));
  v6Instances.clear();
}

export function _v6InstanceCount(): number {
  return v6Instances.size;
}
