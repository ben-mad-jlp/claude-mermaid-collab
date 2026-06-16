# Bug Review Round 3

## Bug 1 (Critical): SQL `rtrim` file stem extraction is fundamentally broken

**Severity:** Critical
**Files+Lines:** `src/services/pseudo-db.ts` lines 412, 477, 514
**Methods affected:** `getCallGraph()`, `getImpactAnalysis()`, `getOrphanFunctions()`

**What's wrong:**
The SQL expression used to extract a file stem from a path:
```sql
replace(replace(f.file_path, rtrim(f.file_path, replace(f.file_path, '/', '')), ''), '.pseudo', '')
```
is incorrect. SQLite's `rtrim(X, Y)` removes individual **characters** in Y from the right of X, not a substring. When filename characters overlap with directory characters (which is almost always the case), it trims too aggressively.

**Example:**
- Path: `src/services/service.pseudo`
- `replace(path, '/', '')` = `srcservicesservice.pseudo` (these become the trim characters)
- `rtrim('src/services/service.pseudo', 'srcservicesservice.pseudo')` strips chars `{s,r,c,e,v,i,.,p,u,d,o}` from the right -- this removes far more than just the filename, potentially leaving an empty string or a truncated prefix.

**Result:** Call graph edges, impact analysis, and orphan detection silently produce wrong results for most real-world file paths.

**Fix:** Extract the stem in application code (TypeScript) instead of SQL, or use a correct SQL approach. For example, add a `file_stem` column to the `files` table computed at insert time, then JOIN on that column directly. Alternatively, compute stem in TS:
```typescript
// In getCallGraph, after fetching callRows:
const filesByStem = new Map<string, string>();
for (const node of methodRows) {
  const stem = r.file_path.split('/').pop()?.replace('.pseudo', '') ?? '';
  filesByStem.set(stem, r.file_path);
}
```
Then resolve `callee_file_stem` against the map to build edges.

---

## Bug 2 (Medium): `bulkIngest` FTS cleanup runs outside transaction

**Severity:** Medium
**File+Line:** `src/services/pseudo-db.ts` lines 237-249

**What's wrong:**
The FTS entry deletion and `DELETE FROM files` execute **before** the transaction begins (line 251). If the transaction fails partway through inserting new data, the old FTS entries and file rows are already permanently deleted, leaving the database in an inconsistent/empty state.

**Fix:** Move lines 238-249 inside the transaction:
```typescript
bulkIngest(files: Array<{ filePath: string; content: string }>): void {
  const tx = this.db.transaction(() => {
    // FTS cleanup and DELETE FROM files go HERE, inside the transaction
    const allMethods = this.db.prepare(...).all() as any[];
    for (const m of allMethods) { ... }
    this.db.exec('DELETE FROM files');

    for (const file of files) { ... }
  });
  tx();
}
```

---

## Previously Fixed Bugs (Verified Correct)

- **FTS contentless DELETE syntax** (R2): Confirmed fixed. Uses `INSERT INTO pseudo_fts(pseudo_fts, rowid, ...) VALUES('delete', ...)` correctly in `upsertFile`, `deleteFile`, and `bulkIngest`.
- **FTS orphan cleanup in upsertFile** (R1): Confirmed fixed. FTS entries are deleted before cascade delete.
- **FTS query injection** (R1): Confirmed fixed. `search()` wraps query in escaped double quotes.
- **Orphan/impact stem-vs-path** (R2): These use the same broken `rtrim` SQL (Bug 1 above), so the R2 fix was incomplete -- it addressed the wrong root cause.
- **Call graph dangling edges** (R2): Fixed with `.filter(r => r.callee_file !== null)` on line 416, but still depends on the broken `rtrim` JOIN (Bug 1), so edges will be silently missing.

## No Issues Found In

- `src/services/pseudo-parser.ts` -- Parser logic is correct. Regex handles FUNCTION signatures properly. Step depth calculation and CALLS parsing are sound.
- `src/routes/pseudo-api.ts` -- API routing, parameter validation, and error handling are all correct. No null/undefined issues.