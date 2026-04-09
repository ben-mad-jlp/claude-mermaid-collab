/**
 * Pseudo DB Service
 *
 * SQLite database for indexed pseudocode files.
 * Supports full-text search, call graph analysis, and impact analysis.
 *
 * Stored at {project}/.collab/pseudo/pseudo.db (gitignored)
 */

import Database from 'bun:sqlite';
import { join, dirname, relative, isAbsolute, extname } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { parsePseudo, type ParsedPseudoFile, type ParsedMethod } from './pseudo-parser.js';

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
  syncedAt: string | null;
  sourceFilePath: string | null;
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

// ============================================================================
// Schema (v1)
// ============================================================================

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  file_stem TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',
  synced_at TEXT,
  source_file_path TEXT,
  source_mtime TEXT,
  source_hash TEXT,
  language TEXT,
  line_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_stem ON files(file_stem);
CREATE INDEX IF NOT EXISTS idx_files_source_path ON files(source_file_path);
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
    // Check current version (table may not exist on fresh DBs or pre-v1 DBs)
    let currentVersion = 0;
    try {
      const row = this.db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any;
      if (row && typeof row.version === 'number') {
        currentVersion = row.version;
      }
    } catch {
      // schema_version table doesn't exist → v0
      currentVersion = 0;
    }

    if (currentVersion >= SCHEMA_VERSION) {
      // Already at target version — just ensure schema exists (idempotent CREATE IF NOT EXISTS)
      this.db.exec(SCHEMA);
      return;
    }

    // v0 → v1: drop all data tables and recreate. DB is a gitignored cache so users re-ingest.
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
    this.db.prepare('INSERT INTO schema_version (id, version) VALUES (1, ?)').run(SCHEMA_VERSION);
  }

  upsertFile(filePath: string, parsed: ParsedPseudoFile): void {
    const tx = this.db.transaction(() => {
      // Clean up FTS entries before cascade delete
      this.clearFtsForFile(filePath);

      // Delete existing file (cascades to methods, steps, calls)
      this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);

      // Compute source file metadata if source path is present
      const sourceFilePath = this.resolveSourceFilePath(filePath, parsed);
      const sourceMeta = sourceFilePath ? this.computeSourceMeta(sourceFilePath) : null;

      const scanLanguage = parsed.language ?? sourceMeta?.language ?? null;
      if (sourceFilePath && parsed.methods.length > 0) {
        this.scanSourceFileForLines(sourceFilePath, parsed.methods, scanLanguage);
      }

      // Insert file with new columns
      const stem = filePath.split('/').pop()?.replace('.pseudo', '') || filePath;
      const fileResult = this.db.prepare(
        `INSERT INTO files
         (file_path, file_stem, title, purpose, module_context, synced_at,
          source_file_path, source_mtime, source_hash, language, line_count, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        filePath,
        stem,
        parsed.title,
        parsed.purpose,
        parsed.moduleContext,
        parsed.syncedAt,
        sourceFilePath,
        sourceMeta?.mtime ?? null,
        sourceMeta?.hash ?? null,
        parsed.language ?? sourceMeta?.language ?? null,
        sourceMeta?.lineCount ?? null,
      );
      const fileId = Number(fileResult.lastInsertRowid);

      // Insert methods with new metadata columns
      for (const method of parsed.methods) {
        const methodResult = this.db.prepare(
          `INSERT INTO methods
           (file_id, name, params, return_type, is_exported, date, sort_order,
            visibility, is_async, kind, source_line, source_line_end,
            param_count, step_count, owning_symbol)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          fileId,
          method.name,
          method.params,
          method.returnType,
          method.isExport ? 1 : 0,
          method.date,
          method.sortOrder,
          method.visibility,
          method.isAsync ? 1 : 0,
          method.kind,
          method.sourceLine,
          method.sourceLineEnd,
          method.paramCount,
          method.stepCount,
          method.owningSymbol,
        );
        const methodId = Number(methodResult.lastInsertRowid);

        for (const step of method.steps) {
          this.db.prepare(
            'INSERT INTO method_steps (method_id, content, depth, sort_order) VALUES (?, ?, ?, ?)'
          ).run(methodId, step.content, step.depth, step.sortOrder);
        }

        for (const call of method.calls) {
          this.db.prepare(
            'INSERT INTO method_calls (caller_method_id, callee_name, callee_file_stem) VALUES (?, ?, ?)'
          ).run(methodId, call.name, call.fileStem);
        }

        // Insert into widened FTS
        const joinedSteps = method.steps.map(s => s.content).join(' ');
        this.db.prepare(
          `INSERT INTO pseudo_fts (rowid, method_name, step_content, title, purpose, module_context, params)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          methodId,
          method.name,
          joinedSteps,
          parsed.title,
          parsed.purpose,
          parsed.moduleContext,
          method.params,
        );
      }

      // Resolve call edges for this file (both directions)
      this.resolveCalleesForFile(fileId);
    });
    tx();
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

  private resolveSourceFilePath(pseudoFilePath: string, parsed: ParsedPseudoFile): string | null {
    // 1. Prefer the explicit // source: header
    if (parsed.sourceFilePath) {
      const p = parsed.sourceFilePath;
      // Resolve relative to project root if not absolute
      const abs = isAbsolute(p) ? p : join(this.project, p);
      if (existsSync(abs)) return abs;
      return null;
    }

    // 2. Fallback: probe common extensions next to the .pseudo file
    const base = pseudoFilePath.replace(/\.pseudo$/, '');
    const probes = ['.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.go', '.rs'];
    for (const ext of probes) {
      const candidate = base + ext;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private computeSourceMeta(sourceFilePath: string): {
    mtime: string;
    hash: string | null;
    lineCount: number | null;
    language: string | null;
  } | null {
    try {
      const stat = statSync(sourceFilePath);
      const mtime = stat.mtime.toISOString();

      let hash: string | null = null;
      let lineCount: number | null = null;
      // Only read small files into memory for hash + line count
      if (stat.size <= 1_000_000) {
        try {
          const content = readFileSync(sourceFilePath, 'utf-8');
          hash = createHash('sha1').update(content).digest('hex').slice(0, 16);
          lineCount = content.split('\n').length;
        } catch {
          // ignore read failure; keep nulls
        }
      }

      const language = extToLanguage(extname(sourceFilePath));
      return { mtime, hash, lineCount, language };
    } catch {
      return null;
    }
  }

  private scanSourceFileForLines(
    sourceFilePath: string,
    methods: ParsedMethod[],
    language: string | null,
  ): void {
    let content: string;
    try {
      const stat = statSync(sourceFilePath);
      if (stat.size > 1_000_000) return; // too big
      content = readFileSync(sourceFilePath, 'utf-8');
    } catch {
      return;
    }

    const lines = content.split('\n');

    for (const method of methods) {
      // Don't overwrite values a caller explicitly provided
      if (method.sourceLine != null) continue;

      const searchName = method.name.includes('.')
        ? method.name.split('.').pop()!
        : method.name;

      const result = findMethodLineForLanguage(lines, searchName, language);
      if (result) {
        method.sourceLine = result.line;
        if (method.sourceLineEnd == null) {
          method.sourceLineEnd = result.lineEnd;
        }
      }
    }
  }

  private clearFtsForFile(filePath: string): void {
    const existingFile = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as any;
    if (!existingFile) return;
    const existingMethods = this.db.prepare(
      `SELECT m.id, m.name, COALESCE(GROUP_CONCAT(ms.content, ' '), '') AS step_content
       FROM methods m
       LEFT JOIN method_steps ms ON ms.method_id = m.id
       WHERE m.file_id = ?
       GROUP BY m.id`
    ).all(existingFile.id) as any[];
    for (const m of existingMethods) {
      this.db.prepare(
        "INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content, title, purpose, module_context, params) VALUES('delete', ?, ?, ?, '', '', '', '')"
      ).run(m.id, m.name, m.step_content ?? '');
    }
  }

  deleteFile(filePath: string): void {
    this.clearFtsForFile(filePath);
    this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);
  }

  bulkIngest(files: Array<{ filePath: string; content: string }>): void {
    const tx = this.db.transaction(() => {
      // Clean slate: drop + recreate FTS (cheaper than per-row delete)
      this.db.exec('DROP TABLE IF EXISTS pseudo_fts');
      this.db.exec(`
        CREATE VIRTUAL TABLE pseudo_fts USING fts5(
          method_name,
          step_content,
          title,
          purpose,
          module_context,
          params,
          content='',
          tokenize='porter unicode61'
        )
      `);
      this.db.exec('DELETE FROM files');

      for (const file of files) {
        const parsed = parsePseudo(file.content);
        const sourceFilePath = this.resolveSourceFilePath(file.filePath, parsed);
        const sourceMeta = sourceFilePath ? this.computeSourceMeta(sourceFilePath) : null;

        const scanLanguage = parsed.language ?? sourceMeta?.language ?? null;
        if (sourceFilePath && parsed.methods.length > 0) {
          this.scanSourceFileForLines(sourceFilePath, parsed.methods, scanLanguage);
        }

        const stem = file.filePath.split('/').pop()?.replace('.pseudo', '') || file.filePath;
        const fileResult = this.db.prepare(
          `INSERT INTO files
           (file_path, file_stem, title, purpose, module_context, synced_at,
            source_file_path, source_mtime, source_hash, language, line_count, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          file.filePath,
          stem,
          parsed.title,
          parsed.purpose,
          parsed.moduleContext,
          parsed.syncedAt,
          sourceFilePath,
          sourceMeta?.mtime ?? null,
          sourceMeta?.hash ?? null,
          parsed.language ?? sourceMeta?.language ?? null,
          sourceMeta?.lineCount ?? null,
        );
        const fileId = Number(fileResult.lastInsertRowid);

        for (const method of parsed.methods) {
          const methodResult = this.db.prepare(
            `INSERT INTO methods
             (file_id, name, params, return_type, is_exported, date, sort_order,
              visibility, is_async, kind, source_line, source_line_end,
              param_count, step_count, owning_symbol)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            fileId,
            method.name,
            method.params,
            method.returnType,
            method.isExport ? 1 : 0,
            method.date,
            method.sortOrder,
            method.visibility,
            method.isAsync ? 1 : 0,
            method.kind,
            method.sourceLine,
            method.sourceLineEnd,
            method.paramCount,
            method.stepCount,
            method.owningSymbol,
          );
          const methodId = Number(methodResult.lastInsertRowid);

          for (const step of method.steps) {
            this.db.prepare(
              'INSERT INTO method_steps (method_id, content, depth, sort_order) VALUES (?, ?, ?, ?)'
            ).run(methodId, step.content, step.depth, step.sortOrder);
          }

          for (const call of method.calls) {
            this.db.prepare(
              'INSERT INTO method_calls (caller_method_id, callee_name, callee_file_stem) VALUES (?, ?, ?)'
            ).run(methodId, call.name, call.fileStem);
          }

          const joinedSteps = method.steps.map(s => s.content).join(' ');
          this.db.prepare(
            `INSERT INTO pseudo_fts (rowid, method_name, step_content, title, purpose, module_context, params)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            methodId,
            method.name,
            joinedSteps,
            parsed.title,
            parsed.purpose,
            parsed.moduleContext,
            method.params,
          );
        }
      }

      // Single-pass resolve all call edges now that every file is ingested
      this.db.exec(`
        UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m
          JOIN files f ON f.id = m.file_id
          WHERE f.file_stem = method_calls.callee_file_stem
            AND m.name = method_calls.callee_name
          LIMIT 1
        )
      `);
    });
    tx();
  }

  listFiles(): PseudoFileSummary[] {
    const rows = this.db.prepare(`
      SELECT f.file_path, f.title, f.indexed_at,
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
      lastUpdated: r.indexed_at,
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
        f.file_path, f.title, f.purpose, f.module_context, f.synced_at,
        f.source_file_path, f.language,
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
      syncedAt: row.synced_at,
      sourceFilePath: row.source_file_path,
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
      SELECT f.file_path, f.title, f.indexed_at,
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
      lastUpdated: r.indexed_at,
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
    // Walk the source tree and compare against indexed source_file_path
    const rootDir = directory
      ? (isAbsolute(directory) ? directory : join(this.project, directory))
      : this.project;

    if (!existsSync(rootDir)) {
      return { coveredFiles: 0, totalFiles: 0, percent: 0, missingFiles: [] };
    }

    const allSourceFiles: string[] = [];
    this.walkSourceTree(rootDir, allSourceFiles);

    const indexedRows = this.db.prepare(
      `SELECT source_file_path FROM files WHERE source_file_path IS NOT NULL`
    ).all() as any[];
    const indexed = new Set<string>(indexedRows.map(r => r.source_file_path));

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
      ? `SELECT f.source_file_path, m.source_line, m.source_line_end, f.language, m.is_exported
         FROM methods m
         JOIN files f ON f.id = m.file_id
         WHERE m.name = ?
           AND m.source_line IS NOT NULL
           AND f.source_file_path IS NOT NULL
           AND f.file_stem = ?
         ORDER BY m.is_exported DESC, f.file_stem`
      : `SELECT f.source_file_path, m.source_line, m.source_line_end, f.language, m.is_exported
         FROM methods m
         JOIN files f ON f.id = m.file_id
         WHERE m.name = ?
           AND m.source_line IS NOT NULL
           AND f.source_file_path IS NOT NULL
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
      WHERE f.source_file_path = ?
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

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Language detection
// ============================================================================

function extToLanguage(ext: string): string | null {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.py': 'python',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'c',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.go': 'go',
    '.rs': 'rust',
  };
  return map[ext.toLowerCase()] ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Dispatches to language-specific regex for finding a method's definition line
 * in a source file. Returns 1-based line numbers. Good-effort per language.
 */
function findMethodLineForLanguage(
  lines: string[],
  name: string,
  language: string | null,
): { line: number; lineEnd: number | null } | null {
  const n = escapeRegex(name);

  const patterns: RegExp[] = [];
  let computeEnd = false;

  if (language === 'typescript' || language === 'javascript') {
    computeEnd = true;
    patterns.push(
      new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*[<(]`),
      new RegExp(`^\\s*(?:export\\s+)?const\\s+${n}\\s*=\\s*(?:async\\s+)?(?:function|\\()`),
      new RegExp(`^\\s*(?:public|private|protected|static|async|\\s)*\\b${n}\\s*[<(]`),
      new RegExp(`^\\s*${n}\\s*:\\s*(?:async\\s+)?(?:function|\\()`),
    );
  } else if (language === 'csharp') {
    patterns.push(
      new RegExp(`^\\s*(?:public|private|protected|internal|static|async|override|virtual|\\s)*[A-Za-z_<>,\\s\\[\\]]*\\s+${n}\\s*\\(`),
    );
  } else if (language === 'cpp' || language === 'c') {
    patterns.push(
      new RegExp(`\\b${n}\\s*\\([^)]*\\)\\s*(?:const)?\\s*\\{`),
    );
  } else if (language === 'python') {
    patterns.push(
      new RegExp(`^\\s*(?:async\\s+)?def\\s+${n}\\s*\\(`),
    );
  } else {
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      if (re.test(lines[i])) {
        const lineNumber = i + 1;
        let lineEnd: number | null = null;
        if (computeEnd) {
          lineEnd = findClosingBrace(lines, i);
        }
        return { line: lineNumber, lineEnd };
      }
    }
  }
  return null;
}

/**
 * From a starting line, walk forward tracking `{`/`}` depth to find the closing
 * brace. Returns the 1-based line number of the closing brace, or null if not found.
 */
function findClosingBrace(lines: string[], startIdx: number): number | null {
  let depth = 0;
  let seenOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Simple char walk (doesn't handle strings/comments but good enough for heuristic)
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
        if (seenOpen && depth === 0) {
          return i + 1;
        }
      }
    }
  }
  return null;
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
