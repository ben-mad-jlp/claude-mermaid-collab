/**
 * Pseudo DB Service
 *
 * SQLite database for indexed pseudocode files.
 * Supports full-text search, call graph analysis, and impact analysis.
 *
 * Stored at {project}/.collab/pseudo/pseudo.db (gitignored)
 */

import Database from 'bun:sqlite';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { parsePseudo, type ParsedPseudoFile, type ParsedMethod, type ParsedStep } from './pseudo-parser.js';

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

export interface PseudoFileWithMethods {
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  syncedAt: string | null;
  methods: Array<{
    name: string;
    params: string;
    returnType: string;
    isExported: boolean;
    date: string | null;
    steps: Array<{ content: string; depth: number }>;
    calls: Array<{ name: string; fileStem: string }>;
  }>;
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

// ============================================================================
// Schema
// ============================================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  file_stem TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  UNIQUE(file_id, name)
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
  callee_file_stem TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS pseudo_fts USING fts5(
  method_name,
  step_content,
  content='',
  tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_stem ON files(file_stem);
CREATE INDEX IF NOT EXISTS idx_methods_file ON methods(file_id);
CREATE INDEX IF NOT EXISTS idx_methods_name ON methods(name);
CREATE INDEX IF NOT EXISTS idx_method_steps_method ON method_steps(method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee ON method_calls(callee_name);
CREATE INDEX IF NOT EXISTS idx_method_calls_caller ON method_calls(caller_method_id);
`;

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
    this.db.exec(SCHEMA);
  }

  upsertFile(filePath: string, parsed: ParsedPseudoFile): void {
    const tx = this.db.transaction(() => {
      // Clean up FTS entries before cascade delete (FTS virtual table not covered by CASCADE)
      // Contentless FTS5 tables require special delete syntax
      const existingFile = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as any;
      if (existingFile) {
        const existingMethods = this.db.prepare(
          `SELECT m.id, m.name, GROUP_CONCAT(ms.content, ' ') as step_content
           FROM methods m
           LEFT JOIN method_steps ms ON ms.method_id = m.id
           WHERE m.file_id = ?
           GROUP BY m.id`
        ).all(existingFile.id) as any[];
        for (const m of existingMethods) {
          this.db.prepare(
            "INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)"
          ).run(m.id, m.name, m.step_content ?? '');
        }
      }

      // Delete existing file (cascades to methods, steps, calls)
      this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);

      // Insert file
      const stem = filePath.split('/').pop()?.replace('.pseudo', '') || filePath;
      const fileResult = this.db.prepare(
        'INSERT INTO files (file_path, file_stem, title, purpose, module_context, synced_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(filePath, stem, parsed.title, parsed.purpose, parsed.moduleContext, parsed.syncedAt);
      const fileId = Number(fileResult.lastInsertRowid);

      for (const method of parsed.methods) {
        const methodResult = this.db.prepare(
          'INSERT INTO methods (file_id, name, params, return_type, is_exported, date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(fileId, method.name, method.params, method.returnType, method.isExport ? 1 : 0, method.date, method.sortOrder);
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

        // Insert into FTS
        const joinedSteps = method.steps.map(s => s.content).join(' ');
        this.db.prepare(
          'INSERT INTO pseudo_fts(rowid, method_name, step_content) VALUES (?, ?, ?)'
        ).run(methodId, method.name, joinedSteps);
      }
    });
    tx();
  }

  deleteFile(filePath: string): void {
    // Clean up FTS entries before cascade delete (FTS virtual table not covered by CASCADE)
    // Contentless FTS5 tables require special delete syntax
    const existingFile = this.db.prepare('SELECT id FROM files WHERE file_path = ?').get(filePath) as any;
    if (existingFile) {
      const existingMethods = this.db.prepare(
        `SELECT m.id, m.name, GROUP_CONCAT(ms.content, ' ') as step_content
         FROM methods m
         LEFT JOIN method_steps ms ON ms.method_id = m.id
         WHERE m.file_id = ?
         GROUP BY m.id`
      ).all(existingFile.id) as any[];
      for (const m of existingMethods) {
        this.db.prepare(
          "INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)"
        ).run(m.id, m.name, m.step_content ?? '');
      }
    }
    this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);
  }

  bulkIngest(files: Array<{ filePath: string; content: string }>): void {
    const tx = this.db.transaction(() => {
      // Contentless FTS5 tables don't support DELETE. Use special delete for each entry, then delete files.
      const allMethods = this.db.prepare(
        `SELECT m.id, m.name, GROUP_CONCAT(ms.content, ' ') as step_content
         FROM methods m
         LEFT JOIN method_steps ms ON ms.method_id = m.id
         GROUP BY m.id`
      ).all() as any[];
      for (const m of allMethods) {
        this.db.prepare(
          "INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)"
        ).run(m.id, m.name, m.step_content ?? '');
      }
      this.db.exec('DELETE FROM files');

      for (const file of files) {
        const parsed = parsePseudo(file.content);

        const stem = file.filePath.split('/').pop()?.replace('.pseudo', '') || file.filePath;
        const fileResult = this.db.prepare(
          'INSERT INTO files (file_path, file_stem, title, purpose, module_context, synced_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(file.filePath, stem, parsed.title, parsed.purpose, parsed.moduleContext, parsed.syncedAt);
        const fileId = Number(fileResult.lastInsertRowid);

        for (const method of parsed.methods) {
          const methodResult = this.db.prepare(
            'INSERT INTO methods (file_id, name, params, return_type, is_exported, date, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(fileId, method.name, method.params, method.returnType, method.isExport ? 1 : 0, method.date, method.sortOrder);
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
            'INSERT INTO pseudo_fts(rowid, method_name, step_content) VALUES (?, ?, ?)'
          ).run(methodId, method.name, joinedSteps);
        }
      }
    });
    tx();
  }

  listFiles(): PseudoFileSummary[] {
    const rows = this.db.prepare(`
      SELECT f.file_path, f.title, f.updated_at,
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
      lastUpdated: r.updated_at,
    }));
  }

  getFile(filePath: string): PseudoFileWithMethods | null {
    const file = this.db.prepare('SELECT * FROM files WHERE file_path = ?').get(filePath) as any;
    if (!file) return null;

    const methods = this.db.prepare(
      'SELECT * FROM methods WHERE file_id = ? ORDER BY sort_order'
    ).all(file.id) as any[];

    const result: PseudoFileWithMethods = {
      filePath: file.file_path,
      title: file.title,
      purpose: file.purpose,
      moduleContext: file.module_context,
      syncedAt: file.synced_at,
      methods: methods.map(m => {
        const steps = this.db.prepare(
          'SELECT content, depth FROM method_steps WHERE method_id = ? ORDER BY sort_order'
        ).all(m.id) as Array<{ content: string; depth: number }>;

        const calls = this.db.prepare(
          'SELECT callee_name as name, callee_file_stem as fileStem FROM method_calls WHERE caller_method_id = ?'
        ).all(m.id) as Array<{ name: string; fileStem: string }>;

        return {
          name: m.name,
          params: m.params,
          returnType: m.return_type,
          isExported: m.is_exported === 1,
          date: m.date,
          steps,
          calls,
        };
      }),
    };

    return result;
  }

  search(query: string): SearchResult[] {
    // Sanitize FTS5 input: escape double quotes and wrap in double quotes
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

  getReferences(methodName: string, fileStem: string): Array<{ file: string; callerMethod: string }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name
      FROM method_calls mc
      JOIN methods m ON m.id = mc.caller_method_id
      JOIN files f ON f.id = m.file_id
      WHERE mc.callee_name = ? AND mc.callee_file_stem = ?
    `).all(methodName, fileStem) as any[];

    return rows.map(r => ({
      file: r.file_path,
      callerMethod: r.name,
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

    const callRows = this.db.prepare(`
      SELECT m.name as caller_name, f.file_path as caller_file,
        mc.callee_name, mc.callee_file_stem,
        f_callee.file_path as callee_file
      FROM method_calls mc
      JOIN methods m ON m.id = mc.caller_method_id
      JOIN files f ON f.id = m.file_id
      LEFT JOIN files f_callee ON f_callee.file_stem = mc.callee_file_stem
    `).all() as any[];

    const edges: GraphEdge[] = callRows
      .filter(r => r.callee_file !== null)
      .map(r => ({
        source: `${r.caller_file}::${r.caller_name}`,
        target: `${r.callee_file}::${r.callee_name}`,
      }));

    return { nodes, edges };
  }

  getExports(): Array<{ filePath: string; methodName: string; purpose: string }> {
    const rows = this.db.prepare(`
      SELECT f.file_path, m.name, GROUP_CONCAT(ms.content, ' ') as purpose
      FROM methods m
      JOIN files f ON f.id = m.file_id
      LEFT JOIN method_steps ms ON ms.method_id = m.id
      WHERE m.is_exported = 1
      GROUP BY m.id
    `).all() as any[];

    return rows.map(r => ({
      filePath: r.file_path,
      methodName: r.name,
      purpose: r.purpose ?? '',
    }));
  }

  getFilesByDirectory(dir: string): PseudoFileSummary[] {
    const rows = this.db.prepare(`
      SELECT f.file_path, f.title, f.updated_at,
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
      lastUpdated: r.updated_at,
    }));
  }

  getImpactAnalysis(methodName: string, fileStem: string): { direct: AffectedItem[]; transitive: AffectedItem[] } {
    const rows = this.db.prepare(`
      WITH RECURSIVE impact(caller_name, caller_file, depth) AS (
        SELECT m.name, f.file_path, 1
        FROM method_calls mc
        JOIN methods m ON m.id = mc.caller_method_id
        JOIN files f ON f.id = m.file_id
        WHERE mc.callee_name = ? AND mc.callee_file_stem = ?

        UNION

        SELECT m2.name, f2.file_path, impact.depth + 1
        FROM impact
        JOIN files f_match ON f_match.file_path = impact.caller_file
        JOIN methods m_match ON m_match.file_id = f_match.id AND m_match.name = impact.caller_name
        JOIN method_calls mc2 ON mc2.callee_name = m_match.name AND mc2.callee_file_stem = f_match.file_stem
        JOIN methods m2 ON m2.id = mc2.caller_method_id
        JOIN files f2 ON f2.id = m2.file_id
        WHERE impact.depth < 10
      )
      SELECT DISTINCT caller_name, caller_file, MIN(depth) as depth
      FROM impact
      GROUP BY caller_name, caller_file
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
        ON mc.callee_name = m.name
        AND mc.callee_file_stem = f.file_stem
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

  getCoverage(directory?: string): CoverageReport {
    let coveredFiles: number;
    let fileRows: any[];

    if (directory) {
      const countRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM files WHERE file_path LIKE ? || '%'"
      ).get(directory) as any;
      coveredFiles = countRow.cnt;
      fileRows = this.db.prepare(
        "SELECT file_path FROM files WHERE file_path LIKE ? || '%'"
      ).all(directory) as any[];
    } else {
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM files').get() as any;
      coveredFiles = countRow.cnt;
      fileRows = this.db.prepare('SELECT file_path FROM files').all() as any[];
    }

    return {
      coveredFiles,
      totalFiles: coveredFiles,
      percent: coveredFiles > 0 ? 100 : 0,
      missingFiles: [],
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
