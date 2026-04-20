/**
 * Pseudo Migration — one-time v1 SQLite → v6 prose-files migration.
 *
 * Reads legacy .collab/pseudo/pseudo.db, reconstructs a ProseFileV3 per
 * prose-bearing source file, writes under .collab/pseudo/prose/,
 * drops legacy artifacts, writes .migrated flag. Idempotent.
 */

import Database from 'bun:sqlite';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, isAbsolute, relative, basename } from 'node:path';
import { computeMethodId, normalizeParams, computeBodyFingerprint } from './pseudo-id';
import { escapePath, toRelPosixPath } from './pseudo-path-escape';
import { readProseFile, writeProseFile, type ProseFileV3, type ProseMethod, type ProseStep } from './pseudo-prose-file';
import { scanSourceFileStructural, type StructuralMethod as ScannerMethod } from './source-scanner';

export interface MigrationReport {
  migrated: number;
  skipped: number;
  errors: Array<{ file_path: string; error: string }>;
}

interface LegacyFileRow {
  id: number;
  file_path: string;
  title: string;
  purpose: string;
  module_context: string;
  has_prose: number;
  prose_updated_at: string | null;
}
interface LegacyMethodRow {
  id: number;
  file_id: number;
  name: string;
  params: string;
  return_type: string;
  owning_symbol: string | null;
  source_line: number | null;
  source_line_end: number | null;
  step_count: number;
}
interface LegacyStepRow {
  method_id: number;
  content: string;
  depth: number;
  sort_order: number;
}

function pseudoDir(project: string): string {
  return join(project, '.collab', 'pseudo');
}
function legacyDbPath(project: string): string {
  return join(pseudoDir(project), 'pseudo.db');
}
function proseDir(project: string): string {
  return join(pseudoDir(project), 'prose');
}
function migrationFlagPath(project: string): string {
  return join(pseudoDir(project), '.migrated');
}
function relMigrationFlagPath(project: string): string {
  return join(pseudoDir(project), '.migrated-rel');
}
function orphanDir(project: string): string {
  return join(proseDir(project), '_orphan');
}

export async function runMigrationFromV1(project: string): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: 0, skipped: 0, errors: [] };

  if (existsSync(migrationFlagPath(project))) return report;

  const dbPath = legacyDbPath(project);
  if (!existsSync(dbPath)) return report;

  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    report.errors.push({ file_path: dbPath, error: `open failed: ${(err as Error).message}` });
    return report;
  }

  try {
    const tableNames = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as Array<{ name: string }>).map((r) => r.name);
    if (!tableNames.includes('files') || !tableNames.includes('methods')) {
      return report;
    }

    const fileRows = db.prepare(`
      SELECT id, file_path, title, purpose, module_context, has_prose, prose_updated_at
      FROM files
      WHERE has_prose = 1
    `).all() as LegacyFileRow[];

    const methodsStmt = db.prepare(`
      SELECT id, file_id, name, params, return_type, owning_symbol,
             source_line, source_line_end, step_count
      FROM methods
      WHERE file_id = ?
    `);
    const stepsStmt = db.prepare(`
      SELECT method_id, content, depth, sort_order
      FROM method_steps
      WHERE method_id = ?
      ORDER BY sort_order
    `);

    for (const fr of fileRows) {
      try {
        const methodRows = methodsStmt.all(fr.id) as LegacyMethodRow[];

        const absSource = isAbsolute(fr.file_path) ? fr.file_path : join(project, fr.file_path);

        let scannerMethods: ScannerMethod[] = [];
        if (existsSync(absSource)) {
          try {
            const src = readFileSync(absSource, 'utf8');
            scannerMethods = scanSourceFileStructural(absSource, src).methods;
          } catch {
            scannerMethods = [];
          }
        }

        const bodyByKey = new Map<string, string>();
        for (const sm of scannerMethods) {
          const key = `${sm.name}||${sm.normalized_params}`;
          bodyByKey.set(key, sm.body);
        }

        const proseMethods: ProseMethod[] = [];

        for (const m of methodRows) {
          const stepRows = stepsStmt.all(m.id) as LegacyStepRow[];
          if (stepRows.length === 0) continue;

          const normalized = normalizeParams(m.params ?? '');
          const enclosing_class = m.owning_symbol && m.owning_symbol.length > 0 ? m.owning_symbol : null;

          let body = bodyByKey.get(`${m.name}||${normalized}`);
          if (body == null) {
            const candidates = scannerMethods.filter((sm) => sm.name === m.name);
            if (candidates.length === 1) body = candidates[0].body;
          }
          const body_fingerprint = computeBodyFingerprint(body ?? '');

          const id = computeMethodId({
            file_path: absSource,
            enclosing_class,
            name: m.name,
            normalized_params: normalized,
          });

          const steps: ProseStep[] = stepRows.map((s, i) => ({
            order: i,
            content: s.content,
          }));

          proseMethods.push({
            id,
            name: m.name,
            enclosing_class,
            normalized_params: normalized,
            body_fingerprint,
            prose_origin: 'manual',
            steps,
            tags: { deprecated: false },
          });
        }

        const hasFileLevelProse =
          (fr.title?.length ?? 0) > 0 ||
          (fr.purpose?.length ?? 0) > 0 ||
          (fr.module_context?.length ?? 0) > 0;
        if (proseMethods.length === 0 && !hasFileLevelProse) {
          report.skipped++;
          continue;
        }

        let relPath: string;
        try {
          relPath = toRelPosixPath(project, fr.file_path);
        } catch {
          relPath = toRelPosixPath(project, absSource);
        }

        const v3: ProseFileV3 = {
          schema_version: 3,
          file: relPath,
          title: fr.title ?? '',
          purpose: fr.purpose ?? '',
          module_context: fr.module_context ?? '',
          methods: proseMethods,
        };

        const escaped = escapePath(relPath);
        const outPath = join(proseDir(project), escaped + '.json');
        await writeProseFile(outPath, v3);

        report.migrated++;
      } catch (err) {
        report.errors.push({
          file_path: fr.file_path,
          error: (err as Error).message,
        });
      }
    }
  } finally {
    try { db.close(); } catch {}
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) {
      try { unlinkSync(p); } catch {}
    }
  }

  try {
    mkdirSync(pseudoDir(project), { recursive: true });
    writeFileSync(
      migrationFlagPath(project),
      JSON.stringify({
        migrated_at: new Date().toISOString(),
        migrated: report.migrated,
        skipped: report.skipped,
        error_count: report.errors.length,
      }, null, 2),
    );
  } catch (err) {
    report.errors.push({
      file_path: migrationFlagPath(project),
      error: `flag write failed: ${(err as Error).message}`,
    });
  }

  return report;
}

export interface RelMigrationReport {
  migrated: number;
  orphaned: number;
  skipped: number;
  failed: number;
  errors: Array<{ file_path: string; error: string }>;
}

/**
 * Fallback path recovery: given an absolute path authored on a different
 * machine (e.g. `/Users/foo/Code/proj/src/x.ts`), walk its segments from
 * longest suffix down to shortest and return the first suffix that resolves
 * to an existing file under `project`. Returns null if no match.
 */
function recoverRelPathBySuffix(project: string, input: string): string | null {
  const segs = input.replace(/\\/g, '/').split('/').filter((s) => s.length > 0);
  for (let i = 1; i < segs.length; i++) {
    const suffix = segs.slice(i).join('/');
    if (existsSync(join(project, suffix))) return suffix;
  }
  return null;
}

export async function migrateProseFilesToRelative(project: string): Promise<RelMigrationReport> {
  const report: RelMigrationReport = { migrated: 0, orphaned: 0, skipped: 0, failed: 0, errors: [] };

  const sentinel = relMigrationFlagPath(project);
  if (existsSync(sentinel)) return report;

  const dir = proseDir(project);
  if (!existsSync(dir)) {
    try {
      mkdirSync(pseudoDir(project), { recursive: true });
      writeFileSync(sentinel, JSON.stringify({ migrated_at: new Date().toISOString(), migrated: 0, orphaned: 0 }, null, 2));
    } catch {}
    return report;
  }

  const jsonFiles: string[] = [];
  function walk(curr: string, insideOrphan: boolean): void {
    let entries: string[];
    try { entries = readdirSync(curr); } catch { return; }
    for (const name of entries) {
      const full = join(curr, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === '_attic') continue;
        walk(full, insideOrphan || name === '_orphan');
      } else if (st.isFile() && name.endsWith('.json') && name !== '_path_map.json') {
        jsonFiles.push(full);
      }
    }
  }
  walk(dir, false);

  for (const oldPath of jsonFiles) {
    let prose: ProseFileV3 | null;
    try {
      prose = await readProseFile(oldPath);
    } catch (err) {
      report.failed++;
      report.errors.push({ file_path: oldPath, error: `read/validate failed: ${(err as Error).message}` });
      continue;
    }
    if (!prose || prose.schema_version !== 3) {
      report.skipped++;
      continue;
    }

    const currentFile = prose.file;
    const alreadyRel =
      !isAbsolute(currentFile) &&
      !currentFile.includes('\\') &&
      !currentFile.startsWith('..') &&
      !/^[A-Za-z]:[/\\]/.test(currentFile);
    if (alreadyRel) {
      report.skipped++;
      continue;
    }

    let rel: string;
    try {
      rel = toRelPosixPath(project, currentFile);
    } catch {
      const recovered = recoverRelPathBySuffix(project, currentFile);
      if (recovered) {
        rel = recovered;
      } else {
        try {
          mkdirSync(orphanDir(project), { recursive: true });
          const dest = join(orphanDir(project), basename(oldPath));
          if (oldPath !== dest) renameSync(oldPath, dest);
          report.orphaned++;
        } catch (err) {
          report.failed++;
          report.errors.push({ file_path: oldPath, error: `orphan move failed: ${(err as Error).message}` });
        }
        continue;
      }
    }

    const rewritten: ProseFileV3 = { ...prose, file: rel };
    const newPath = join(dir, escapePath(rel) + '.json');

    try {
      await writeProseFile(newPath, rewritten);
      if (newPath !== oldPath && existsSync(oldPath)) {
        try { unlinkSync(oldPath); } catch {}
      }
      report.migrated++;
    } catch (err) {
      report.failed++;
      report.errors.push({ file_path: oldPath, error: `rewrite failed: ${(err as Error).message}` });
    }
  }

  if (report.failed === 0) {
    try {
      mkdirSync(pseudoDir(project), { recursive: true });
      writeFileSync(
        sentinel,
        JSON.stringify({
          migrated_at: new Date().toISOString(),
          migrated: report.migrated,
          orphaned: report.orphaned,
          skipped: report.skipped,
          error_count: report.errors.length,
        }, null, 2),
      );
    } catch (err) {
      report.errors.push({
        file_path: sentinel,
        error: `sentinel write failed: ${(err as Error).message}`,
      });
    }
  } else {
    console.warn(
      '[pseudo-migration] %d files failed; sentinel not written — will retry on next run',
      report.failed,
    );
  }

  return report;
}
