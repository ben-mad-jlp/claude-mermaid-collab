# Bug Review

## Bug 1 — FTS orphan rows on upsertFile and deleteFile

- **Severity:** Critical
- **File:** `src/services/pseudo-db.ts`, lines 158-195 (upsertFile) and 197-199 (deleteFile)
- **What's wrong:** The FTS table `pseudo_fts` uses `content=''` (contentless mode). In contentless FTS5, rows are NOT automatically deleted when the underlying data is removed — you must explicitly issue a delete command using `INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)` before removing the source rows. Neither `upsertFile` nor `deleteFile` does this. Every upsert accumulates stale FTS entries, causing search to return phantom results that no longer exist in the methods table (filtered out by the `method?.file_path` null check, but degrading search quality and performance over time).
- **Fix:** Before deleting from `files` in both `upsertFile` and `deleteFile`, query existing method IDs and their FTS content, then issue FTS delete commands for each:
  ```ts
  // In upsertFile, before DELETE FROM files:
  const oldMethods = this.db.prepare(
    `SELECT m.id, m.name, GROUP_CONCAT(ms.content, ' ') as steps
     FROM methods m
     JOIN files f ON f.id = m.file_id
     LEFT JOIN method_steps ms ON ms.method_id = m.id
     WHERE f.file_path = ?
     GROUP BY m.id`
  ).all(filePath) as any[];
  for (const om of oldMethods) {
    this.db.prepare(
      "INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)"
    ).run(om.id, om.name, om.steps ?? '');
  }
  ```
  Apply the same pattern in `deleteFile`.

## Bug 2 — FTS query injection in pseudo-db search()

- **Severity:** Important
- **File:** `src/services/pseudo-db.ts`, line 308
- **What's wrong:** The `search(query)` method passes the raw user query directly to `FTS5 MATCH ?`. FTS5 has its own query syntax with operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `"`, `{`, etc.). Malformed input like `"unclosed quote` or `AND` will throw a SQLite error, crashing the request. Compare to `onboarding-db.ts` line 179 which correctly wraps: `const safeQ = '"' + q.replace(/"/g, '""') + '"'`.
- **Fix:** Sanitize the query before passing to MATCH:
  ```ts
  const safeQuery = `"${query.replace(/"/g, '""')}"`;
  ```
  Then use `safeQuery` in the `.all()` call.

## Bug 3 — getOrphanFunctions false negatives from ambiguous name matching

- **Severity:** Minor
- **File:** `src/services/pseudo-db.ts`, lines 454-467
- **What's wrong:** The LEFT JOIN matches `mc.callee_name = m.name` without also matching `mc.callee_file_stem`. If two files define methods with the same name and only one is called, both will appear as non-orphaned. This produces false negatives (truly orphaned functions not reported).
- **Fix:** The callee_file_stem in method_calls would need to be matched against the file's stem. This requires deriving the file stem from `f.file_path`:
  ```sql
  LEFT JOIN method_calls mc ON mc.callee_name = m.name
    AND mc.callee_file_stem = REPLACE(REPLACE(f.file_path, RTRIM(f.file_path, REPLACE(f.file_path, '/', '')), ''), '.pseudo', '')
  ```
  Or store a `file_stem` column on the `files` table for simpler joins.

## Bug 4 — Impact analysis recursive CTE ignores file_stem

- **Severity:** Minor
- **File:** `src/services/pseudo-db.ts`, lines 420-427
- **What's wrong:** The recursive step joins `mc2.callee_name = m_match.name` without filtering by `callee_file_stem`. When two files have same-named methods, the CTE may traverse incorrect call edges, producing spurious transitive impact results.
- **Fix:** Add `AND mc2.callee_file_stem = ...` to the recursive join, deriving the file stem from the matched file path.

## Bug 5 — Swallowed errors in background pseudo ingest

- **Severity:** Minor
- **File:** `src/server.ts`, lines 247-249 (the inner `catch {}`)
- **What's wrong:** The inner `try/catch` around individual `.pseudo` file reading and parsing silently swallows all errors with `catch {}`. If a file has a permissions issue or a parser bug, the failure is completely invisible — no log, no metric. The outer `catch` on the directory walk is similarly silent.
- **Fix:** Log errors at debug level:
  ```ts
  } catch (e) {
    console.warn(`[Pseudo ingest] Failed to process ${fullPath}:`, e);
  }
  ```

## Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Critical | pseudo-db.ts | FTS orphan rows on upsert/delete (contentless FTS5 not cleaned) |
| 2 | Important | pseudo-db.ts | Raw FTS query injection causes crashes on special chars |
| 3 | Minor | pseudo-db.ts | Orphan detection false negatives from ambiguous name match |
| 4 | Minor | pseudo-db.ts | Impact analysis traverses wrong edges for same-named methods |
| 5 | Minor | server.ts | Swallowed errors in background ingest hide failures |
