// V2-surface query layer over V6 tables. See degradation ledger in design doc `pseudo-db-unification-design`.

import type { Database } from 'bun:sqlite';
import { join, relative, extname, basename } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import type {
  PseudoFileSummary,
  PseudoFileWithMethods,
  PseudoMethodWithMeta,
  SearchResult,
  GraphNode,
  GraphEdge,
  AffectedItem,
  CoverageReport,
  StatsReport,
  SourceLinkCandidate,
  FunctionForSource,
} from './pseudo-db.js';

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

function deriveFileStem(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

export function listFiles(db: Database): PseudoFileSummary[] {
  const rows = db.prepare(`
    SELECT f.file_path, f.title, f.scanned_at,
      COUNT(m.id) as methodCount,
      SUM(CASE WHEN m.is_exported = 1 THEN 1 ELSE 0 END) as exportCount
    FROM files f
    LEFT JOIN methods m ON m.file_path = f.file_path
    GROUP BY f.file_path
  `).all() as any[];

  return rows.map(r => ({
    filePath: r.file_path,
    title: r.title,
    methodCount: r.methodCount ?? 0,
    exportCount: r.exportCount ?? 0,
    lastUpdated: r.scanned_at,
  }));
}

export function getFile(db: Database, filePath: string): PseudoFileWithMethods | null {
  const fileRow = db.prepare(`
    SELECT file_path, title, purpose, module_context, file_prose_origin, scanned_at
    FROM files
    WHERE file_path = ?
  `).get(filePath) as any;

  if (!fileRow) return null;

  const methodRows = db.prepare(`
    SELECT id, name, normalized_params, is_exported, is_async, start_line, end_line, enclosing_class
    FROM methods
    WHERE file_path = ?
    ORDER BY CASE WHEN start_line IS NULL THEN 1 ELSE 0 END, start_line ASC
  `).all(filePath) as any[];

  const methods: PseudoMethodWithMeta[] = methodRows.map(m => {
    const steps = db.prepare(`
      SELECT content FROM method_steps WHERE method_id = ? ORDER BY "order"
    `).all(m.id) as any[];

    const calls = db.prepare(`
      SELECT callee_name FROM method_calls WHERE caller_method_id = ?
    `).all(m.id) as any[];

    return {
      name: m.name,
      params: m.normalized_params,
      returnType: '',
      isExported: m.is_exported === 1,
      date: null,
      visibility: null,
      isAsync: m.is_async === 1,
      kind: null,
      sourceLine: m.start_line,
      sourceLineEnd: m.end_line,
      paramCount: 0,
      stepCount: steps.length,
      owningSymbol: m.enclosing_class,
      steps: steps.map(s => ({ content: s.content, depth: 0 })),
      calls: calls.map(c => ({ name: c.callee_name, fileStem: '' })),
    };
  });

  return {
    filePath: fileRow.file_path,
    title: fileRow.title,
    purpose: fileRow.purpose,
    moduleContext: fileRow.module_context,
    proseUpdatedAt: null,
    hasProse: fileRow.file_prose_origin !== 'none',
    structuralIndexedAt: fileRow.scanned_at,
    language: null,
    methods,
  };
}

export function getFileByStem(db: Database, fileStem: string): PseudoFileWithMethods | null {
  const rows = db.prepare(`SELECT file_path FROM files`).all() as any[];
  for (const r of rows) {
    if (deriveFileStem(r.file_path) === fileStem) {
      return getFile(db, r.file_path);
    }
  }
  return null;
}

// V6 FTS is per-file; methodName synthesized as ''
export function search(db: Database, query: string, limit = 50): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const safe = /[:()*]/.test(trimmed) ? trimmed : '"' + trimmed.replace(/"/g, '""') + '"';

  try {
    const rows = db.prepare(`
      SELECT m.file_path as filePath,
             snippet(pseudo_fts, 1, '<mark>', '</mark>', '…', 32) as snippet,
             bm25(pseudo_fts) as rank
      FROM pseudo_fts
      JOIN pseudo_fts_rowid m ON m.rowid = pseudo_fts.rowid
      WHERE pseudo_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(safe, limit) as any[];

    return rows.map(r => ({
      filePath: r.filePath,
      methodName: '',
      snippet: r.snippet,
      rank: r.rank,
    }));
  } catch {
    return [];
  }
}

export function getReferences(
  db: Database,
  name: string,
  fileStem?: string,
): Array<{ filePath: string; methodName: string; line: number }> {
  const sql = fileStem
    ? `SELECT files.file_path as filePath, methods.name as methodName, methods.start_line as line
       FROM method_calls
       JOIN methods ON methods.id = method_calls.caller_method_id
       JOIN files ON files.file_path = methods.file_path
       WHERE method_calls.callee_name = ?
         AND files.file_path LIKE '%/' || ? || '.%'`
    : `SELECT files.file_path as filePath, methods.name as methodName, methods.start_line as line
       FROM method_calls
       JOIN methods ON methods.id = method_calls.caller_method_id
       JOIN files ON files.file_path = methods.file_path
       WHERE method_calls.callee_name = ?`;

  const stmt = db.prepare(sql);
  const rows = (fileStem ? stmt.all(name, fileStem) : stmt.all(name)) as any[];

  return rows.map(r => ({
    filePath: r.filePath,
    methodName: r.methodName,
    line: r.line ?? 0,
  }));
}

export function getCallGraph(db: Database): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const methodRows = db.prepare(`
    SELECT id, name, file_path, is_exported
    FROM methods
  `).all() as any[];

  const nodes: GraphNode[] = methodRows.map(r => ({
    id: r.id,
    label: r.name,
    type: 'method' as const,
    filePath: r.file_path,
    isExported: r.is_exported === 1,
  }));

  const edgeRows = db.prepare(`
    SELECT caller_method_id, callee_method_id
    FROM method_calls
    WHERE callee_method_id IS NOT NULL
  `).all() as any[];

  const edges: GraphEdge[] = edgeRows.map(r => ({
    source: r.caller_method_id,
    target: r.callee_method_id,
  }));

  return { nodes, edges };
}

export function getExports(db: Database): PseudoMethodWithMeta[] {
  const rows = db.prepare(`
    SELECT id, name, normalized_params, is_exported, is_async, start_line, end_line, enclosing_class
    FROM methods
    WHERE is_exported = 1
    ORDER BY file_path, start_line
  `).all() as any[];

  return rows.map(m => {
    const steps = db.prepare(`
      SELECT content FROM method_steps WHERE method_id = ? ORDER BY "order"
    `).all(m.id) as any[];

    const calls = db.prepare(`
      SELECT callee_name FROM method_calls WHERE caller_method_id = ?
    `).all(m.id) as any[];

    return {
      name: m.name,
      params: m.normalized_params,
      returnType: '',
      isExported: m.is_exported === 1,
      date: null,
      visibility: null,
      isAsync: m.is_async === 1,
      kind: null,
      sourceLine: m.start_line,
      sourceLineEnd: m.end_line,
      paramCount: 0,
      stepCount: steps.length,
      owningSymbol: m.enclosing_class,
      steps: steps.map(s => ({ content: s.content, depth: 0 })),
      calls: calls.map(c => ({ name: c.callee_name, fileStem: '' })),
    };
  });
}

export function getImpactAnalysis(
  db: Database,
  name: string,
  fileStem?: string,
): { direct: AffectedItem[]; transitive: AffectedItem[] } {
  const sql = fileStem
    ? `
      WITH RECURSIVE impact(method_id, depth) AS (
        SELECT mc.caller_method_id, 1
        FROM method_calls mc
        JOIN methods m ON m.id = mc.callee_method_id
        WHERE m.name = ? AND m.file_path LIKE '%/' || ? || '.%'

        UNION

        SELECT mc2.caller_method_id, impact.depth + 1
        FROM impact
        JOIN method_calls mc2 ON mc2.callee_method_id = impact.method_id
        WHERE impact.depth < 10
      )
      SELECT m.name AS caller_name, m.file_path AS caller_file, MIN(impact.depth) AS depth
      FROM impact
      JOIN methods m ON m.id = impact.method_id
      GROUP BY m.id
      ORDER BY depth
    `
    : `
      WITH RECURSIVE impact(method_id, depth) AS (
        SELECT mc.caller_method_id, 1
        FROM method_calls mc
        JOIN methods m ON m.id = mc.callee_method_id
        WHERE m.name = ?

        UNION

        SELECT mc2.caller_method_id, impact.depth + 1
        FROM impact
        JOIN method_calls mc2 ON mc2.callee_method_id = impact.method_id
        WHERE impact.depth < 10
      )
      SELECT m.name AS caller_name, m.file_path AS caller_file, MIN(impact.depth) AS depth
      FROM impact
      JOIN methods m ON m.id = impact.method_id
      GROUP BY m.id
      ORDER BY depth
    `;

  const stmt = db.prepare(sql);
  const rows = (fileStem ? stmt.all(name, fileStem) : stmt.all(name)) as any[];

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

// Requires resolveCallEdges to have run; otherwise all methods appear orphan.
export function getOrphanFunctions(db: Database): PseudoMethodWithMeta[] {
  const rows = db.prepare(`
    SELECT m.id, m.name, m.normalized_params, m.is_exported, m.is_async,
           m.start_line, m.end_line, m.enclosing_class
    FROM methods m
    LEFT JOIN method_calls mc ON mc.callee_method_id = m.id
    WHERE m.is_exported = 0 AND mc.id IS NULL
  `).all() as any[];

  return rows.map(m => {
    const steps = db.prepare(`
      SELECT content FROM method_steps WHERE method_id = ? ORDER BY "order"
    `).all(m.id) as any[];

    const calls = db.prepare(`
      SELECT callee_name FROM method_calls WHERE caller_method_id = ?
    `).all(m.id) as any[];

    return {
      name: m.name,
      params: m.normalized_params,
      returnType: '',
      isExported: m.is_exported === 1,
      date: null,
      visibility: null,
      isAsync: m.is_async === 1,
      kind: null,
      sourceLine: m.start_line,
      sourceLineEnd: m.end_line,
      paramCount: 0,
      stepCount: steps.length,
      owningSymbol: m.enclosing_class,
      steps: steps.map(s => ({ content: s.content, depth: 0 })),
      calls: calls.map(c => ({ name: c.callee_name, fileStem: '' })),
    };
  });
}

// Synchronous walker — V2-compatible shape
export function getCoverage(db: Database, project: string): CoverageReport {
  if (!existsSync(project)) {
    return { coveredFiles: 0, totalFiles: 0, percent: 0, missingFiles: [] };
  }

  const allSourceFiles: string[] = [];
  walkSync(project, allSourceFiles);

  const indexedRows = db.prepare(`SELECT file_path FROM files`).all() as any[];
  const indexed = new Set<string>(indexedRows.map(r => r.file_path));

  let covered = 0;
  const missing: string[] = [];
  for (const file of allSourceFiles) {
    if (indexed.has(file)) {
      covered++;
    } else {
      missing.push(relative(project, file));
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

function walkSync(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (COVERAGE_EXCLUDES.has(name)) continue;
    if (name === '__tests__') continue;
    if (name.startsWith('.') && name !== '.') continue;

    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      walkSync(full, out);
    } else if (st.isFile()) {
      if (isCoverageTestFile(name)) continue;
      const ext = extname(name);
      if (COVERAGE_EXTENSIONS.has(ext)) {
        out.push(full);
      }
    }
  }
}

export function getSourceLink(
  db: Database,
  name: string,
  fileStem?: string,
): SourceLinkCandidate[] {
  const sql = fileStem
    ? `SELECT file_path, start_line, end_line, is_exported
       FROM methods
       WHERE name = ?
         AND start_line IS NOT NULL
         AND file_path LIKE '%/' || ? || '.%'
       ORDER BY is_exported DESC`
    : `SELECT file_path, start_line, end_line, is_exported
       FROM methods
       WHERE name = ?
         AND start_line IS NOT NULL
       ORDER BY is_exported DESC`;

  const stmt = db.prepare(sql);
  const rows = (fileStem ? stmt.all(name, fileStem) : stmt.all(name)) as any[];

  return rows.map(r => ({
    sourceFilePath: r.file_path,
    sourceLine: r.start_line,
    sourceLineEnd: r.end_line,
    language: null,
    isExported: r.is_exported === 1,
  }));
}

export function getFunctionsForSource(db: Database, filePath: string): FunctionForSource[] {
  const rows = db.prepare(`
    SELECT name, normalized_params, start_line, end_line, is_async, is_exported, enclosing_class
    FROM methods
    WHERE file_path = ?
    ORDER BY CASE WHEN start_line IS NULL THEN 1 ELSE 0 END, start_line ASC
  `).all(filePath) as any[];

  return rows.map(r => ({
    name: r.name,
    params: r.normalized_params,
    returnType: '',
    isExported: r.is_exported === 1,
    sourceLine: r.start_line,
    sourceLineEnd: r.end_line,
    visibility: null,
    isAsync: r.is_async === 1,
    kind: null,
  }));
}

export function getStats(db: Database): StatsReport {
  const row = db.prepare(`
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

export function getFilesByDirectory(db: Database, dir: string): PseudoFileSummary[] {
  const rows = db.prepare(`
    SELECT f.file_path, f.title, f.scanned_at,
      COUNT(m.id) as methodCount,
      SUM(CASE WHEN m.is_exported = 1 THEN 1 ELSE 0 END) as exportCount
    FROM files f
    LEFT JOIN methods m ON m.file_path = f.file_path
    WHERE f.file_path LIKE ? || '%'
    GROUP BY f.file_path
  `).all(dir) as any[];

  return rows.map(r => ({
    filePath: r.file_path,
    title: r.title,
    methodCount: r.methodCount ?? 0,
    exportCount: r.exportCount ?? 0,
    lastUpdated: r.scanned_at,
  }));
}

export function getMethodLocation(
  db: Database,
  methodId: string,
): { filePath: string; line: number } | null {
  const row = db.prepare(`
    SELECT file_path, start_line FROM methods WHERE id = ?
  `).get(methodId) as any;

  if (!row) return null;
  return {
    filePath: row.file_path,
    line: row.start_line ?? 0,
  };
}
