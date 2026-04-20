/**
 * Pseudo Indexer — core orchestrator for two-level indexing.
 * Drives walkProject -> scanSourceFileStructural -> overlayProseOnMethods
 * -> FTS upsert -> snapshot write, with scan_runs bookkeeping, AbortSignal,
 * per-file error capture, and an in-process scan mutex.
 */

import { createHash } from 'node:crypto';
import { promises as fsp, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, Statement } from 'bun:sqlite';

import { walkProject, scanSourceFileStructural, type StructuralScanResult } from './source-scanner.js';
import { computeMethodId, computeBodyFingerprint, normalizeParams } from './pseudo-id.js';
import { overlayProseOnMethods, type SourceMethodRow, type OverlayResult } from './pseudo-overlay.js';
import { readProseFile, type ProseFileV3 } from './pseudo-prose-file.js';
import { extractDocstrings } from './pseudo-docstring.js';
import { upsertFileFts, clearFts, ensureFtsMapTable, deleteFileFts } from './pseudo-fts.js';
import { writeSnapshot } from './pseudo-snapshot.js';
import { resolveCallEdges } from './pseudo-resolver.js';

export type ScanTrigger = 'auto' | 'manual' | 'incremental' | 'watcher' | 'reconcile' | 'sessionstart';

export interface ScanOptions {
  signal?: AbortSignal;
  trigger: ScanTrigger;
}

export interface ScanRun {
  id: number;
  trigger: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  files_scanned: number;
  errors: number;
  error_msg: string | null;
}

export interface PseudoIndexer {
  runFullScan(opts: ScanOptions): Promise<ScanRun>;
  runIncrementalScan(paths: string[], opts: ScanOptions): Promise<ScanRun>;
  runIncrementalScanForFile(path: string, opts: ScanOptions): Promise<void>;
  runReranking(opts: ScanOptions): Promise<void>;
  runOrphanDetection(opts: ScanOptions): Promise<{ crossBranch: string[]; actualOrphans: string[] }>;
  cancel(): void;
}

const STUB_BYTE_LIMIT = 500 * 1024;
const STUB_LINE_LIMIT = 10_000;
const PROSE_DIR_REL = '.collab/pseudo/prose';

function sha1(content: string | Buffer): string {
  return createHash('sha1').update(content).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || (err as any).code === 'ABORT_ERR');
}

function langOf(absPath: string): 'ts' | 'js' | 'py' | 'cs' | 'cpp' | 'unknown' {
  const lower = absPath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return 'js';
  if (lower.endsWith('.py')) return 'py';
  if (lower.endsWith('.cs')) return 'cs';
  return 'unknown';
}

function listProseFiles(proseRoot: string): string[] {
  const out: string[] = [];
  if (!existsSync(proseRoot)) return out;
  const stack: string[] = [proseRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.json') && e.name !== '_path_map.json') {
        out.push(full);
      }
    }
  }
  return out;
}

interface ScanStmts {
  insertMethod: Statement;
  insertStep: Statement;
  insertCall: Statement;
  insertImport: Statement;
  insertFile: Statement;
  insertStubFile: Statement;
  updateFileHeuristic: Statement;
}

interface ScanContext {
  db: Database;
  project: string;
  scanRunId: number;
  errorCount: { n: number };
  stmts: ScanStmts;
}

function prepareScanStmts(db: Database): ScanStmts {
  return {
    insertMethod: db.prepare(
      `INSERT OR REPLACE INTO methods
         (id, file_path, enclosing_class, name, normalized_params, body_fingerprint,
          is_async, is_exported, start_line, end_line, prose_origin, match_quality, warning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, NULL)`,
    ),
    insertStep: db.prepare(
      `INSERT INTO method_steps(method_id, "order", content) VALUES (?, ?, ?)`,
    ),
    insertCall: db.prepare(
      `INSERT INTO method_calls(caller_method_id, callee_name, callee_name_hint, callee_method_id, file_path, resolution_quality) VALUES (?, ?, ?, NULL, ?, 'unresolved')`,
    ),
    insertImport: db.prepare(
      `INSERT OR IGNORE INTO file_imports(file_path, imported_path) VALUES (?, ?)`,
    ),
    insertFile: db.prepare(
      `INSERT OR REPLACE INTO files(file_path, source_hash, title, purpose, module_context, file_prose_origin, lines, stub, scanned_at)
       VALUES (?, ?, '', '', '', 'none', ?, 0, ?)`,
    ),
    insertStubFile: db.prepare(
      `INSERT OR REPLACE INTO files(file_path, source_hash, title, purpose, module_context, file_prose_origin, lines, stub, scanned_at)
       VALUES (?, ?, '', '', '', 'none', ?, 1, ?)`,
    ),
    updateFileHeuristic: db.prepare(
      `UPDATE files SET title = ?, purpose = ?, file_prose_origin = 'heuristic' WHERE file_path = ?`,
    ),
  };
}

interface FileScanOutcome {
  filePath: string;
  rows: SourceMethodRow[];
  methodNames: string[];
  stepContents: string[];
  title: string;
  purpose: string;
  stub: boolean;
}

function recordScanError(ctx: ScanContext, filePath: string, phase: string, err: unknown): void {
  ctx.errorCount.n++;
  try {
    ctx.db.run(
      `INSERT INTO scan_errors(scan_run_id, file_path, error_msg, phase) VALUES (?, ?, ?, ?)`,
      [ctx.scanRunId, filePath, (err instanceof Error ? err.message : String(err)), phase],
    );
  } catch (innerErr) {
    console.warn('[pseudo-indexer] failed to record scan_error:', innerErr);
  }
}

function deleteFileRows(db: Database, filePath: string): void {
  db.run(`DELETE FROM files WHERE file_path = ?`, [filePath]);
}

async function scanOneFile(ctx: ScanContext, absPath: string): Promise<FileScanOutcome | null> {
  let buf: Buffer;
  try {
    buf = await fsp.readFile(absPath);
  } catch (err) {
    recordScanError(ctx, absPath, 'read', err);
    return null;
  }
  const sourceHash = sha1(buf);
  const sizeBytes = buf.byteLength;

  let lineCount = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) lineCount++;
    else if (buf[i] === 0x0d && (i + 1 >= buf.length || buf[i + 1] !== 0x0a)) lineCount++;
  }
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a && buf[buf.length - 1] !== 0x0d) lineCount++;

  if (sizeBytes > STUB_BYTE_LIMIT || lineCount > STUB_LINE_LIMIT) {
    try {
      ctx.stmts.insertStubFile.run(absPath, sourceHash, lineCount, nowIso());
    } catch (err) {
      recordScanError(ctx, absPath, 'insert_stub_file', err);
    }
    return { filePath: absPath, rows: [], methodNames: [], stepContents: [], title: '', purpose: '', stub: true };
  }

  let content: string;
  try {
    content = buf.toString('utf8');
  } catch (err) {
    recordScanError(ctx, absPath, 'decode', err);
    return null;
  }

  let result: StructuralScanResult;
  try {
    result = scanSourceFileStructural(absPath, content);
  } catch (err) {
    recordScanError(ctx, absPath, 'structural_scan', err);
    return null;
  }

  try {
    ctx.stmts.insertFile.run(absPath, sourceHash, lineCount, nowIso());
  } catch (err) {
    recordScanError(ctx, absPath, 'insert_file', err);
    return null;
  }

  const lang = langOf(absPath);
  const docstringMap = lang === 'unknown'
    ? new Map()
    : (() => {
        try {
          return extractDocstrings(
            lang as 'ts' | 'js' | 'py' | 'cs' | 'cpp',
            content,
            result.methods.map((m) => ({ name: m.name, start_line: m.start_line, end_line: m.end_line })),
          );
        } catch (err) {
          recordScanError(ctx, absPath, 'docstrings', err);
          return new Map();
        }
      })();

  const rows: SourceMethodRow[] = [];
  const methodNames: string[] = [];
  const stepContents: string[] = [];

  const insertMethod = ctx.stmts.insertMethod;
  const insertStep = ctx.stmts.insertStep;
  const insertCall = ctx.stmts.insertCall;

  for (const m of result.methods) {
    const normParams = m.normalized_params || normalizeParams(m.raw_params);
    const id = computeMethodId({
      file_path: absPath,
      enclosing_class: m.enclosing_class,
      name: m.name,
      normalized_params: normParams,
    });
    const fp = computeBodyFingerprint(m.body ?? '');

    try {
      insertMethod.run(
        id,
        absPath,
        m.enclosing_class ?? null,
        m.name,
        normParams,
        fp,
        m.is_async ? 1 : 0,
        m.is_exported ? 1 : 0,
        m.start_line,
        m.end_line,
      );
    } catch (err) {
      recordScanError(ctx, absPath, 'insert_method', err);
      continue;
    }

    rows.push({
      id,
      file_path: absPath,
      enclosing_class: m.enclosing_class ?? null,
      name: m.name,
      normalized_params: normParams,
      body_fingerprint: fp,
    });
    methodNames.push(m.name);

    const doc = docstringMap.get(m.name);
    if (doc && 'steps' in doc) {
      for (const s of doc.steps) {
        try {
          insertStep.run(id, s.order, s.content);
          stepContents.push(s.content);
        } catch (err) {
          recordScanError(ctx, absPath, 'insert_step', err);
        }
      }
    }

    if (Array.isArray(m.call_edges)) {
      for (const edge of m.call_edges) {
        try {
          insertCall.run(id, edge.callee_name, edge.receiver_hint ?? null, absPath);
        } catch (err) {
          recordScanError(ctx, absPath, 'insert_call', err);
        }
      }
    }
  }

  if (Array.isArray(result.imports)) {
    const insertImport = ctx.stmts.insertImport;
    for (const imp of result.imports) {
      try {
        insertImport.run(absPath, imp.imported_path);
      } catch (err) {
        recordScanError(ctx, absPath, 'insert_import', err);
      }
    }
  }

  let fileTitle = '';
  let filePurpose = '';
  for (const m of result.methods) {
    const doc = docstringMap.get(m.name);
    if (doc && 'title' in doc) {
      fileTitle = doc.title || '';
      filePurpose = doc.purpose || '';
      break;
    }
  }
  if (fileTitle || filePurpose) {
    try {
      ctx.stmts.updateFileHeuristic.run(fileTitle, filePurpose, absPath);
    } catch (err) {
      recordScanError(ctx, absPath, 'update_file_heuristic', err);
    }
  }

  return { filePath: absPath, rows, methodNames, stepContents, title: fileTitle, purpose: filePurpose, stub: false };
}

function applyOverlay(db: Database, overlay: OverlayResult): void {
  const updateMethod = db.prepare(
    `UPDATE methods SET prose_origin = ?, match_quality = ?, warning = ? WHERE id = ?`,
  );
  const deleteSteps = db.prepare(`DELETE FROM method_steps WHERE method_id = ?`);
  const insertStep = db.prepare(
    `INSERT INTO method_steps(method_id, "order", content) VALUES (?, ?, ?)`,
  );
  const insertOverlayMatch = db.prepare(
    `INSERT INTO overlay_matches(method_row_id, quality, warning) VALUES (?, ?, ?)`,
  );

  for (const match of overlay.matches) {
    const prose = overlay.attachedProse.get(match.method_row_id);
    if (!prose) continue;
    try {
      updateMethod.run(prose.prose_origin, match.quality, match.warning ?? null, match.method_row_id);
      deleteSteps.run(match.method_row_id);
      for (const step of prose.steps) {
        insertStep.run(match.method_row_id, step.order, step.content);
      }
      insertOverlayMatch.run(match.method_row_id, match.quality, match.warning ?? null);
    } catch (err) {
      console.warn('[pseudo-indexer] applyOverlay error for', match.method_row_id, err);
    }
  }

  const insertOrphan = db.prepare(
    `INSERT OR REPLACE INTO orphan_prose(prose_file_path, source_path, status, suggestions) VALUES (?, ?, 'orphan-candidate', ?)`,
  );
  for (const orph of overlay.orphans) {
    try {
      insertOrphan.run(
        orph.prose_file,
        orph.prose_method.id,
        JSON.stringify(orph.suggestions.map((s) => ({
          method_id: s.source.id,
          file_path: s.source.file_path,
          name: s.source.name,
          score: s.score,
          reason: s.reason,
        }))),
      );
    } catch (err) {
      console.warn('[pseudo-indexer] insert orphan_prose failed:', err);
    }
  }
}

function populateFtsFor(db: Database, outcomes: FileScanOutcome[]): void {
  ensureFtsMapTable(db);
  for (const o of outcomes) {
    if (o.stub) continue;
    let stepContent = '';
    try {
      const rows = db.query(
        `SELECT ms.content AS content
           FROM method_steps ms
           JOIN methods m ON m.id = ms.method_id
          WHERE m.file_path = ?
          ORDER BY m."start_line", ms."order"`,
      ).all(o.filePath) as Array<{ content: string }>;
      stepContent = rows.map((r) => r.content).join('\n');
    } catch (err) {
      console.warn('[pseudo-indexer] FTS step_content fetch failed for', o.filePath, err);
    }

    let title = o.title;
    let purpose = o.purpose;
    try {
      const fr = db.query(`SELECT title, purpose FROM files WHERE file_path = ?`).get(o.filePath) as { title?: string; purpose?: string } | undefined;
      if (fr) {
        title = fr.title ?? title;
        purpose = fr.purpose ?? purpose;
      }
    } catch {}

    upsertFileFts(db, {
      file_path: o.filePath,
      title,
      purpose,
      step_content: stepContent,
      method_names: o.methodNames.join(' '),
    });
  }
}

async function loadAllProseFiles(project: string): Promise<Map<string, ProseFileV3>> {
  const out = new Map<string, ProseFileV3>();
  const proseRoot = join(project, PROSE_DIR_REL);
  const files = listProseFiles(proseRoot);
  for (const file of files) {
    try {
      const pf = await readProseFile(file, project);
      if (pf) out.set(file, pf);
    } catch (err) {
      console.warn('[pseudo-indexer] readProseFile failed:', file, err);
    }
  }
  return out;
}

function insertScanRun(db: Database, trigger: ScanTrigger): number {
  const result = db.run(
    `INSERT INTO scan_runs(trigger, status, started_at) VALUES (?, 'running', ?)`,
    [trigger, nowIso()],
  );
  return Number((result as any).lastInsertRowid);
}

function finishScanRun(
  db: Database,
  id: number,
  status: 'done' | 'failed' | 'cancelled',
  filesScanned: number,
  errors: number,
  errorMsg: string | null,
): ScanRun {
  db.run(
    `UPDATE scan_runs SET status = ?, finished_at = ?, files_scanned = ?, errors = ?, error_msg = ? WHERE id = ?`,
    [status, nowIso(), filesScanned, errors, errorMsg, id],
  );
  const row = db.query(
    `SELECT id, trigger, status, started_at, finished_at, files_scanned, errors, error_msg FROM scan_runs WHERE id = ?`,
  ).get(id) as ScanRun;
  return row;
}

export function createPseudoIndexer(project: string, db: Database): PseudoIndexer {
  let scanInFlight = false;
  let abortController: AbortController | null = null;

  function combinedSignal(extra?: AbortSignal): AbortSignal {
    abortController = new AbortController();
    if (extra) {
      if (extra.aborted) abortController.abort();
      else extra.addEventListener('abort', () => abortController?.abort(), { once: true });
    }
    return abortController.signal;
  }

  function checkAbort(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('pseudo-indexer scan aborted', 'AbortError');
    }
  }

  async function runFullScan(opts: ScanOptions): Promise<ScanRun> {
    if (scanInFlight) {
      throw new Error('pseudo-indexer: scan already in progress');
    }
    scanInFlight = true;

    const signal = combinedSignal(opts.signal);
    const scanRunId = insertScanRun(db, opts.trigger);
    const errorCount = { n: 0 };
    let filesScanned = 0;

    try {
      const stmts = prepareScanStmts(db);
      const ctx: ScanContext = { db, project, scanRunId, errorCount, stmts };
      const outcomes: FileScanOutcome[] = [];

      db.exec('BEGIN');
      try {
        db.exec(`DELETE FROM overlay_matches`);
        db.exec(`DELETE FROM orphan_prose`);
        db.exec(`DELETE FROM file_imports`);
        db.exec(`DELETE FROM method_calls`);
        db.exec(`DELETE FROM method_steps`);
        db.exec(`DELETE FROM methods`);
        db.exec(`DELETE FROM files`);
        clearFts(db);

        for await (const absPath of walkProject(project, { signal })) {
          checkAbort(signal);
          const outcome = await scanOneFile(ctx, absPath);
          if (outcome) {
            outcomes.push(outcome);
            filesScanned++;
          }
        }

        checkAbort(signal);
        const proseFiles = await loadAllProseFiles(project);
        const allRows = outcomes.flatMap((o) => o.rows);
        const overlay = overlayProseOnMethods(proseFiles, allRows);
        applyOverlay(db, overlay);

        checkAbort(signal);
        resolveCallEdges(db);

        checkAbort(signal);
        populateFtsFor(db, outcomes);
        db.exec('COMMIT');
      } catch (innerErr) {
        try { db.exec('ROLLBACK'); } catch {}
        throw innerErr;
      }

      await runReranking(opts);
      await runOrphanDetection(opts);

      const run = finishScanRun(db, scanRunId, 'done', filesScanned, errorCount.n, null);

      try {
        await writeSnapshot(db, project);
      } catch (err) {
        console.warn('[pseudo-indexer] writeSnapshot failed:', err);
      }

      return run;
    } catch (err) {
      const status: 'failed' | 'cancelled' = isAbortError(err) ? 'cancelled' : 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      try {
        finishScanRun(db, scanRunId, status, filesScanned, errorCount.n, msg);
      } catch (innerErr) {
        console.warn('[pseudo-indexer] finishScanRun failed:', innerErr);
      }
      throw err;
    } finally {
      scanInFlight = false;
      abortController = null;
    }
  }

  async function runIncrementalScan(paths: string[], opts: ScanOptions): Promise<ScanRun> {
    if (scanInFlight) {
      throw new Error('pseudo-indexer: scan already in progress');
    }
    scanInFlight = true;

    const signal = combinedSignal(opts.signal);
    const scanRunId = insertScanRun(db, opts.trigger);
    const errorCount = { n: 0 };
    let filesScanned = 0;

    try {
      const stmts = prepareScanStmts(db);
      const ctx: ScanContext = { db, project, scanRunId, errorCount, stmts };
      const outcomes: FileScanOutcome[] = [];

      db.exec('BEGIN');
      try {
        for (const absPath of paths) {
          checkAbort(signal);
          try {
            deleteFileRows(db, absPath);
            deleteFileFts(db, absPath);
          } catch (err) {
            recordScanError(ctx, absPath, 'delete_existing', err);
          }
          const outcome = await scanOneFile(ctx, absPath);
          if (outcome) {
            outcomes.push(outcome);
            filesScanned++;
          }
        }

        checkAbort(signal);
        const allProse = await loadAllProseFiles(project);
        const targetSet = new Set(paths.map((p) => p.replaceAll('\\', '/')));
        const relevantProse = new Map<string, ProseFileV3>();
        for (const [proseFilePath, pf] of allProse) {
          if (targetSet.has(pf.file.replaceAll('\\', '/'))) {
            relevantProse.set(proseFilePath, pf);
          }
        }
        const allRows = outcomes.flatMap((o) => o.rows);
        const overlay = overlayProseOnMethods(relevantProse, allRows);
        applyOverlay(db, overlay);

        checkAbort(signal);
        resolveCallEdges(db, { scopeFiles: paths });

        checkAbort(signal);
        populateFtsFor(db, outcomes);
        db.exec('COMMIT');
      } catch (innerErr) {
        try { db.exec('ROLLBACK'); } catch {}
        throw innerErr;
      }

      const run = finishScanRun(db, scanRunId, 'done', filesScanned, errorCount.n, null);
      return run;
    } catch (err) {
      const status: 'failed' | 'cancelled' = isAbortError(err) ? 'cancelled' : 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      try {
        finishScanRun(db, scanRunId, status, filesScanned, errorCount.n, msg);
      } catch (innerErr) {
        console.warn('[pseudo-indexer] finishScanRun failed:', innerErr);
      }
      throw err;
    } finally {
      scanInFlight = false;
      abortController = null;
    }
  }

  async function runIncrementalScanForFile(path: string, opts: ScanOptions): Promise<void> {
    await runIncrementalScan([path], opts);
  }

  async function runReranking(_opts: ScanOptions): Promise<void> {
    // Stub for pseudo-ranking wave.
  }

  async function runOrphanDetection(_opts: ScanOptions): Promise<{ crossBranch: string[]; actualOrphans: string[] }> {
    // Stub for pseudo-orphan wave.
    return { crossBranch: [], actualOrphans: [] };
  }

  function cancel(): void {
    abortController?.abort();
  }

  return {
    runFullScan,
    runIncrementalScan,
    runIncrementalScanForFile,
    runReranking,
    runOrphanDetection,
    cancel,
  };
}
