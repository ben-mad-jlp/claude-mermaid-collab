# Bug Review Round 2

## Bug 1 — FTS5 contentless table: DELETE not supported (HIGH)

**File:** `src/services/pseudo-db.ts`, lines 122-126, 166, 213, 221

**What's wrong:** The FTS5 table `pseudo_fts` is declared with `content=''` (contentless). For contentless FTS5 tables, `DELETE FROM pseudo_fts WHERE rowid IN (...)` does NOT work — FTS5 cannot look up the original content to update the index. The correct way to remove entries from a contentless FTS5 table is the special delete syntax:
```sql
INSERT INTO pseudo_fts(pseudo_fts, rowid, method_name, step_content) VALUES('delete', ?, ?, ?)
```
passing the original column values. This affects three places:

1. `upsertFile()` line 166 — FTS cleanup before re-insert
2. `deleteFile()` line 213 — FTS cleanup before cascade delete
3. `bulkIngest()` line 221 — `DELETE FROM pseudo_fts` to clear all entries

**Impact:** FTS cleanup silently fails or errors, leaving stale entries. Search results will contain duplicates and ghost entries for updated/deleted files.

**Fix:** For individual deletes, query the original method_name and step_content before deleting, then use the special `INSERT ... VALUES('delete', ...)` syntax. For bulk clear, either `DROP TABLE IF EXISTS pseudo_fts` + recreate, or use `INSERT INTO pseudo_fts(pseudo_fts) VALUES('rebuild')` after repopulating.

---

## Bug 2 — getOrphanFunctions: file_stem vs file_path mismatch (HIGH)

**File:** `src/services/pseudo-db.ts`, line 483

**What's wrong:** The JOIN condition `mc.callee_file_stem = f.file_path` compares a file stem (e.g., `"http-transport"`) against a full relative path (e.g., `"src/services/http-transport.pseudo"`). These will never match, so the LEFT JOIN always produces NULL, making every non-exported method appear as an orphan.

**Fix:** Either extract the stem from `file_path` in SQL:
```sql
AND mc.callee_file_stem = REPLACE(REPLACE(f.file_path, RTRIM(f.file_path, REPLACE(f.file_path, '/', '')), ''), '.pseudo', '')
```
Or better, store the file_stem in the `files` table and join on that, or normalize the callee_file_stem at ingest time to match file_path format.

---

## Bug 3 — getImpactAnalysis: same file_stem vs file_path mismatch (HIGH)

**File:** `src/services/pseudo-db.ts`, line 448

**What's wrong:** The recursive CTE's second branch joins `mc2.callee_file_stem = f_match.file_path`. Same mismatch as Bug 2 — `callee_file_stem` holds a bare stem while `file_path` is a full relative path. The recursive step will never produce results, so transitive impact analysis always returns empty.

**Fix:** Same approach as Bug 2 — normalize the comparison so stems match paths.

---

## Bug 4 — getCallGraph edge targets use file_stem, nodes use file_path (MEDIUM)

**File:** `src/services/pseudo-db.ts`, lines 371 vs 389

**What's wrong:** Node IDs are constructed as `${file_path}::${name}` (e.g., `"src/services/foo.pseudo::bar"`), but edge targets are `${callee_file_stem}::${callee_name}` (e.g., `"foo::bar"`). Edge targets will never match any node ID, so the graph has dangling edges that don't connect to nodes.

**Impact:** The `/api/pseudo/graph` endpoint returns a graph where edges point to non-existent nodes. The `/api/pseudo/diagram` Mermaid output will have arrows to undefined nodes.

**Fix:** Resolve `callee_file_stem` to the actual `file_path` via a JOIN when building edges:
```sql
SELECT m.name as caller_name, f.file_path as caller_file,
  mc.callee_name, f2.file_path as callee_file
FROM method_calls mc
JOIN methods m ON m.id = mc.caller_method_id
JOIN files f ON f.id = m.file_id
LEFT JOIN files f2 ON f2.file_path LIKE '%/' || mc.callee_file_stem || '.pseudo'
```

---

## Bug 5 — pseudo_call_chain BFS: ID format mismatch (MEDIUM)

**File:** `src/mcp/setup.ts`, lines 3467-3468

**What's wrong:** The BFS constructs `sourceId = ${from_file}::${from_function}` using the user-supplied `from_file` param (described as "Source file stem" in the schema). But node IDs in the graph use full `file_path`. If the user passes a stem (as the schema suggests), BFS will never find the source/target node. If the user passes a full path, it works for source but edge targets still use stems (Bug 4), so traversal breaks at the first hop.

**Fix:** Depends on fixing Bug 4 first. Then update the schema description to clarify whether `from_file`/`to_file` should be file stems or full paths, and normalize accordingly.

---

## Summary

| # | Severity | File | Bug |
|---|----------|------|-----|
| 1 | HIGH | pseudo-db.ts | FTS5 contentless DELETE not supported — stale search results |
| 2 | HIGH | pseudo-db.ts | getOrphanFunctions compares stem to path — all non-exports appear orphaned |
| 3 | HIGH | pseudo-db.ts | getImpactAnalysis compares stem to path — transitive analysis always empty |
| 4 | MEDIUM | pseudo-db.ts | getCallGraph edge targets use stem, nodes use path — dangling edges |
| 5 | MEDIUM | setup.ts | pseudo_call_chain BFS IDs mismatch graph node IDs — never finds path |
