## Degradation Ledger (V2 → V6 response shapes)

During Wave 1 we discovered that V6's schema is materially narrower than V2's, so `pseudo-query.ts` cannot reproduce V2 responses byte-for-byte. Rather than widening V6 (a separate schema effort) we **synthesize** missing V2 fields with null / empty / default values. This ledger records every synthesized field so the silent contract erosion is explicit. UI-critical paths (`getFile`, `getSourceLink`, `getFunctionsForSource`) have been verified — the UI only reads fields V6 actually has.

**`files` rows:**
- `language` → `null` — V6 has no `language` column.
- `file_stem` → derived from `file_path` basename (no column; computed).
- `has_prose` → synthesized from `file_prose_origin !== 'none'`.
- `structural_indexed_at` → maps to V6's `scanned_at`.
- `prose_updated_at` → `null` (V6 tracks per-method, not per-file).
- `id` → `null` (V6 uses `file_path` as primary key; V2 had synthetic integer id).

**`methods` rows:**
- `params` → V6's `normalized_params` (semantic near-match, not identical).
- `return_type` → `''` (V6 does not capture return types).
- `visibility` → `null` (V6 does not capture public/private/protected).
- `kind` → `null` (V6 does not distinguish function/method/arrow).
- `date` → `null` (V6 has no `date` column; retires V2's "stale" feature).
- `owning_symbol` → `enclosing_class` (near-match).
- `param_count` → `0` (not stored; would require re-parse).
- `step_count` → `0` (not stored on method; derivable from `method_steps` count).
- `sort_order` → `0` (V6 relies on `start_line`).

**`method_steps` rows:**
- `depth` → `0` (V6 has no `depth` column; only `"order"` + `content`).

**`method_calls` rows:**
- `callee_file_stem` → `''` (V6 uses `callee_method_id` resolution instead).

**Search results:**
- `SearchResult.methodName` → `''` (V6 FTS is per-file, not per-method; search ranks by file).

**Source linking:**
- `SourceLinkCandidate.language` → `null`.
- `getSourceLink` returns `SourceLinkCandidate[]` (array, matching V2 behavior) — blueprint's "singular" description was wrong.

**Signature changes (not degradations):**
- `getMethodLocation` changes from V2's `(filePath, methodName)` to `(methodId)`. Wave 5 reroutes must rewrite callers in `code-api.ts:640`.
- `getStaleFunctions` is **deleted** (no V6 data to drive it). Any caller referencing it must be removed in Wave 5.

**Consequence.** Downstream consumers that read a nulled/zeroed field will get a silent miss, not a crash. The contract is "shape-compatible, data-degraded." Before retiring V2 (Wave 6), every HTTP/MCP consumer must be audited against this ledger to confirm no logic branches on a now-synthetic field. Two known-safe paths verified: UI renders `getFile`/`getSourceLink`/`getFunctionsForSource` correctly because it only touches fields V6 has.

---

# pseudo-db Unification and Call-Graph Repair — Design Doc

## Summary

Two pseudo-db implementations coexist in `src/services/pseudo-db.ts`: a legacy disk-backed **V2** (`PseudoDbService` / `getPseudoDb`) and a newer in-memory **V6** (`initPseudoDbV6` + modules: `pseudo-schema.ts`, `pseudo-indexer.ts`, `pseudo-overlay.ts`, `pseudo-prose-file.ts`, etc.). V2 has a working call-edge resolver (`resolveCalleesForFile`, `pseudo-db.ts:614`) but nothing populates it on mermaid-collab, so `methods` is empty. V6 has a working indexer producing 2109 methods but no call-edge resolver, so every `method_calls.callee_method_id` is `NULL` and all graph queries filtering on a non-null callee return nothing. The decision is to **unify on V6** — it is newer, has the richer schema, has overlay-based prose matching with quality tags, has a real indexer pipeline, and is already the indexer used by `src/mcp/setup.ts:824`. V2 becomes a compatibility shim over V6 (implementing V2's public surface by translating V6 tables into V2's response shapes) until all callers are migrated, then deleted. We add a call-edge resolver pass to V6 keyed on a new `callee_file_hint` column populated from the source scanner (ports V2's `callee_file_stem` approach into V6). We repair Bug 2 by storing ProseFileV3's `file` field as a **project-relative POSIX path** and placing prose files under a mirrored relative directory tree; a one-shot migration rewrites any existing absolute-path prose file.

## Current State

### How we got here

V2 (`PseudoDbService`, `SCHEMA_VERSION = 2` at `pseudo-db.ts:172`) is the original two-level (structural + prose) pseudo-db, on-disk at `.collab/pseudo/pseudo.db`. It expects callers to drive it: `upsertStructural()` is called per-file from `pseudo_index_structural` and `pseudo_index_project` MCP tools (`setup.ts:4052-4063`), and `upsertProse()` from the `/pseudocode` skill via `pseudo_upsert_prose` (`setup.ts:4111`). `resolveCalleesForFile()` runs inside `upsertProse`'s transaction (`pseudo-db.ts:560`) — which means call edges are *only* resolved for files that received prose, not for any structurally-indexed file. On a project that was never manually indexed through `pseudo_index_project`, V2's db is empty: `getPseudoDb(project)` creates the file lazily but nothing populates it.

V6 (`initPseudoDbV6`, `pseudo-db.ts:1252`) was introduced additively as an in-memory `:memory:` db with a real scan pipeline: `pseudo-indexer.ts` walks the project via `walkProject` (`source-scanner.ts:915`), runs `scanSourceFileStructural` per file, then overlays prose from `.collab/pseudo/prose/*.json` via `overlayProseOnMethods` (`pseudo-overlay.ts:188`). The indexer is kicked off at server startup (`setup.ts:824`, `initPseudoDbV6(cwd)`) and populates the db automatically. V6 lives alongside V2 because unification was deferred — V6 was added to provide better prose matching and orphan detection without breaking the many V2 consumers.

### What works (V6-native, verified)

- `pseudo_db_status` (`mcp/tools/pseudo-status.ts`) — reads files/methods counts, prose breakdown, scan_runs, orphan counts. **Working.**
- `pseudo_search` / `pseudo_find_function_v6` (`mcp/tools/pseudo-search.ts`) — FTS5 over V6's `pseudo_fts`. **Working**, but only returns hits against method names and docstring-derived steps since no method-level prose exists.
- `pseudo_hot_files`, `pseudo_list_heuristic_files`, `pseudo_team_ownership`, `pseudo_list_orphaned_prose`, `pseudo_cleanup_orphaned_prose`, `pseudo_get_file_state_v6`, `pseudo_reassign_prose`, `pseudo_reassign_prose_bulk`, `pseudo_rescan`, `pseudo_rerank`, `pseudo_upsert_prose_v6`, `pseudo_import_graph`, `pseudo_stats_delta`. All V6-routed. **Working** to the extent their data exists.

### What's broken

1. **V2-routed MCP tools return empty** because V2's db has zero rows:
   - `pseudo_find_function` (`setup.ts:3989`) → `db.search()` on empty FTS → `[]`
   - `pseudo_impact_analysis` (`setup.ts:3981`) → `getImpactAnalysis` on empty tables → `{direct:[], transitive:[]}`
   - `pseudo_call_chain` (`setup.ts:4007`) → empty path
   - `pseudo_coverage_report`, `pseudo_stale_check`, `pseudo_get_module_summary`, `pseudo_get_file_state` — all return empty/degraded
2. **V6-routed `pseudo_call_chain_v6`** returns empty because `pseudo-graph.ts:66` filters `WHERE callee_method_id IS NOT NULL`, and `pseudo-indexer.ts:127` hardcodes `callee_method_id = NULL` on insert with no resolution pass anywhere in the V6 code path. Grep for `SET callee_method_id` confirms only V2 has a resolver.
3. **HTTP routes in `src/routes/pseudo-api.ts` all use V2** via `getPseudoDb`. Every endpoint (`/files`, `/file`, `/search`, `/graph`, `/impact`, `/orphans`, `/stats`, `/coverage`, `/diagram`, `/functions-for-source`, `/source-link`, `/references`, `/directories`, `/exports`, `/stale`) currently returns empty/degraded data on mermaid-collab because V2 has no rows. **This is the highest-impact silent-failure surface.**
4. **Orphan prose file.** `.collab/pseudo/prose/Users/benmaderazo/...source-scanner.ts.json` was created by `pseudo-migration.ts:186-188` — the migration called `escapePath(fr.file_path)` where `fr.file_path` was absolute, and `escapePath` preserves path segments when no forbidden chars exist. `ProseFileV3.file` also got the absolute path. On a different machine the overlay matcher (`pseudo-overlay.ts:200`) can't find any `byFile` bucket matching that absolute path, so it shows up as an orphan forever.

### Consumer map (everything that touches pseudo-db)

| Consumer | Routes to | Status |
|---|---|---|
| `src/routes/pseudo-api.ts` — all HTTP endpoints | V2 | silently empty |
| `src/routes/code-api.ts:635` — global code search FTS fan-out | V2 | silently empty |
| `src/services/onboarding-manager.ts:92/108/118` — categories, graph | V2 | empty |
| `src/services/onboarding-db.ts:139/374` — topic FTS rebuild | V2 | empty |
| `src/mcp/setup.ts` V2-routed tools (see list above) | V2 | empty |
| `src/mcp/setup.ts` V6-routed tools (via `mcp/tools/pseudo-*.ts`) | V6 | working except call-graph |
| `/pseudocode` skill — calls `pseudo_upsert_prose` (V2) and `pseudo_upsert_prose_v6` (V6) | both | V2 write goes nowhere useful; V6 write goes to disk |
| `src/services/pseudo-drift.ts` (drift checker) | V6 | works |
| `src/services/pseudo-watcher.ts` (chokidar) | V6 | works |
| UI (`ui/src/lib/pseudo-api.ts` and all `ui/src/pages/pseudo/*`) | V2 via HTTP routes | empty |
| Tests: `src/services/__tests__/pseudo-db.test.ts`, `pseudo-identity.edge.test.ts`, `pseudo-integration.multiplatform.test.ts`, `pseudo-stress.test.ts`, `src/routes/pseudo-api.test.ts` | V2 | green, but covers V2 only |
| Tests for V6: `pseudo-indexer.test.ts`, `pseudo-overlay.test.ts`, `pseudo-schema.test.ts`, `pseudo-prose-file.test.ts`, `pseudo-migration.test.ts`, `pseudo-drift.test.ts`, etc. | V6 | green where they exist |

## Decision: unify on V6

**Reasons to go V6 → authoritative:**

- V6 is where all new features live (overlay `match_quality`, orphan detection, rename warnings, drift checker, file watcher, snapshot warm-load, scan_runs telemetry, priority/ranking).
- V6 has an autonomous indexer. V2 requires external drivers that nothing reliably triggers. V6's cold-scan on startup is what makes the system usable without a dedicated "please re-index" step.
- V6's schema is cleaner: stable text `methods.id` (sha hash of identity) instead of autoincrement `INTEGER`, `body_fingerprint` for rename detection, `enclosing_class` as a first-class column, `file_imports`, `overlay_matches`, `orphan_prose`.
- V6's prose files live on disk as ProseFileV3 JSON, which is more durable and git-friendly than a binary SQLite (V2's `.collab/pseudo/pseudo.db` was gitignored; V6's prose JSON is the intended source of truth across machines).

**Cost of going V6:** V6 is in-memory. Cold-scan on mermaid-collab takes whatever `runFullScan` takes — measured via `pseudo_db_status`, scan_runs duration — on the order of seconds for 2109 methods. The `.cache/derived.sqlite` snapshot (`pseudo-snapshot.ts`, written by `pseudo-indexer.ts:542`) gives warm-start, so only cold-start on a stale cache pays the scan cost. This is acceptable: V2's on-disk db was never being written to on mermaid-collab, so its "persistence advantage" is empirically irrelevant.

**What V6 does not yet cover that we must port:**

- **Call-edge resolution.** V2 does it; V6 must.
- **Some V2 query methods** (`getCoverage`, `getSourceLink`, `getFunctionsForSource`, `getExports`, `getOrphanFunctions`, `getStaleFunctions`, `getImpactAnalysis`, `getCallGraph`, `getReferences`, `getStats`, `getFilesByDirectory`, `getFileByStem`, `listFiles`, `getFile`, `search`, `getMethodLocation`). Every one of these is consumed by HTTP routes or MCP tools. Either V6 grows equivalents, or a compatibility shim translates V6 → V2 response shapes.

## Target Architecture

### Module boundary (after unification)

```
pseudo-db.ts            → ONLY initPseudoDbV6 + handle types (V2 class deleted)
pseudo-schema.ts        → schema DDL (bumped to v4 with new columns)
pseudo-indexer.ts       → scan pipeline (adds resolveCallEdges phase)
pseudo-overlay.ts       → prose → methods matcher (unchanged)
pseudo-resolver.ts      → NEW — call-edge resolution SQL + disambiguation policy
pseudo-query.ts         → NEW — V2-surface queries reimplemented over V6 schema
                          (getCallGraph, getImpactAnalysis, getCoverage, etc.)
pseudo-prose-file.ts    → ProseFileV3 IO; 'file' normalized to rel POSIX path
pseudo-path-escape.ts   → used only for Windows-reserved basename escaping
pseudo-migration.ts     → extended with v1→v6 AND absolute→relative prose migration
```

The `getPseudoDb(project)` function stays as the entry point *name* during migration but returns a thin wrapper around the V6 handle that exposes the V2 public surface (see shim section).

### On-disk vs in-memory

V6 stays in-memory as the query db. Durability comes from two on-disk artifacts:

1. **`.collab/pseudo/prose/<rel>/<basename>.json`** — ProseFileV3, the source of truth for prose. Committed to git.
2. **`.collab/pseudo/cache/derived.sqlite`** — snapshot of the V6 db written after each successful full scan, used for warm-start via `pseudo-snapshot.ts`. Gitignored via `/.collab/pseudo/cache/`.

On cold start, if snapshot validates, we load it and skip scanning. Otherwise full scan. All writes to V6 tables other than `snapshot` happen inside the indexer transactions.

### Call-edge resolution design

**Problem:** `extractCallEdges` in `source-scanner.ts:1185` produces `{ callee_name }` with no file hint (it strips to the last dotted segment). Given a `callee_name` like `foo`, we need to find the most-likely `methods.id` across the project.

**Step 1 — scanner augmentation.** Extend `call_edges` to capture the short left-hand receiver where available:

```ts
call_edges: Array<{ callee_name: string; receiver_hint: string | null }>
```

For `this.foo()` the hint is `"this"`; for `DbService.upsert()` it's `"DbService"`; for `x.foo()` it's `"x"`; for bare `foo()` it's `null`. This gives us a disambiguation lever without a real type system.

**Dedup key change:** current dedup key in `extractCallEdges` is `last` only (last dotted segment) — this collapses `this.foo()` and `obj.foo()` to a single edge. The new dedup key becomes `${receiver_hint ?? ''}::${last}` so distinct receivers survive.

**Step 2 — schema change.** Add columns to `method_calls` (schema v4):

```sql
ALTER TABLE method_calls ADD COLUMN callee_name_hint TEXT;                             -- receiver_hint
ALTER TABLE method_calls ADD COLUMN resolution_quality TEXT NOT NULL DEFAULT 'unresolved';
```

And an index:

```sql
CREATE INDEX IF NOT EXISTS idx_method_calls_resolution
  ON method_calls(callee_method_id, resolution_quality);
```

`pseudo-indexer.ts:127` `insertCall` changes to populate `callee_name_hint` and initial `resolution_quality = 'unresolved'`.

**Step 3 — resolution pass.** New module `pseudo-resolver.ts`, invoked inside the full-scan transaction after all methods are inserted and after `applyOverlay`, before `COMMIT`. Also invoked after every incremental scan (see "Incremental update policy" below). The pass runs several SQL rounds, each UPDATE replacing `NULL`s in `callee_method_id`, in order of decreasing specificity:

```sql
-- Round 1: unique exact match by (name) where there's exactly one candidate.
UPDATE method_calls
   SET callee_method_id = (
     SELECT m.id FROM methods m WHERE m.name = method_calls.callee_name
     GROUP BY m.name HAVING COUNT(*) = 1
   ),
       resolution_quality = 'exact'
 WHERE callee_method_id IS NULL;

-- Round 2: same-file resolution — receiver_hint='this' or null → look in same file.
UPDATE method_calls
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
 WHERE callee_method_id IS NULL;

-- Round 3: enclosing-class match — receiver_hint matches a class name, resolve to class method.
UPDATE method_calls
   SET callee_method_id = (
     SELECT m.id FROM methods m
      WHERE m.name = method_calls.callee_name
        AND m.enclosing_class = method_calls.callee_name_hint
      LIMIT 1
   ),
       resolution_quality = 'class'
 WHERE callee_method_id IS NULL
   AND callee_name_hint IS NOT NULL;

-- Round 4: same-directory exports — closest neighbor in same dir.
UPDATE method_calls
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
 WHERE callee_method_id IS NULL;

-- Round 5: imports-guided — the caller's file imports a file that exports this name.
UPDATE method_calls
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
 WHERE callee_method_id IS NULL;

-- Round 6: mark leftovers as ambiguous/unresolved so reporting can distinguish them.
UPDATE method_calls
   SET resolution_quality = CASE
     WHEN (SELECT COUNT(*) FROM methods m WHERE m.name = method_calls.callee_name) > 1
       THEN 'ambiguous'
     ELSE 'unresolved'
   END
 WHERE callee_method_id IS NULL;
```

**Disambiguation policy.** The rounds are the policy: exact-by-name beats same-file beats class-match beats same-dir beats import-guided beats dropped. Indirect-dispatch cases (MCP tool dispatch tables, React hooks, re-exports, dynamic property access) are explicitly unresolvable here and stay `unresolved` — downstream UIs should not present them as zero, but as "N unresolved edges, see report." This is already partially modeled by V2's `LIMIT 1` / `callee_file_stem` approach; we are making it explicit and queryable via `resolution_quality`.

**Where in the pipeline.** The resolution pass runs:

- In `runFullScan` (`pseudo-indexer.ts:486`) after `applyOverlay(db, overlay)` at line 526 and before `populateFtsFor` at 529, all still inside the `BEGIN`/`COMMIT` transaction at 502/530. This keeps the db consistent: if the resolution fails, ROLLBACK throws away the whole scan.
- In `runIncrementalScan` (`pseudo-indexer.ts:563`): after per-file `scanOneFile`/`applyOverlay`, **but only re-run rounds against rows touched**. Concretely: for each file in `paths`, after inserts, run the five rounds filtered `WHERE (caller file in paths OR callee_name matches a method name that was inserted/deleted in this batch)`. This keeps incremental runs O(paths × avg calls) rather than whole-project. Inbound edges need re-checking only if the file added or removed methods — we can detect that by comparing `methods` rowcount pre/post for each path and, if changed, running rounds against `WHERE callee_method_id IS NULL` with an OR on "methods of this name changed."

**SCHEMA_VERSION bump.** `pseudo-schema.ts:11` moves `SCHEMA_VERSION = 3` to `4`. `createSchema` runs the new DDL; old in-memory V6 dbs don't need migration (they are `:memory:`) but the snapshot cache at `.collab/pseudo/cache/derived.sqlite` does — `validateSnapshot` already keys on schema version, so any old snapshot fails validation and forces a cold scan. No migration code needed for the snapshot.

### Prose file layout and migration

**Current state:** `pseudo_upsert_prose` writes to `join(project, '.collab', 'pseudo', 'prose', escapePath(input.file) + '.json')`. If `input.file` is absolute, the escaped form preserves absolute segments. ProseFileV3's `file` field stores `input.file` verbatim.

**Target:**

1. `ProseFileV3.file` is a **project-relative POSIX path** (e.g. `src/services/foo.ts`). We add a normalizer and validate on read: any `schema_version: 3` file with an absolute `file` path is treated as stale and triggers path-migration on read.
2. Prose file location becomes `<project>/.collab/pseudo/prose/<escapePath(relPath)>.json`. For typical paths (no Windows-reserved characters), this mirrors the source tree — e.g. `src/services/foo.ts` → `.collab/pseudo/prose/src/services/foo.ts.json`.
3. The overlay matcher's `byFile` key becomes the absolute path reconstructed via `join(project, proseFile.file)`. The existing `normPath` helper is reused. The hash-suffix from `escapePath` is only added when characters are actually escaped, which is the minority case.

**Migration step.**

`pseudo-migration.ts` gains a new function `migrateProseFilesToRelative(project)` that:

```
for each prose file under .collab/pseudo/prose/:
  read JSON (skip if not ProseFileV3)
  if proseFile.file is absolute:
    rel = relative(project, proseFile.file)
    if rel starts with '..': this is truly from another machine → move to
       .collab/pseudo/prose/_orphan/<basename>.json (preserves data, records
       it in a new 'cross_machine_orphan' status in orphan_prose table)
    else:
       rewrite: proseFile.file = rel (POSIX-normalized)
       new_path = <pseudoRoot>/<escapePath(rel)>.json
       writeProseFile(new_path, proseFile)
       if new_path != old_path: unlink(old_path)
```

Runs once, guarded by `.collab/pseudo/.migrated-rel` flag. Also runs inline any time `readProseFile` encounters an absolute `file` (opportunistic self-healing). `pseudo-migration.ts:177-188` (the v1→v6 section that introduced the bug) is patched to write `relative(project, absSource)` instead of `fr.file_path` as both the `file` field and the escape input.

**Prevention.** `pseudo_upsert_prose` (`mcp/tools/pseudo-upsert-prose.ts:58`) normalizes its `input.file` via `toRelPosixPath(project, input.file)` before any escape/write. Any absolute path passed in is converted; any `..`-escaping path throws. The V2 migration patch and the reader-side opportunistic heal together guarantee we can't re-accumulate macOS-absolute junk.

### Orphan prose handling for the existing macOS file

The existing `Users/benmaderazo/Code/claude-mermaid-collab/src/services/source-scanner.ts.json` has `file = /Users/benmaderazo/...`. On this Linux machine, `relative('/srv/codebase/claude-mermaid-collab', '/Users/benmaderazo/...')` returns `../../Users/...`, which starts with `..` → migration moves it to `_orphan/`. If the file happens to contain prose content worth salvaging, operators can manually reassign via `pseudo_reassign_prose`. For mermaid-collab specifically, spot-check shows the file is empty-ish legacy — safe to move.

## V2 Surface Audit

| V2 method | Used by | V6 equivalent | Action |
|---|---|---|---|
| `upsertStructural` | `setup.ts:4059` (`pseudo_index_structural`), `setup.ts:4063` (`pseudo_index_project`) | `indexer.runIncrementalScanForFile` | **Port**: rewrite the MCP tool to call `handle.indexer.runIncrementalScanForFile`. Shim during transition. |
| `upsertProse` | `setup.ts:4115` (`pseudo_upsert_prose`) | `pseudo_upsert_prose_v6` + `runIncrementalScanForFile` | **Collapse**: make `pseudo_upsert_prose` an alias of `pseudo_upsert_prose_v6` and drop the duplicate MCP tool. |
| `getFileState` | `setup.ts:4122` (`pseudo_get_file_state`) | `pseudo_get_file_state_v6` | **Collapse**: alias. |
| `listFiles` | `routes/pseudo-api.ts:154` (`/files`), onboarding-manager, onboarding-db | `pseudo-query.listFiles` (new) | **Port** to V6 schema, response shape preserved modulo degradation ledger. |
| `getFile` | `routes/pseudo-api.ts:158` (`/file`) | `pseudo-query.getFile` (new) | **Port**. UI contract preserved — fields the UI reads are all V6-native. |
| `getFileByStem` | `pseudo-api.ts:161` | (new) | **Port** — trivial lookup over `files.file_path LIKE '%/<stem>.*'`. |
| `search` | `routes/pseudo-api.ts:166` (`/search`), `code-api.ts:635` | `pseudo_search` / `searchFts` (already V6) | **Port** — thin wrapper over `searchFts` returning V2's `SearchResult` shape; `methodName` synthesized as `''` (see ledger). |
| `getReferences(name, fileStem)` | `pseudo-api.ts:171` (`/references`) | (new) | **Port**. `JOIN method_calls → methods caller → files` filtered by `callee_name` (and optional file stem). Relies on the resolver running first for best results, but even without resolution, querying by `callee_name` works as a string match. |
| `getCallGraph` | `pseudo-api.ts:53,112` (`/graph`, `/diagram`), `onboarding-manager.ts:119` | (new) | **Port**. Uses resolved `callee_method_id` for edges; emit node-per-method and edge-per-resolved-call. |
| `getExports` | `pseudo-api.ts:57` (`/exports`) | (new) | **Port**. `SELECT ... FROM methods WHERE is_exported = 1`, join steps. |
| `getImpactAnalysis` | `pseudo-api.ts:66`, `setup.ts:3984` | (new) | **Port**. Reuse V2's recursive CTE verbatim against V6 tables — it already uses `callee_method_id`. |
| `getOrphanFunctions` | `pseudo-api.ts:70` | (new) | **Port**. Non-exported + no inbound method_calls rows. |
| `getStaleFunctions` | `pseudo-api.ts:75` | — | **Delete**. V2 tracked a `methods.date` column that V6 never populated. |
| `getCoverage` | `pseudo-api.ts:80` | (new) | **Port**. Walks source tree via `walkProject`, compares to V6 `files` table. |
| `getSourceLink` | `pseudo-api.ts:89` | (new) | **Port**. Used by the CodeEditor definition jump — critical. Returns `SourceLinkCandidate[]` (array). |
| `getFunctionsForSource` | `pseudo-api.ts:98` | (new) | **Port**. Used by the Function Jump Dropdown — critical. |
| `getStats` | `pseudo-api.ts:102` | (new) | **Port**. Trivial `COUNT(*)`. |
| `getFilesByDirectory` | `pseudo-api.ts:107` | (new) | **Port**. `WHERE file_path LIKE ? || '%'`. |
| `getMethodLocation` | `code-api.ts:640` | (new) | **Port** — **signature changes to `(methodId)`**; caller rewritten in Wave 5. |
| `checkpointWal` | pre-commit hook | — | **Delete**. V6 has no WAL. |
| `resolveCalleesForFile` | internal | → `pseudo-resolver.ts` | **Replaced** by the new resolver. |
| `close` | tests | `handle.dispose` | **Rewire**. |
| `deleteStructural` | not wired | — | **Delete**. |

### Shim strategy

During migration, `getPseudoDb(project)` (preserved at `pseudo-db.ts:1127`) returns a `PseudoDbV6Shim` object with exactly V2's method names. Each method delegates to the new `pseudo-query.ts` functions or to `handle.indexer.*`. The shim exists only long enough to retire V2; see Migration Plan.

## Migration Plan

**Step A — ship the resolver (no unification).** New file `pseudo-resolver.ts`. Schema bump v3→v4 with `callee_name_hint` + `resolution_quality`. Scanner emits `receiver_hint`. `pseudo-indexer.ts` `insertCall` writes the hint; `runFullScan` and `runIncrementalScan` invoke the resolver pass pre-COMMIT. Fixes `pseudo_call_chain_v6`, `pseudo_find_function_v6`, and `pseudo-graph.ts` queries. Mergeable alone. V2 untouched.

**Step B — port query surface onto V6.** New `pseudo-query.ts` module implementing the V2 API against V6 tables (per the degradation ledger above). Unit tests map V2 fixtures to V6 and assert response shape compatibility for each method. At this point `getPseudoDb` still returns `PseudoDbService`. Mergeable alone.

**Step C — introduce the shim.** `getPseudoDb(project)` is rewritten to return `PseudoDbV6Shim` built over `initPseudoDbV6(project)` + `pseudo-query.ts`. `PseudoDbService` class file stays compiled but unused. Run full test suite; expect V2 tests to pass against the shim. Fix discrepancies until green.

**Step D — reroute HTTP + MCP consumers one at a time.** Each PR moves one or a few endpoints from the shim call to a direct V6 call. Order by risk: coverage/stats first, then `/file`, `/files`, `/search`, then `/graph`/`/impact`/`/diagram`. `routes/pseudo-api.test.ts` is the regression guard. `/source-link` and `/functions-for-source` last because they feed critical UI.

**Step E — prose path migration.** New one-shot `migrateProseFilesToRelative`. Hook it into `initPseudoDbV6` after `runMigrationFromV1V6` and before `createSchemaV6`. Add an orphan bucket `_orphan/` for truly cross-machine files. Patch `pseudo_upsert_prose` to normalize incoming paths. Update `readProseFile` to opportunistically heal absolute `file` fields. Delete `pseudo.db`, `pseudo.db-wal`, `pseudo.db-shm` from `.collab/pseudo/` via the same migration if still present.

**Step F — retire V2.** Once every consumer routes to V6 directly:
- Delete `PseudoDbService` class (lines 283–1119 of `pseudo-db.ts`).
- Delete the V2 schema constant (lines 172–253).
- Delete the V2-only MCP tool duplicates: `pseudo_impact_analysis`, `pseudo_find_function`, `pseudo_call_chain`, `pseudo_index_structural`, `pseudo_index_project`, `pseudo_stale_check`, `pseudo_coverage_report`, `pseudo_get_module_summary` — or keep them as **thin aliases** to V6 query functions for backward compatibility. Mermaid-collab MCP clients (the `/pseudocode` skill) must keep working through the transition.
- Delete `src/services/__tests__/pseudo-db.test.ts` (790 lines testing the deleted class). Migrate any uniquely-valuable cases into `pseudo-query.test.ts`.
- Remove the `deleted .collab/pseudo/pseudo.db` file from git history via a plain rm (not filter-branch — it's already gitignored).

**Step G — schema consolidation.** With V2 gone, the only `SCHEMA_VERSION` is the one in `pseudo-schema.ts`. Rename it to just `SCHEMA_VERSION` and export from one place. Delete the duplicate constant in `pseudo-db.ts:172`.

Each step is independently shippable. Steps A, B, E can parallelize. C depends on B. D depends on C. F depends on D. G depends on F.

## Test Strategy

**New tests for the resolver (Step A) — the bug that would have caught NULL-callees.**

- `pseudo-resolver.test.ts`: seeds 10 synthetic files in a temp project, runs `runFullScan`, asserts `SELECT COUNT(*) FROM method_calls WHERE callee_method_id IS NULL AND resolution_quality NOT IN ('ambiguous','unresolved')` is 0. This is the canary that would have failed loudly on the original bug. Add assertion: `SELECT COUNT(*) FROM method_calls WHERE callee_method_id IS NOT NULL > 0` — the resolver must actually resolve something.
- Test each disambiguation round: same-file, class-match, same-dir-export, import-guided, ambiguous-stays-unresolved.
- Test incremental: rename a method in one file, run `runIncrementalScanForFile`, assert inbound edges across the rest of the project still resolve correctly to the new id (or drop if the name no longer exists).
- Test ambiguous: two files export `foo`, one called from each directory, resolver picks same-dir.

**New tests for `pseudo-query.ts` (Step B).**

- Golden-file tests: for each V2 method, seed a V6 db by running `runFullScan` on a fixture tree, compare `pseudo-query.listFiles(db)` output to a saved `listFiles.json` snapshot. Same for `getFile`, `getCallGraph`, `getImpactAnalysis`, `getSourceLink`, `getFunctionsForSource`, `getStats`, `getFilesByDirectory`, `getCoverage`, `getExports`, `getOrphanFunctions`, `getReferences`, `getMethodLocation`.
- Shape contract test: every return type matches the TS interface exported from `pseudo-db.ts` today (`PseudoFileWithMethods`, `GraphNode`, etc.). Prevents UI breakage.

**Regression test for the "implementations drift" failure mode.**

- New `pseudo-unification.test.ts`: spins up a minimal project, runs `runFullScan`, then asserts that every HTTP route in `pseudo-api.ts` returns non-empty data for the seed project. Same for every MCP tool in `setup.ts` that has "pseudo" in its name. Any future PR that routes a consumer to the wrong db will fail here.

**Prose-path migration tests.**

- Fixture with absolute-path ProseFileV3 → after `migrateProseFilesToRelative`, file field is relative, file is moved under mirrored path, old file gone.
- Fixture with cross-machine prose file (`../../Users/...`) → moved to `_orphan/`, `orphan_prose` row created.
- `pseudo_upsert_prose` called with an absolute path → writes relative.

**What the existing test suite covers that we must not break:**

- `pseudo-db.test.ts` tests V2's API — green through Step C (via shim), then ported/deleted in Step F.
- `pseudo-api.test.ts` tests HTTP contracts — green end-to-end; must stay green at each step.
- `pseudo-identity.edge.test.ts`, `pseudo-stress.test.ts`, `pseudo-integration.multiplatform.test.ts` — keep; they test cross-platform path handling and are still relevant.

## Open questions — resolved at /vibe-go

1. **Scanner receiver_hint** — APPROVED. Wave 1 `scanner-receiver-hint` task extends `extractCallEdges` with `receiver_hint` and widens the dedup key to `${receiver_hint ?? ''}::${last}`.
2. **Stale_check** — DELETE. V6 has no `methods.date`. `/pseudo-api.ts` `/stale` endpoint and `pseudo_stale_check` MCP tool are removed in Wave 5.
3. **Tree-sitter vs regex resolver** — stay with regex + receiver-hint heuristic. Ship the 6-round SQL resolver; accept "hint not proof" as the contract.
4. **Pre-commit lint on prose files** — deferred. Not blocking unification. Open a follow-up if drift recurs.
5. **Snapshot cache relocation** — APPROVED. Wave 1 `snapshot-cache-relocate` task moves `.cache/derived.sqlite` to `.collab/pseudo/cache/derived.sqlite` and adds it to `.gitignore`.

## Risks

1. **Resolver precision.** The regex-based `extractCallEdges` has no type information. Receiver-hint heuristics will mis-resolve in some codebases. Mitigation: `resolution_quality` is surfaced in query results so the UI can downweight low-confidence edges. We should accept that impact-analysis on a large codebase will be a *hint*, not a proof.
2. **Shim performance drift.** Routing HTTP through `pseudo-query.ts` over the in-memory V6 db should be faster than V2's disk SQLite. Risk is per-request cold-lookup overhead if the shim allocates too aggressively. Benchmark the `/graph` endpoint on a large project before Step D.
3. **Memory footprint.** V6 holds the whole db in memory. 2109 methods is fine; 200k methods might not be. Open question: at what project size do we need to go disk-backed again? For now, accept in-memory; document the ceiling.
4. **Startup time regression for V6-only consumers.** Today, MCP tool handlers that need V6 await `handle.ready` implicitly. After unification, every HTTP request to `/api/pseudo/*` also needs the db populated. We should add an `await handle.ready` guard at the top of `handlePseudoAPI` (or return a 503 with progress) so the UI doesn't see empty data during cold-scan.
5. **MCP clients calling V2-only tool names.** `pseudo_impact_analysis`, `pseudo_find_function`, `pseudo_call_chain`, `pseudo_get_module_summary`, `pseudo_index_structural`, `pseudo_index_project`, `pseudo_coverage_report` are in `setup.ts`'s declared tool list. Removing them breaks existing client scripts and the `/pseudocode` skill. **We must keep the tool names and route them to the unified query layer — only delete the V2 implementation, not the MCP names.**

## What's NOT in scope

- Intent tags, drift-reconciliation reflex, any LLM-driven prose generation beyond what `pseudo_upsert_prose_v6` already does.
- Tree-sitter / LSP-backed call graphs. Stays on the regex + receiver-hint path.
- Schema changes beyond adding `callee_name_hint` and `resolution_quality` to `method_calls`.
- Any UI refactor. The UI contract (`ui/src/lib/pseudo-api.ts` response shapes) is preserved modulo the degradation ledger above.
- Ranking, orphan auto-reassignment policy changes. Those are separate waves already in flight in `pseudo-ranking.ts` and `pseudo-orphan.ts`.

This doc's deliverable is substrate: one pseudo-db, a real call-graph, and prose files that survive a machine switch. Everything else gets easier once these three are true.
