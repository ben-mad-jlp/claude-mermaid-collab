// V6 port of V2's `resolveCalleesForFile` (see pseudo-db.ts:614) — resolves method_calls edges across the whole DB in 6 SQL rounds of decreasing specificity.

import type { Database, Statement } from 'bun:sqlite';

export type ResolutionQuality =
  | 'exact'
  | 'same_file'
  | 'class'
  | 'same_dir'
  | 'import'
  | 'ambiguous'
  | 'unresolved';

export interface ResolverReport {
  totalEdges: number;
  resolved: number;
  byQuality: Record<ResolutionQuality, number>;
  durationMs: number;
}

export interface ResolveCallEdgesOptions {
  /** Optional: limit resolution to calls whose caller lives in these files (incremental mode). */
  scopeFiles?: string[];
}

const ALL_QUALITIES: ResolutionQuality[] = [
  'exact',
  'same_file',
  'class',
  'same_dir',
  'import',
  'ambiguous',
  'unresolved',
];

// Cache for always-fixed prepared statements (SQL text does not depend on scope).
// Scoped per-DB via WeakMap so disposed databases get GC'd along with their statements.
interface FixedStmts {
  nullCleanup: Statement<unknown>;
}
const stmtCache = new WeakMap<Database, FixedStmts>();

function getFixedStatements(db: Database): FixedStmts {
  let cached = stmtCache.get(db);
  if (!cached) {
    cached = {
      nullCleanup: db.prepare(
        `UPDATE method_calls
           SET resolution_quality = 'unresolved'
         WHERE callee_method_id IS NULL
           AND resolution_quality NOT IN ('ambiguous', 'unresolved')`
      ),
    };
    stmtCache.set(db, cached);
  }
  return cached;
}

export function resolveCallEdges(
  db: Database,
  opts?: ResolveCallEdgesOptions
): ResolverReport {
  const fixed = getFixedStatements(db);
  fixed.nullCleanup.run();

  const scopeFiles = opts?.scopeFiles;
  const hasScope = Array.isArray(scopeFiles) && scopeFiles.length > 0;

  // Build the scope predicate (and the params needed to bind it).
  // When no scope is provided, the predicate is an empty string.
  const scopePlaceholders = hasScope
    ? scopeFiles!.map(() => '?').join(', ')
    : '';
  const scopePredicate = hasScope
    ? ` AND caller_method_id IN (SELECT id FROM methods WHERE file_path IN (${scopePlaceholders}))`
    : '';
  const scopeParams: string[] = hasScope ? [...scopeFiles!] : [];

  // Reset: nullify callee_method_id and set resolution_quality='unresolved' for
  // everything in scope so re-scans on the same scope don't double-resolve.
  const resetSql =
    `UPDATE method_calls
        SET callee_method_id = NULL, resolution_quality = 'unresolved'` +
    (hasScope
      ? ` WHERE caller_method_id IN (SELECT id FROM methods WHERE file_path IN (${scopePlaceholders}))`
      : '');
  const resetStmt = db.prepare(resetSql);

  // Round 1: exact — unique name match across whole project
  const round1Stmt = db.prepare(
    `UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m WHERE m.name = method_calls.callee_name
          GROUP BY m.name HAVING COUNT(*) = 1
        ),
            resolution_quality = 'exact'
      WHERE callee_method_id IS NULL
        AND (
          SELECT m.id FROM methods m WHERE m.name = method_calls.callee_name
          GROUP BY m.name HAVING COUNT(*) = 1
        ) IS NOT NULL` + scopePredicate
  );

  // Round 2: same_file — caller and callee in same file
  const round2Stmt = db.prepare(
    `UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.file_path = (
               SELECT caller.file_path FROM methods caller
                WHERE caller.id = method_calls.caller_method_id
             )
           LIMIT 1
        ),
            resolution_quality = 'same_file'
      WHERE callee_method_id IS NULL
        AND (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.file_path = (
               SELECT caller.file_path FROM methods caller
                WHERE caller.id = method_calls.caller_method_id
             )
           LIMIT 1
        ) IS NOT NULL` + scopePredicate
  );

  // Round 3: class — receiver_hint matches methods.enclosing_class
  const round3Stmt = db.prepare(
    `UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.enclosing_class = method_calls.callee_name_hint
           LIMIT 1
        ),
            resolution_quality = 'class'
      WHERE callee_method_id IS NULL
        AND callee_name_hint IS NOT NULL
        AND (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.enclosing_class = method_calls.callee_name_hint
           LIMIT 1
        ) IS NOT NULL` + scopePredicate
  );

  // Round 4: same_dir — callee is_exported, same directory as caller
  const round4Stmt = db.prepare(
    `UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.is_exported = 1
             AND (
               SELECT rtrim(caller.file_path, replace(caller.file_path, '/', ''))
                 FROM methods caller WHERE caller.id = method_calls.caller_method_id
             ) = rtrim(m.file_path, replace(m.file_path, '/', ''))
           LIMIT 1
        ),
            resolution_quality = 'same_dir'
      WHERE callee_method_id IS NULL
        AND (
          SELECT m.id FROM methods m
           WHERE m.name = method_calls.callee_name
             AND m.is_exported = 1
             AND (
               SELECT rtrim(caller.file_path, replace(caller.file_path, '/', ''))
                 FROM methods caller WHERE caller.id = method_calls.caller_method_id
             ) = rtrim(m.file_path, replace(m.file_path, '/', ''))
           LIMIT 1
        ) IS NOT NULL` + scopePredicate
  );

  // Round 5: import — caller's file_imports links to callee's file, callee is_exported
  const round5Stmt = db.prepare(
    `UPDATE method_calls
        SET callee_method_id = (
          SELECT m.id FROM methods m
           JOIN file_imports fi
             ON fi.file_path = (SELECT c.file_path FROM methods c WHERE c.id = method_calls.caller_method_id)
          WHERE m.name = method_calls.callee_name
            AND m.is_exported = 1
            AND m.file_path LIKE '%' || fi.imported_path || '%'
          LIMIT 1
        ),
            resolution_quality = 'import'
      WHERE callee_method_id IS NULL
        AND (
          SELECT m.id FROM methods m
           JOIN file_imports fi
             ON fi.file_path = (SELECT c.file_path FROM methods c WHERE c.id = method_calls.caller_method_id)
          WHERE m.name = method_calls.callee_name
            AND m.is_exported = 1
            AND m.file_path LIKE '%' || fi.imported_path || '%'
          LIMIT 1
        ) IS NOT NULL` + scopePredicate
  );

  // Round 6: ambiguous | unresolved — mark leftovers
  const round6Stmt = db.prepare(
    `UPDATE method_calls
        SET resolution_quality = CASE
          WHEN (SELECT COUNT(*) FROM methods m WHERE m.name = method_calls.callee_name) > 1
            THEN 'ambiguous'
          ELSE 'unresolved'
        END
      WHERE callee_method_id IS NULL` + scopePredicate
  );

  // Final count aggregator for the report.
  const countSql =
    `SELECT resolution_quality AS q, COUNT(*) AS c
       FROM method_calls` +
    (hasScope
      ? ` WHERE caller_method_id IN (SELECT id FROM methods WHERE file_path IN (${scopePlaceholders}))`
      : '') +
    ` GROUP BY resolution_quality`;
  const countStmt = db.prepare(countSql);

  const started = Date.now();

  resetStmt.run(...scopeParams);
  round1Stmt.run(...scopeParams);
  round2Stmt.run(...scopeParams);
  round3Stmt.run(...scopeParams);
  round4Stmt.run(...scopeParams);
  round5Stmt.run(...scopeParams);
  round6Stmt.run(...scopeParams);

  const durationMs = Date.now() - started;

  const rows = countStmt.all(...scopeParams) as Array<{
    q: ResolutionQuality;
    c: number;
  }>;

  const byQuality: Record<ResolutionQuality, number> = {
    exact: 0,
    same_file: 0,
    class: 0,
    same_dir: 0,
    import: 0,
    ambiguous: 0,
    unresolved: 0,
  };
  let totalEdges = 0;
  for (const row of rows) {
    if (ALL_QUALITIES.includes(row.q)) {
      byQuality[row.q] = row.c;
    }
    totalEdges += row.c;
  }

  const resolved =
    byQuality.exact +
    byQuality.same_file +
    byQuality.class +
    byQuality.same_dir +
    byQuality.import;

  return {
    totalEdges,
    resolved,
    byQuality,
    durationMs,
  };
}
