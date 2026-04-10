/**
 * Pseudo DB Service
 *
 * SQLite database for indexed pseudocode files.
 * Supports full-text search, call graph analysis, and impact analysis.
 *
 * Stored at {project}/.collab/pseudo/pseudo.db (gitignored)
 */

import Database from 'bun:sqlite';
import { join, relative, isAbsolute, extname } from 'path';
import { existsSync, mkdirSync, readdirSync } from 'fs';

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

// ---- v2 types (two-level indexing) ----

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

export interface FileState {
  methods: Array<{
    name: string;
    params: string;
    sourceHash: string | null;
    hasSteps: boolean;
  }>;
  proseUpdatedAt: string | null;
  hasProse: boolean;
}

// ============================================================================
// Schema (v2)
// ============================================================================

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  file_stem TEXT NOT NULL DEFAULT '',
  language TEXT,
  source_mtime TEXT,
  source_hash TEXT,
  line_count INTEGER,
  title TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  structural_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  prose_updated_at TEXT,
  has_prose INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '',
  return_type TEXT NOT NULL DEFAULT '',
  is_exported INTEGER NOT NULL DEFAULT 0,
  date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT,
  is_async INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  source_line INTEGER,
  source_line_end INTEGER,
  param_count INTEGER NOT NULL DEFAULT 0,
  step_count INTEGER NOT NULL DEFAULT 0,
  owning_symbol TEXT
);

CREATE TABLE IF NOT EXISTS method_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(method_id, sort_order)
);

CREATE TABLE IF NOT EXISTS method_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  callee_name TEXT NOT NULL,
  callee_file_stem TEXT NOT NULL,
  callee_method_id INTEGER REFERENCES methods(id) ON DELETE SET NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS pseudo_fts USING fts5(
  method_name,
  step_content,
  title,
  purpose,
  module_context,
  params,
  content='',
  contentless_delete=1,
  tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_stem ON files(file_stem);
CREATE INDEX IF NOT EXISTS idx_methods_file ON methods(file_id);
CREATE INDEX IF NOT EXISTS idx_methods_name ON methods(name);
CREATE INDEX IF NOT EXISTS idx_method_steps_method ON method_steps(method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee ON method_calls(callee_name);
CREATE INDEX IF NOT EXISTS idx_method_calls_caller ON method_calls(caller_method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_stem ON method_calls(callee_file_stem, callee_name);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee_id ON method_calls(callee_method_id);
`;

// Source-tree walk config (for getCoverage)
const COVERAGE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py',
  '.cs',
  '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh',
  '.go',
  '.rs',
]);

const COVERAGE_EXCLUDES = new Set([
  'node_modules', '.git', '.collab', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '.cache', '__pycache__',
]);

function isCoverageTestFile(name: string): boolean {
  return (
    name.includes('.test.') ||
    name.includes('.spec.') ||
    name.endsWith('.d.ts')
  );
}

// ============================================================================
// Service
// ============================================================================

class PseudoDbService {
  private db: Database;
  private project: string;
  public needsInitialScan: boolean = false;

  constructor(project: string) {
    this.project = project;

    const dbDir = join(project, '.collab', 'pseudo');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(join(dbDir, 'pseudo.db'));
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');

    this.migrate();
  }

  private migrate(): void {
    let currentVersion = 0;
    try {
      const row = this.db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any;
      if (row && typeof row.version === 'number') {
        currentVersion = row.version;
      }
    } catch {
      currentVersion = 0;
    }

    if (currentVersion >= SCHEMA_VERSION) {
      this.db.exec(SCHEMA);
      this.needsInitialScan = false;
      return;
    }

    console.log(`[pseudo-db] migrating from v${currentVersion} → v${SCHEMA_VERSION}`);
    this.db.exec(`
      DROP TABLE IF EXISTS pseudo_fts;
      DROP TABLE IF EXISTS method_calls;
      DROP TABLE IF EXISTS method_steps;
      DROP TABLE IF EXISTS methods;
      DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS schema_version;
    `);
    this.db.exec(SCHEMA);
    // Use INSERT OR REPLACE to guarantee the row is written even if a prior
    // partial migration left a stale row behind. This ensures subsequent opens
    // read version=SCHEMA_VERSION and skip migration.
    this.db.prepare('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)').run(SCHEMA_VERSION);
    this.needsInitialScan = true;
  }

  /**
   * Level 1 — upsert structural metadata for a source file.
   * Preserves existing prose (method_steps, method_calls, title, purpose, module_context).
   * Deletes methods that are no longer in the source (matched by name+params).
   */
  upsertStructural(filePath: string, language: string, scan: ScanResult): void {
    const tx = this.db.transaction(() => {
      const fileStem = this.deriveFileStem(filePath);

      // Upsert file row
      const existing = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as { id: number } | undefined;
      let fileId: number;
      if (existing) {
        this.db.prepare(`
          UPDATE files
          SET file_stem = ?, language = ?, source_hash = ?, line_count = ?,
              source_mtime = datetime('now'), structural_indexed_at = datetime('now')
          WHERE id = ?
        `).run(fileStem, language, scan.sourceHash, scan.lineCount, existing.id);
        fileId = existing.id;
      } else {
        const result = this.db.prepare(`
          INSERT INTO files (file_path, file_stem, language, source_hash, line_count, source_mtime, structural_indexed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(filePath, fileStem, language, scan.sourceHash, scan.lineCount);
        fileId = Number(result.lastInsertRowid);
      }

      // Load existing methods for this file
      const existingMethods = this.db.prepare(
        'SELECT id, name, params FROM methods WHERE file_id = ?'
      ).all(fileId) as Array<{ id: number; name: string; params: string }>;

      const existingByKey = new Map<string, number>();
      for (const m of existingMethods) {
        existingByKey.set(`${m.name}||${m.params}`, m.id);
      }

      const seenKeys = new Set<string>();

      // Upsert each method from the scan
      for (let i = 0; i < scan.methods.length; i++) {
        const sm = scan.methods[i];
        const key = `${sm.name}||${sm.params}`;
        seenKeys.add(key);

        const existingId = existingByKey.get(key);
        if (existingId != null) {
          // Update structural fields, preserve date/step_count
          this.db.prepare(`
            UPDATE methods
            SET return_type = ?, is_exported = ?, visibility = ?, is_async = ?,
                kind = ?, source_line = ?, source_line_end = ?,
                param_count = ?, owning_symbol = ?, sort_order = ?
            WHERE id = ?
          `).run(
            sm.returnType,
            sm.isExported ? 1 : 0,
            sm.visibility,
            sm.isAsync ? 1 : 0,
            sm.kind,
            sm.sourceLine,
            sm.sourceLineEnd,
            sm.paramCount,
            sm.owningSymbol,
            i,
            existingId,
          );
        } else {
          // Insert new method row
          this.db.prepare(`
            INSERT INTO methods
            (file_id, name, params, return_type, is_exported, sort_order, visibility,
             is_async, kind, source_line, source_line_end, param_count, step_count, owning_symbol)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
          `).run(
            fileId,
            sm.name,
            sm.params,
            sm.returnType,
            sm.isExported ? 1 : 0,
            i,
            sm.visibility,
            sm.isAsync ? 1 : 0,
            sm.kind,
            sm.sourceLine,
            sm.sourceLineEnd,
            sm.paramCount,
            sm.owningSymbol,
          );
        }
      }

      // Delete methods that are no longer in the scan
      for (const [key, id] of existingByKey) {
        if (!seenKeys.has(key)) {
          // Delete FTS entry first (contentless_delete=1 allows standard DELETE)
          this.db.prepare('DELETE FROM pseudo_fts WHERE rowid = ?').run(id);
          this.db.prepare('DELETE FROM methods WHERE id = ?').run(id);
        }
      }
    });
    tx();
  }

  /**
   * Level 2 — upsert prose (title/purpose/module_context + method steps and calls).
   * Preserves structural fields. Matches methods by name + params.
   */
  upsertProse(filePath: string, data: ProseData): void {
    const tx = this.db.transaction(() => {
      const fileRow = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as { id: number } | undefined;
      if (!fileRow) {
        console.warn(`[pseudo-db] upsertProse: file not found: ${filePath}`);
        return;
      }
      const fileId = fileRow.id;

      // Update file-level prose fields (title/purpose/moduleContext are
      // always safe to refresh, even if no methods match).
      this.db.prepare(`
        UPDATE files
        SET title = ?, purpose = ?, module_context = ?
        WHERE id = ?
      `).run(
        data.title ?? '',
        data.purpose ?? '',
        data.moduleContext ?? '',
        fileId,
      );

      // Load existing methods
      const existingMethods = this.db.prepare(
        'SELECT id, name, params FROM methods WHERE file_id = ?'
      ).all(fileId) as Array<{ id: number; name: string; params: string }>;

      // Match each prose method and update
      let matchCount = 0;
      for (const pm of data.methods) {
        let methodId: number | null = null;
        if (pm.params != null) {
          const exact = existingMethods.find(m => m.name === pm.name && m.params === pm.params);
          if (exact) methodId = exact.id;
        } else {
          const byNameMatches = existingMethods.filter(m => m.name === pm.name);
          if (byNameMatches.length === 0) {
            console.warn(
              `[pseudo-db] upsertProse: method not found: ${pm.name}() in ${filePath}`,
            );
            continue;
          } else if (byNameMatches.length === 1) {
            methodId = byNameMatches[0].id;
          } else {
            console.warn(
              `[pseudo-db] upsertProse: method name "${pm.name}" has ${byNameMatches.length} overloads in ${filePath}; supply \`params\` to disambiguate. Skipping.`,
            );
            continue;
          }
        }
        if (methodId == null) {
          console.warn(`[pseudo-db] upsertProse: method not found: ${pm.name}(${pm.params ?? ''}) in ${filePath}`);
          continue;
        }
        matchCount++;

        // Clear existing steps and calls
        this.db.prepare('DELETE FROM method_steps WHERE method_id = ?').run(methodId);
        this.db.prepare('DELETE FROM method_calls WHERE caller_method_id = ?').run(methodId);

        // Insert new steps
        for (let i = 0; i < pm.steps.length; i++) {
          const s = pm.steps[i];
          this.db.prepare(
            'INSERT INTO method_steps (method_id, content, depth, sort_order) VALUES (?, ?, ?, ?)'
          ).run(methodId, s.content, s.depth, i);
        }

        // Insert new calls
        for (const c of pm.calls) {
          this.db.prepare(
            'INSERT INTO method_calls (caller_method_id, callee_name, callee_file_stem) VALUES (?, ?, ?)'
          ).run(methodId, c.name, c.fileStem);
        }

        // Update step_count
        this.db.prepare('UPDATE methods SET step_count = ? WHERE id = ?').run(pm.steps.length, methodId);

        // Refresh FTS entry for this method (contentless_delete=1 allows standard DELETE)
        const joinedSteps = pm.steps.map(s => s.content).join(' ');
        this.db.prepare('DELETE FROM pseudo_fts WHERE rowid = ?').run(methodId);
        const methodRow = this.db.prepare('SELECT name, params FROM methods WHERE id = ?').get(methodId) as any;
        this.db.prepare(
          `INSERT INTO pseudo_fts (rowid, method_name, step_content, title, purpose, module_context, params)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          methodId,
          methodRow.name,
          joinedSteps,
          data.title ?? '',
          data.purpose ?? '',
          data.moduleContext ?? '',
          methodRow.params,
        );
      }

      // Only flag the file as having prose if at least one method matched.
      // If data.methods is empty, this is a "refresh file-level fields only"
      // call — preserve existing has_prose / prose_updated_at state.
      if (data.methods.length > 0) {
        if (matchCount > 0) {
          this.db.prepare(`
            UPDATE files
            SET has_prose = 1, prose_updated_at = datetime('now')
            WHERE id = ?
          `).run(fileId);
        } else {
          console.warn(
            `[pseudo-db] upsertProse: no methods matched in ${filePath} (${data.methods.length} prose methods, ${existingMethods.length} existing); has_prose not set.`,
          );
        }
      }

      // Re-resolve call graph edges
      this.resolveCalleesForFile(fileId);
    });
    tx();
  }

  /**
   * Level 1 complement — delete a file's entire db row (cascades to methods/steps/calls).
   */
  deleteStructural(filePath: string): void {
    this.clearFtsForFilePath(filePath);
    this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);
  }

  /**
   * Read current file state — used by the /pseudocode skill to decide what to regenerate.
   */
  getFileState(filePath: string): FileState | null {
    const fileRow = this.db.prepare(
      'SELECT id, source_hash, prose_updated_at, has_prose FROM files WHERE file_path = ?'
    ).get(filePath) as any;
    if (!fileRow) return null;

    const methodRows = this.db.prepare(`
      SELECT m.name, m.params, m.step_count
      FROM methods m
      WHERE m.file_id = ?
      ORDER BY m.sort_order
    `).all(fileRow.id) as Array<{ name: string; params: string; step_count: number }>;

    return {
      methods: methodRows.map(r => ({
        name: r.name,
        params: r.params,
        sourceHash: fileRow.source_hash,
        hasSteps: r.step_count > 0,
      })),
      proseUpdatedAt: fileRow.prose_updated_at,
      hasProse: fileRow.has_prose === 1,
    };
  }

  /**
   * Checkpoint the WAL into the main db file. Used by pre-commit hook before staging the db.
   */
  checkpointWal(): void {
    this.db.exec('PRAGMA wal_checkpoint(FULL)');
  }

  private deriveFileStem(filePath: string): string {
    const base = filePath.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  }

  private resolveCalleesForFile(fileId: number): void {
    // The file_stem of the file we just inserted
    const fileRow = this.db.prepare('SELECT file_stem FROM files WHERE id = ?').get(fileId) as any;
    if (!fileRow) return;
    const fileStem = fileRow.file_stem as string;

    // Forward: resolve outbound calls from methods in this file
    this.db.prepare(`
      UPDATE method_calls
      SET callee_method_id = (
        SELECT m.id FROM methods m
        JOIN files f ON f.id = m.file_id
        WHERE f.file_stem = method_calls.callee_file_stem
          AND m.name = method_calls.callee_name
        LIMIT 1
      )
      WHERE caller_method_id IN (SELECT id FROM methods WHERE file_id = ?)
    `).run(fileId);

    // Backward: resolve previously-unresolved calls that now point to this file
    this.db.prepare(`
      UPDATE method_calls
      SET callee_method_id = (
        SELECT m.id FROM methods m
        WHERE m.file_id = ?
          AND m.name = method_calls.callee_name
        LIMIT 1
      )
      WHERE callee_method_id IS NULL
        AND callee_file_stem = ?
    `).run(fileId, fileStem);
  }

  private clearFtsForFilePath(filePath: string): void {
    const existingFile = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as any;
    if (!existingFile) return;
    const existingMethods = this.db.prepare(
      'SELECT id FROM methods WHERE file_id = ?'
    ).all(existingFile.id) as Array<{ id: number }>;
    for (const m of existingMethods) {
      // contentless_delete=1 allows standard DELETE
      this.db.prepare('DELETE FROM pseudo_fts WHERE rowid = ?').run(m.id);
    }
  }

  listFiles(): PseudoFileSummary[] {
    const rows = this.db.prepare(`
      SELECT f.file_path, f.title, f.structural_indexed_at,
        COUNT(m.id) as methodCount,
        SUM(CASE WHEN m.is_exported = 1 THEN 1 ELSE 0 END) as exportCount
      FROM files f
      LEFT JOIN methods m ON m.file_id = f.id
      GROUP BY f.id
    `).all() as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      title: r.title,
      methodCount: r.methodCount,
      exportCount: r.exportCount ?? 0,
      lastUpdated: r.structural_indexed_at,
    }));
  }

  getFileByStem(stem: string): PseudoFileWithMethods | null {
    const file = this.db.prepare('SELECT * FROM files WHERE file_stem = ?').get(stem) as any;
    if (!file) return null;
    return this.getFile(file.file_path);
  }

  getFile(filePath: string): PseudoFileWithMethods | null {
    // Single-query fetch using json_group_array (replaces N+1)
    const row = this.db.prepare(`
      SELECT
        f.file_path, f.title, f.purpose, f.module_context, f.prose_updated_at,
        f.has_prose, f.structural_indexed_at, f.language,
        (
          SELECT COALESCE(json_group_array(json_object(
            'name', m.name,
            'params', m.params,
            'return_type', m.return_type,
            'is_exported', m.is_exported,
            'date', m.date,
            'visibility', m.visibility,
            'is_async', m.is_async,
            'kind', m.kind,
            'source_line', m.source_line,
            'source_line_end', m.source_line_end,
            'param_count', m.param_count,
            'step_count', m.step_count,
            'owning_symbol', m.owning_symbol,
            'steps_json', (
              SELECT COALESCE(json_group_array(json_object('content', ms.content, 'depth', ms.depth)), '[]')
              FROM (
                SELECT content, depth FROM method_steps
                WHERE method_id = m.id ORDER BY sort_order
              ) AS ms
            ),
            'calls_json', (
              SELECT COALESCE(json_group_array(json_object('name', mc.callee_name, 'fileStem', mc.callee_file_stem)), '[]')
              FROM method_calls mc WHERE mc.caller_method_id = m.id
            )
          )), '[]')
          FROM (SELECT * FROM methods WHERE file_id = f.id ORDER BY sort_order) AS m
        ) AS methods_json
      FROM files f
      WHERE f.file_path = ?
    `).get(filePath) as any;

    if (!row) return null;

    const rawMethods = JSON.parse(row.methods_json ?? '[]') as any[];
    const methods: PseudoMethodWithMeta[] = rawMethods.map(m => ({
      name: m.name,
      params: m.params,
      returnType: m.return_type,
      isExported: m.is_exported === 1,
      date: m.date,
      visibility: m.visibility,
      isAsync: m.is_async === 1,
      kind: m.kind,
      sourceLine: m.source_line,
      sourceLineEnd: m.source_line_end,
      paramCount: m.param_count ?? 0,
      stepCount: m.step_count ?? 0,
      owningSymbol: m.owning_symbol,
      steps: Array.isArray(m.steps_json) ? m.steps_json : (m.steps_json ? JSON.parse(m.steps_json) : []),
      calls: Array.isArray(m.calls_json) ? m.calls_json : (m.calls_json ? JSON.parse(m.calls_json) : []),
    }));

    return {
      filePath: row.file_path,
      title: row.title,
      purpose: row.purpose,
      moduleContext: row.module_context,
      proseUpdatedAt: row.prose_updated_at,
      hasProse: row.has_prose === 1,
      structuralIndexedAt: row.structural_indexed_at,
      language: row.language,
      methods,
    };
  }

  search(query: string): SearchResult[] {
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';

    const ftsRows = this.db.prepare(`
      SELECT rowid, method_name,
        snippet(pseudo_fts, 1, '<mark>', '</mark>', '...', 30) as snippet,
        bm25(pseudo_fts) as rank
      FROM pseudo_fts
      WHERE pseudo_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).all(safeQuery) as any[];

    if (ftsRows.length === 0) return [];

    return ftsRows.map(row => {
      const method = this.db.prepare(
        'SELECT m.name, f.file_path FROM methods m JOIN files f ON f.id = m.file_id WHERE m.id = ?'
      ).get(row.rowid) as any;

      return {
        filePath: method?.file_path ?? '',
        methodName: method?.name ?? '',
        snippet: row.snippet,
        rank: row.rank,
      };
    }).filter(r => r.filePath !== '');
  }

  getReferences(methodName: string, fileStem: string): Array<{ file: string; callerMethod: string; sourceLine: number | null }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name, m.source_line
      FROM method_calls mc
      JOIN methods m ON m.id = mc.caller_method_id
      JOIN files f ON f.id = m.file_id
      WHERE mc.callee_name = ? AND mc.callee_file_stem = ?
    `).all(methodName, fileStem) as any[];

    return rows.map(r => ({
      file: r.file_path,
      callerMethod: r.name,
      sourceLine: r.source_line ?? null,
    }));
  }

  getCallGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const methodRows = this.db.prepare(`
      SELECT m.id, m.name, m.is_exported, f.file_path
      FROM methods m
      JOIN files f ON f.id = m.file_id
    `).all() as any[];

    const nodes: GraphNode[] = methodRows.map(r => ({
      id: `${r.file_path}::${r.name}`,
      label: r.name,
      type: 'method' as const,
      filePath: r.file_path,
      isExported: r.is_exported === 1,
    }));

    // Use resolved callee_method_id — no more stem-string join bug
    const callRows = this.db.prepare(`
      SELECT
        caller.name AS caller_name,
        f_caller.file_path AS caller_file,
        callee.name AS callee_name,
        f_callee.file_path AS callee_file
      FROM method_calls mc
      JOIN methods caller ON caller.id = mc.caller_method_id
      JOIN files f_caller ON f_caller.id = caller.file_id
      JOIN methods callee ON callee.id = mc.callee_method_id
      JOIN files f_callee ON f_callee.id = callee.file_id
    `).all() as any[];

    const edges: GraphEdge[] = callRows.map(r => ({
      source: `${r.caller_file}::${r.caller_name}`,
      target: `${r.callee_file}::${r.callee_name}`,
    }));

    return { nodes, edges };
  }

  getExports(): Array<{ filePath: string; methodName: string; stepSummary: string }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name, COALESCE(GROUP_CONCAT(ms.content, ' '), '') as step_summary
      FROM methods m
      JOIN files f ON f.id = m.file_id
      LEFT JOIN method_steps ms ON ms.method_id = m.id
      WHERE m.is_exported = 1
      GROUP BY m.id
    `).all() as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      methodName: r.name,
      stepSummary: r.step_summary ?? '',
    }));
  }

  getFilesByDirectory(dir: string): PseudoFileSummary[] {
    const rows = this.db.prepare(`
      SELECT f.file_path, f.title, f.structural_indexed_at,
        COUNT(m.id) as methodCount,
        SUM(CASE WHEN m.is_exported = 1 THEN 1 ELSE 0 END) as exportCount
      FROM files f
      LEFT JOIN methods m ON m.file_id = f.id
      WHERE f.file_path LIKE ? || '%'
      GROUP BY f.id
    `).all(dir) as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      title: r.title,
      methodCount: r.methodCount,
      exportCount: r.exportCount ?? 0,
      lastUpdated: r.structural_indexed_at,
    }));
  }

  getImpactAnalysis(methodName: string, fileStem: string): { direct: AffectedItem[]; transitive: AffectedItem[] } {
    // id-based recursive CTE — simpler and correct across stem collisions
    const rows = this.db.prepare(`
      WITH RECURSIVE impact(method_id, depth) AS (
        SELECT mc.caller_method_id, 1
        FROM method_calls mc
        JOIN methods m ON m.id = mc.callee_method_id
        JOIN files f ON f.id = m.file_id
        WHERE m.name = ? AND f.file_stem = ?

        UNION

        SELECT mc2.caller_method_id, impact.depth + 1
        FROM impact
        JOIN method_calls mc2 ON mc2.callee_method_id = impact.method_id
        WHERE impact.depth < 10
      )
      SELECT m.name AS caller_name, f.file_path AS caller_file, MIN(impact.depth) AS depth
      FROM impact
      JOIN methods m ON m.id = impact.method_id
      JOIN files f ON f.id = m.file_id
      GROUP BY m.id
      ORDER BY depth
    `).all(methodName, fileStem) as any[];

    const direct: AffectedItem[] = [];
    const transitive: AffectedItem[] = [];

    for (const r of rows) {
      const item: AffectedItem = {
        filePath: r.caller_file,
        methodName: r.caller_name,
        depth: r.depth,
      };
      if (r.depth === 1) {
        direct.push(item);
      } else {
        transitive.push(item);
      }
    }

    return { direct, transitive };
  }

  getOrphanFunctions(): Array<{ filePath: string; methodName: string }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name
      FROM methods m
      JOIN files f ON f.id = m.file_id
      LEFT JOIN method_calls mc
        ON mc.callee_method_id = m.id
      WHERE m.is_exported = 0 AND mc.id IS NULL
    `).all() as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      methodName: r.name,
    }));
  }

  getStaleFunctions(daysThreshold: number): Array<{ filePath: string; methodName: string; lastUpdated: string }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name, m.date
      FROM methods m
      JOIN files f ON f.id = m.file_id
      WHERE m.date IS NOT NULL
        AND m.date < date('now', '-' || ? || ' days')
    `).all(daysThreshold) as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      methodName: r.name,
      lastUpdated: r.date,
    }));
  }

  getStats(): StatsReport {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM files) AS fileCount,
        (SELECT COUNT(*) FROM methods) AS methodCount,
        (SELECT COUNT(*) FROM methods WHERE is_exported = 1) AS exportCount
    `).get() as any;

    return {
      fileCount: row?.fileCount ?? 0,
      methodCount: row?.methodCount ?? 0,
      exportCount: row?.exportCount ?? 0,
    };
  }

  getCoverage(directory?: string): CoverageReport {
    // Walk the source tree and compare against indexed file_path
    const rootDir = directory
      ? (isAbsolute(directory) ? directory : join(this.project, directory))
      : this.project;

    if (!existsSync(rootDir)) {
      return { coveredFiles: 0, totalFiles: 0, percent: 0, missingFiles: [] };
    }

    const allSourceFiles: string[] = [];
    this.walkSourceTree(rootDir, allSourceFiles);

    const indexedRows = this.db.prepare(
      `SELECT file_path FROM files`
    ).all() as any[];
    const indexed = new Set<string>(indexedRows.map(r => r.file_path));

    let covered = 0;
    const missing: string[] = [];
    for (const file of allSourceFiles) {
      if (indexed.has(file)) {
        covered++;
      } else {
        missing.push(relative(this.project, file));
      }
    }

    const total = allSourceFiles.length;
    return {
      coveredFiles: covered,
      totalFiles: total,
      percent: total > 0 ? Math.round((covered / total) * 100) : 0,
      missingFiles: missing,
    };
  }

  private walkSourceTree(dir: string, out: string[]): void {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = String(entry.name);
      if (COVERAGE_EXCLUDES.has(name)) continue;
      if (name === '__tests__') continue; // skip test directories
      if (name.startsWith('.') && name !== '.') continue; // skip dotfiles

      const full = join(dir, name);
      if (entry.isDirectory()) {
        this.walkSourceTree(full, out);
      } else if (entry.isFile()) {
        if (isCoverageTestFile(name)) continue;
        const ext = extname(name);
        if (COVERAGE_EXTENSIONS.has(ext)) {
          out.push(full);
        }
      }
    }
  }

  getSourceLink(name: string, hintFileStem?: string): SourceLinkCandidate[] {
    const sql = hintFileStem
      ? `SELECT f.file_path AS source_file_path, m.source_line, m.source_line_end, f.language, m.is_exported
         FROM methods m
         JOIN files f ON f.id = m.file_id
         WHERE m.name = ?
           AND m.source_line IS NOT NULL
           AND f.file_stem = ?
         ORDER BY m.is_exported DESC, f.file_stem`
      : `SELECT f.file_path AS source_file_path, m.source_line, m.source_line_end, f.language, m.is_exported
         FROM methods m
         JOIN files f ON f.id = m.file_id
         WHERE m.name = ?
           AND m.source_line IS NOT NULL
         ORDER BY m.is_exported DESC, f.file_stem`;

    const stmt = this.db.prepare(sql);
    const rows = hintFileStem ? stmt.all(name, hintFileStem) : stmt.all(name);

    return (rows as any[]).map(r => ({
      sourceFilePath: r.source_file_path,
      sourceLine: r.source_line,
      sourceLineEnd: r.source_line_end,
      language: r.language,
      isExported: r.is_exported === 1,
    }));
  }

  /**
   * Return all methods indexed for a given absolute source file path.
   * Used by the Function Jump Dropdown (Tier 1 lookup).
   */
  getFunctionsForSource(sourceFilePath: string): FunctionForSource[] {
    const rows = this.db.prepare(`
      SELECT
        m.name,
        m.params,
        m.return_type,
        m.is_exported,
        m.source_line,
        m.source_line_end,
        m.visibility,
        m.is_async,
        m.kind
      FROM methods m
      JOIN files f ON f.id = m.file_id
      WHERE f.file_path = ?
      ORDER BY
        CASE WHEN m.source_line IS NULL THEN 1 ELSE 0 END,
        m.source_line ASC,
        m.sort_order ASC
    `).all(sourceFilePath) as any[];

    return rows.map(r => ({
      name: r.name,
      params: r.params,
      returnType: r.return_type,
      isExported: r.is_exported === 1,
      sourceLine: r.source_line,
      sourceLineEnd: r.source_line_end,
      visibility: r.visibility,
      isAsync: r.is_async === 1,
      kind: r.kind,
    }));
  }

  /**
   * Look up the source line and source file path for a given method in a given file.
   * Used by the code search endpoint to enrich FTS hits with navigation metadata.
   */
  getMethodLocation(filePath: string, methodName: string): { sourceLine: number | null; sourceFilePath: string | null } | null {
    const row = this.db.prepare(`
      SELECT m.source_line, f.file_path AS source_file_path
      FROM methods m
      JOIN files f ON f.id = m.file_id
      WHERE f.file_path = ? AND m.name = ?
      LIMIT 1
    `).get(filePath, methodName) as any;
    if (!row) return null;
    return {
      sourceLine: row.source_line ?? null,
      sourceFilePath: row.source_file_path ?? null,
    };
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Singleton factory
// ============================================================================

const instances = new Map<string, PseudoDbService>();

export function getPseudoDb(project: string): PseudoDbService {
  if (!instances.has(project)) {
    instances.set(project, new PseudoDbService(project));
  }
  return instances.get(project)!;
}
