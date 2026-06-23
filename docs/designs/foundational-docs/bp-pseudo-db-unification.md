# Blueprint: pseudo-db Unification and Call-Graph Repair

## Source Artifacts

- `pseudo-db-unification-design` — round 5 design doc (primary)
- `bug-verification` — round 4 empirical verification of the two bugs

## 1. Structure Summary

### Files to create

- [ ] `src/services/pseudo-resolver.ts` — call-edge resolution SQL + disambiguation policy
- [ ] `src/services/pseudo-query.ts` — V2-surface queries reimplemented over V6 schema
- [ ] `src/services/__tests__/pseudo-resolver.test.ts` — resolver round correctness
- [ ] `src/services/__tests__/pseudo-query.test.ts` — golden-file V2-shape compatibility
- [ ] `src/services/__tests__/pseudo-unification.test.ts` — regression guard: every pseudo-* consumer returns non-empty on a seed project
- [ ] `src/services/__tests__/pseudo-migration-rel.test.ts` — prose path migration and self-heal tests

### Files to modify

- [ ] `src/services/pseudo-schema.ts` — bump `SCHEMA_VERSION` to `4`; add `callee_name_hint` + `resolution_quality` columns to `method_calls`; add `idx_method_calls_resolution`
- [ ] `src/services/source-scanner.ts` — `extractCallEdges` returns `{ callee_name, receiver_hint }`
- [ ] `src/services/pseudo-indexer.ts` — `insertCall` writes `callee_name_hint` + `resolution_quality='unresolved'`; `runFullScan` invokes resolver pass inside the BEGIN/COMMIT before `populateFtsFor`; `runIncrementalScan` invokes a scoped resolver pass
- [ ] `src/services/pseudo-path-escape.ts` — add `toRelPosixPath(project, input)` helper
- [ ] `src/services/pseudo-prose-file.ts` — `readProseFile` opportunistically heals absolute `file` fields via `toRelPosixPath`
- [ ] `src/services/pseudo-migration.ts` — add `migrateProseFilesToRelative(project)`; patch the v1→v6 bug at the 177–188 block that wrote `fr.file_path` absolute
- [ ] `src/services/pseudo-snapshot.ts` — relocate `SNAPSHOT_REL` from `.cache/derived.sqlite` to `.collab/pseudo/cache/derived.sqlite`
- [ ] `src/services/pseudo-db.ts` — update `initPseudoDbV6` snapshot path at line 1387 to match; rewrite `getPseudoDb(project)` to return `PseudoDbV6Shim` over `initPseudoDbV6`; eventually delete `PseudoDbService` class and the duplicate `SCHEMA_VERSION = 2`
- [ ] `src/services/__tests__/pseudo-integration.multiplatform.test.ts` — update hardcoded `.cache/derived.sqlite` path at line 76
- [ ] `.gitignore` — add `.collab/pseudo/cache/` entry (derived cache; must not be committed)
- [ ] `src/mcp/tools/pseudo-upsert-prose.ts` — normalize `input.file` via `toRelPosixPath` before escape/write
- [ ] `src/routes/pseudo-api.ts` — reroute every endpoint to `pseudo-query.ts` via the shim
- [ ] `src/routes/code-api.ts` — reroute `/code/search` FTS fan-out call (line 635)
- [ ] `src/services/onboarding-manager.ts` — reroute categories/graph calls (lines 92, 108, 119)
- [ ] `src/services/onboarding-db.ts` — reroute topic FTS rebuild (lines 139, 374)
- [ ] `src/mcp/setup.ts` — V2-routed MCP tools (`pseudo_impact_analysis`, `pseudo_find_function`, `pseudo_call_chain`, `pseudo_index_structural`, `pseudo_index_project`, `pseudo_coverage_report`, `pseudo_get_module_summary`, `pseudo_stale_check`, `pseudo_get_file_state`, `pseudo_upsert_prose`) route to the unified query layer; tool names preserved
- [ ] `src/services/__tests__/pseudo-db.test.ts` — delete after shim migration; salvage any uniquely V6-relevant cases into `pseudo-query.test.ts`

### Type Definitions

New in `pseudo-resolver.ts`:

```ts
export type ResolutionQuality =
  | 'exact' | 'same_file' | 'class' | 'same_dir' | 'import' | 'ambiguous' | 'unresolved';

export interface ResolverReport {
  totalEdges: number;
  resolved: number;
  byQuality: Record<ResolutionQuality, number>;
  durationMs: number;
}

export function resolveCallEdges(db: Database, opts?: { scopeFilePaths?: string[] }): ResolverReport;
```

New in `pseudo-query.ts` — mirrors V2's public interfaces:

```ts
// All return types MUST match the existing V2 TS interfaces exported from pseudo-db.ts:
// PseudoFileWithMethods, GraphNode, GraphEdge, ImpactAnalysis, SearchResult, etc.
export function listFiles(db: Database): PseudoFile[];
export function getFile(db: Database, filePath: string): PseudoFileWithMethods | null;
export function getFileByStem(db: Database, stem: string): PseudoFile | null;
export function search(db: Database, query: string, limit?: number): SearchResult[];
export function getReferences(db: Database, name: string, fileStem?: string): Reference[];
export function getCallGraph(db: Database, root?: string): { nodes: GraphNode[]; edges: GraphEdge[] };
export function getExports(db: Database, filePath?: string): MethodInfo[];
export function getImpactAnalysis(db: Database, methodId: string, depth?: number): ImpactAnalysis;
export function getOrphanFunctions(db: Database): MethodInfo[];
export function getCoverage(db: Database, project: string): CoverageReport;
export function getSourceLink(db: Database, name: string, fileStem?: string): SourceLink | null;
export function getFunctionsForSource(db: Database, filePath: string): FunctionJump[];
export function getStats(db: Database): PseudoStats;
export function getFilesByDirectory(db: Database, dir: string): PseudoFile[];
export function getMethodLocation(db: Database, methodId: string): SourceLink | null;
```

New path helper in `pseudo-path-escape.ts`:

```ts
export function toRelPosixPath(project: string, input: string): string;
// throws if result escapes project root (starts with '..')
```

`PseudoDbV6Shim` in `pseudo-db.ts` — an object literal with every V2 method name delegating to `pseudo-query.ts` or `handle.indexer.*`. Not a class. Shared `initPseudoDbV6(project)` handle is lazily created per project and cached.

### Component Interactions

```
startup → initPseudoDbV6(cwd) → runFullScan
                                  ├── scanOneFile (incl. extractCallEdges → receiver_hint)
                                  ├── insertCall(callee_name, callee_name_hint, resolution_quality='unresolved')
                                  ├── applyOverlay (prose overlay, unchanged)
                                  ├── resolveCallEdges (NEW — 6 SQL rounds)
                                  └── populateFtsFor

getPseudoDb(project) → PseudoDbV6Shim → pseudo-query.ts → V6 handle.db

routes/pseudo-api.ts ─┐
routes/code-api.ts    ├─→ getPseudoDb → shim → pseudo-query.ts
services/onboarding-* ┘

mcp/setup.ts V2 tool handlers ─→ shim (transition) ─→ direct pseudo-query.ts call
mcp/setup.ts V6 tool handlers ─→ mcp/tools/pseudo-*.ts (unchanged, already V6)

pseudo_upsert_prose → toRelPosixPath → writeProseFile (mirrored rel path) → runIncrementalScanForFile

.collab/pseudo/cache/derived.sqlite — snapshot (was .cache/derived.sqlite); gitignored; invalidated on SCHEMA_VERSION bump
.collab/pseudo/prose/_orphan/ — new bucket for cross-machine prose files
```

---

## 2. Function Blueprints

### `resolveCallEdges(db, opts?): ResolverReport`

**Purpose:** Replace V6's NULL-only `callee_method_id` column with best-guess method IDs using six SQL rounds of decreasing specificity. Runs inside the indexer's transaction — ROLLBACK on failure throws away the whole scan.

**Pseudocode:**
1. Start wall-clock timer.
2. Build scope predicate: if `opts.scopeFilePaths` is provided, only touch `method_calls` whose caller is in the scope; otherwise all rows.
3. Reset: `UPDATE method_calls SET callee_method_id = NULL, resolution_quality = 'unresolved' WHERE <scope>`. Ensures re-entrant runs don't compound stale guesses.
4. Run Round 1 (exact unique name match) — SQL from the design doc, filtered by scope.
5. Run Round 2 (same-file match — for `receiver_hint IN ('this', NULL)`).
6. Run Round 3 (enclosing-class match — `receiver_hint` equals a known `methods.enclosing_class`).
7. Run Round 4 (same-directory exported match).
8. Run Round 5 (imports-guided via `file_imports` table).
9. Run Round 6 (mark leftovers `ambiguous` if multiple candidates exist by name, else `unresolved`).
10. Collect counts via a single `SELECT resolution_quality, COUNT(*) FROM method_calls WHERE <scope> GROUP BY resolution_quality`.
11. Return `ResolverReport`.

**Error handling:** Throws on SQL errors — caller (the indexer) holds the transaction and will ROLLBACK. Never swallows.

**Edge cases:**
- Empty `methods` table — all six rounds are no-ops; report returns zeros; does not error.
- Incremental re-scan where a method was renamed: step 3 resets inbound edges so Round 1 re-resolves to the new ID.
- Self-calls (caller calls a method with the same name in the same file) — Round 1 resolves correctly when unique, else Round 2 picks same-file.

**Test strategy:**
- Synthetic fixture with 10 files covering every round. Assert `byQuality.unresolved` exceeds zero only for the deliberately-ambiguous case.
- Incremental scope test: rename `foo → bar` in one file, re-scan that file only, assert inbound edges across unrelated files still resolve.
- Fuzz: 100 random files, assert no NULL `callee_method_id` has `resolution_quality != 'ambiguous'` and `!= 'unresolved'`.

---

### `runFullScan` (modification in `pseudo-indexer.ts`)

**Pseudocode delta:**
1. BEGIN transaction (existing).
2. DELETE FROM method_calls (existing).
3. For each file: scanOneFile → inserts, insertCall with `receiver_hint` + `resolution_quality='unresolved'`.
4. applyOverlay (existing).
5. **NEW: `resolveCallEdges(db)`.**
6. populateFtsFor (existing).
7. COMMIT (existing).

**Edge cases:** If `resolveCallEdges` throws, outer `try { ... } catch { ROLLBACK }` unwinds the whole scan. Indexer telemetry in `scan_runs` records failure. No partial state.

**Test strategy:** `pseudo-unification-regression-test` asserts `SELECT COUNT(*) FROM method_calls WHERE callee_method_id IS NOT NULL > 0` after a full scan on a seed project.

---

### `runIncrementalScan` (modification in `pseudo-indexer.ts`)

**Pseudocode delta:** After the per-file insert loop and `applyOverlay`, before COMMIT, call:

```
resolveCallEdges(db, { scopeFilePaths: paths })
```

and additionally, if any `paths` file added or removed methods (detect by comparing pre/post `methods` row counts keyed by `file_path`), run a second pass:

```
resolveCallEdges(db, { scopeFilePaths: allFilesWithInboundEdgesToChangedNames })
```

where `allFilesWithInboundEdgesToChangedNames` is computed from a staged `changed_names` temp table populated during insert.

**Error handling:** Same as full scan — transactional.

**Test strategy:** Rename and move cases in `pseudo-resolver.test.ts`.

---

### `toRelPosixPath(project, input): string`

**Pseudocode:**
1. If `input` is already a POSIX relative path (does not start with `/`, does not contain `..` segments, does not look like a Windows absolute), return it.
2. Resolve absolute path of `input` (use `path.resolve` with `project` if `input` is relative).
3. Compute `relative(project, absInput)` in the platform-agnostic way.
4. Normalize all separators to `/`.
5. If the result starts with `..`, throw `new Error('prose file path escapes project root: ' + input)`.
6. Return the normalized relative path.

**Error handling:** Throws on escaped paths; caller handles (the migration moves the file to `_orphan/`; the upsert MCP tool surfaces the error to the user).

**Edge cases:** Windows input with backslashes → normalize. Input already containing `/` on Windows → still works (Node's `path.posix` module). Trailing slashes → preserved as-is (not a concern for file paths).

**Test strategy:** `pseudo-migration-rel.test.ts` — unit tests for happy path, absolute Linux/macOS/Windows, escaping, already-relative.

---

### `migrateProseFilesToRelative(project): Promise<{ migrated: number; orphaned: number }>`

**Pseudocode:**
1. If `<project>/.collab/pseudo/.migrated-rel` exists, return `{ migrated: 0, orphaned: 0 }`.
2. Recursively walk `<project>/.collab/pseudo/prose/` collecting `*.json` files (skip `_orphan/`).
3. For each file:
   a. Read JSON; skip if not ProseFileV3 (tolerate older shapes — they'll be handled by the v1→v6 migration).
   b. If `proseFile.file` is already relative-POSIX, continue.
   c. Try `rel = toRelPosixPath(project, proseFile.file)`.
   d. If that throws (escapes root — cross-machine): move the file to `<project>/.collab/pseudo/prose/_orphan/<basename>.json`; `orphaned++`.
   e. Otherwise: rewrite `proseFile.file = rel`; compute `newPath = join(pseudoRoot, escapePath(rel) + '.json')`; `writeProseFile(newPath, proseFile)`; if `newPath !== oldPath` then `unlink(oldPath)`; `migrated++`.
4. Write `.migrated-rel` sentinel.
5. Return counts.

**Error handling:** Per-file errors are logged via `console.warn('[pseudo-migration] ...')` and the loop continues — a single broken prose file must not block migration. Fatal errors (filesystem unavailable) bubble up.

**Edge cases:**
- The existing `/Users/benmaderazo/...source-scanner.ts.json` orphan: `relative('/srv/codebase/claude-mermaid-collab', '/Users/benmaderazo/...')` → `../../Users/...` → throws → moved to `_orphan/`. Covered explicitly.
- Race with the indexer: call this function before `createSchemaV6` runs, so no in-flight reads clash.
- Repeated invocation with `.migrated-rel` present — no-op.

**Test strategy:** `pseudo-migration-rel.test.ts` — happy path, cross-machine orphan, already-relative no-op, repeated invocation idempotence.

---

### `PseudoDbV6Shim` (in `pseudo-db.ts`)

**Pseudocode:** Object factory returning an instance that holds a reference to a `PseudoDbHandle` (from `initPseudoDbV6`) and proxies V2 methods to `pseudo-query.ts` functions or `handle.indexer.*`.

```
function createPseudoDbV6Shim(project: string): PseudoDbShim {
  const handle = initPseudoDbV6(project);  // cached per project
  return {
    upsertStructural: (file, data) => handle.indexer.runIncrementalScanForFile(file, { trigger: 'upsert' }),
    upsertProse:      (input)      => upsertProseV6(handle.db, project, input),
    getFileState:     (file)       => getFileStateV6(handle.db, file),
    listFiles:        ()           => pseudoQuery.listFiles(handle.db),
    getFile:          (path)       => pseudoQuery.getFile(handle.db, path),
    // ... every V2 method, no exceptions
    close:            ()           => handle.dispose(),
  };
}

function getPseudoDb(project: string): PseudoDbShim {
  // project-keyed cache, same lifecycle V2 had
}
```

**Error handling:** Each method bubbles errors as V2 would. The shim does not introduce new error types — TS contract stays identical.

**Edge cases:**
- Indexer still cold-scanning (`handle.ready` not yet resolved): shim calls return empty arrays / null for queries, and `upsertStructural` blocks on `handle.ready` before triggering an incremental scan. HTTP callers optionally check `handle.ready` via a new status field in `getStats`.
- Concurrent access: V6's in-memory db is single-threaded via Bun's sqlite binding. Same semantics as V2.

**Test strategy:** Existing V2 tests (`pseudo-db.test.ts`, `pseudo-api.test.ts`) run unchanged against the shim. Any divergence is a blocking failure.

---

### `pseudo-query.ts` — individual function blueprints

Each function is a direct SQL query over V6 tables returning the V2 response shape. Full pseudocode for each is trivial (SQL → row map → shape); the critical guarantee is **byte-identical output to the V2 equivalent**. Golden-file tests in `pseudo-query.test.ts` assert this.

**`getCallGraph(db, root?)`:**
1. Query: `SELECT DISTINCT caller_method_id, callee_method_id, resolution_quality FROM method_calls WHERE callee_method_id IS NOT NULL` (filtered by `root` if provided).
2. Join to `methods` for node info; build `nodes[]` and `edges[]`.
3. Include `resolution_quality` on edges (new field the UI can ignore). Does not break existing clients since `GraphEdge` is extensible.
4. Return.

**`getImpactAnalysis(db, methodId, depth=3)`:**
1. Recursive CTE — copy verbatim from V2 (`pseudo-db.ts:876`). V2's CTE already uses `callee_method_id` so it works unchanged against V6 tables.
2. Distinguish `direct` (depth 1) and `transitive` (depth > 1).
3. Return.

**`getSourceLink(db, name, fileStem?)`:**
1. `SELECT file_path, start_line, end_line FROM methods WHERE name = ? AND (? IS NULL OR file_path LIKE '%/' || ? || '.%')`.
2. Return first row or null.
3. **Critical UI path — zero-tolerance regression guard in `pseudo-query.test.ts`.**

**`getFunctionsForSource(db, filePath)`:**
1. `SELECT name, start_line, is_async, is_exported, enclosing_class FROM methods WHERE file_path = ? ORDER BY start_line`.
2. Return rows mapped to `FunctionJump[]`.
3. **Critical UI path — zero-tolerance regression guard.**

All other methods follow the same shape-preservation pattern. `getStaleFunctions` is explicitly deleted (see design doc V2 Surface Audit).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: pseudo-schema-v4
    files: [src/services/pseudo-schema.ts]
    tests: []
    description: "Bump SCHEMA_VERSION to 4; add callee_name_hint + resolution_quality columns to method_calls; add idx_method_calls_resolution index."
    parallel: true
    depends-on: []

  - id: scanner-receiver-hint
    files: [src/services/source-scanner.ts]
    tests: [src/services/__tests__/source-scanner.test.ts]
    description: "extractCallEdges returns { callee_name, receiver_hint } where receiver_hint captures the short LHS (this, ClassName, var, or null)."
    parallel: true
    depends-on: []

  - id: pseudo-resolver-module
    files: [src/services/pseudo-resolver.ts]
    tests: []
    description: "New module exporting resolveCallEdges with 6 SQL rounds (exact, same_file, class, same_dir, import, ambiguous/unresolved) and ResolverReport shape."
    parallel: true
    depends-on: []

  - id: prose-path-util
    files: [src/services/pseudo-path-escape.ts]
    tests: []
    description: "Add toRelPosixPath(project, input) helper that normalizes to POSIX-relative and throws on paths escaping project root."
    parallel: true
    depends-on: []

  - id: pseudo-query-module
    files: [src/services/pseudo-query.ts]
    tests: []
    description: "New module implementing the V2 query surface (listFiles, getFile, getCallGraph, getImpactAnalysis, getSourceLink, getFunctionsForSource, getStats, etc.) over V6 tables. Preserves V2 response shapes byte-for-byte."
    parallel: true
    depends-on: []

  - id: snapshot-cache-relocate
    files: [src/services/pseudo-snapshot.ts, src/services/pseudo-db.ts, src/services/__tests__/pseudo-integration.multiplatform.test.ts, .gitignore]
    tests: [src/services/__tests__/pseudo-integration.multiplatform.test.ts]
    description: "Move snapshot cache from <project>/.cache/derived.sqlite to <project>/.collab/pseudo/cache/derived.sqlite. Update SNAPSHOT_REL in pseudo-snapshot.ts:28 and the comment at line 4. Update the joinV6 call in pseudo-db.ts:1387. Update the hardcoded path in pseudo-integration.multiplatform.test.ts:76. Add .collab/pseudo/cache/ to .gitignore so the derived cache is not committed."
    parallel: true
    depends-on: []

  - id: pseudo-indexer-resolve-pass
    files: [src/services/pseudo-indexer.ts]
    tests: []
    description: "insertCall writes callee_name_hint + resolution_quality='unresolved'. runFullScan calls resolveCallEdges(db) inside the BEGIN/COMMIT before populateFtsFor. runIncrementalScan calls resolveCallEdges(db, { scopeFilePaths: paths }) plus a second scoped pass when method counts changed."
    parallel: false
    depends-on: [pseudo-schema-v4, scanner-receiver-hint, pseudo-resolver-module]

  - id: prose-file-self-heal
    files: [src/services/pseudo-prose-file.ts]
    tests: []
    description: "readProseFile opportunistically heals absolute proseFile.file fields via toRelPosixPath. Cross-machine paths are left as-is so migration can bucket them."
    parallel: true
    depends-on: [prose-path-util]

  - id: prose-migration-func
    files: [src/services/pseudo-migration.ts]
    tests: []
    description: "Add migrateProseFilesToRelative(project). Patch the v1→v6 bug at lines 177-188 to write relative(project, absSource) instead of fr.file_path. Create _orphan bucket for cross-machine files. Guarded by .migrated-rel sentinel."
    parallel: true
    depends-on: [prose-path-util]

  - id: upsert-prose-normalize
    files: [src/mcp/tools/pseudo-upsert-prose.ts]
    tests: []
    description: "Normalize input.file via toRelPosixPath before escape/write so no new absolute-path prose files can be created."
    parallel: true
    depends-on: [prose-path-util]

  - id: pseudo-resolver-test
    files: []
    tests: [src/services/__tests__/pseudo-resolver.test.ts]
    description: "Seed 10 synthetic files in a temp project. Assert: zero rows with callee_method_id NULL and resolution_quality NOT IN ('ambiguous','unresolved'); non-zero resolved count; each round fires on its designed case; rename-and-reindex re-resolves inbound edges; two-file ambiguity picks same-dir."
    parallel: true
    depends-on: [pseudo-indexer-resolve-pass]

  - id: pseudo-query-test
    files: []
    tests: [src/services/__tests__/pseudo-query.test.ts]
    description: "Golden-file tests: for each V2 method, seed a V6 db by running runFullScan on a fixture tree, compare pseudo-query output to saved JSON snapshots. Shape contract assertions against V2 TS interfaces. Zero-tolerance regression guard on getSourceLink and getFunctionsForSource."
    parallel: true
    depends-on: [pseudo-query-module, pseudo-indexer-resolve-pass]

  - id: prose-migration-test
    files: []
    tests: [src/services/__tests__/pseudo-migration-rel.test.ts]
    description: "Fixture with absolute ProseFileV3 → after migrateProseFilesToRelative, file is relative, moved to mirrored path, old gone. Cross-machine fixture → moved to _orphan/. toRelPosixPath unit tests. pseudo_upsert_prose absolute-path input writes relative. Repeated migration is idempotent."
    parallel: true
    depends-on: [prose-migration-func, prose-file-self-heal, upsert-prose-normalize]

  - id: pseudo-unification-regression-test
    files: []
    tests: [src/services/__tests__/pseudo-unification.test.ts]
    description: "Spins up a minimal project, runs runFullScan, asserts every HTTP route in pseudo-api.ts and every MCP tool in setup.ts named pseudo_* returns non-empty data for the seed project. The canary that would have caught the NULL-callee bug."
    parallel: true
    depends-on: [pseudo-indexer-resolve-pass]

  - id: pseudo-db-shim
    files: [src/services/pseudo-db.ts]
    tests: []
    description: "Rewrite getPseudoDb(project) to return PseudoDbV6Shim built over initPseudoDbV6 + pseudo-query.ts. Every V2 method name delegates to pseudo-query or handle.indexer. PseudoDbService class file stays compiled but unused until F-wave retirement. Existing V2 tests run unchanged against the shim."
    parallel: false
    depends-on: [pseudo-query-module, pseudo-query-test, pseudo-resolver-test]

  - id: reroute-pseudo-api
    files: [src/routes/pseudo-api.ts]
    tests: [src/routes/__tests__/pseudo-api.test.ts]
    description: "Reroute every endpoint (/files, /file, /search, /graph, /impact, /orphans, /stats, /coverage, /diagram, /functions-for-source, /source-link, /references, /directories, /exports, /stale) from shim call to direct pseudo-query call. pseudo-api.test.ts is the regression guard. /source-link and /functions-for-source must land last with extra manual verification."
    parallel: true
    depends-on: [pseudo-db-shim, pseudo-unification-regression-test]

  - id: reroute-code-api
    files: [src/routes/code-api.ts]
    tests: [src/routes/__tests__/code-api.test.ts]
    description: "Reroute the global code search FTS fan-out at line 635 to pseudo-query.search."
    parallel: true
    depends-on: [pseudo-db-shim, pseudo-unification-regression-test]

  - id: reroute-onboarding
    files: [src/services/onboarding-manager.ts, src/services/onboarding-db.ts]
    tests: [src/services/__tests__/onboarding-manager.test.ts, src/services/__tests__/onboarding-db.test.ts]
    description: "Reroute onboarding-manager.ts:92/108/119 (categories, graph) and onboarding-db.ts:139/374 (topic FTS rebuild) to pseudo-query."
    parallel: true
    depends-on: [pseudo-db-shim, pseudo-unification-regression-test]

  - id: reroute-mcp-tools
    files: [src/mcp/setup.ts]
    tests: []
    description: "Reroute V2-routed MCP handlers (pseudo_impact_analysis, pseudo_find_function, pseudo_call_chain, pseudo_index_structural, pseudo_index_project, pseudo_coverage_report, pseudo_get_module_summary, pseudo_stale_check, pseudo_get_file_state, pseudo_upsert_prose) to pseudo-query.ts. Tool names are preserved for MCP client compatibility. pseudo_stale_check becomes an alias returning [] (decision recorded in /vibe-go)."
    parallel: true
    depends-on: [pseudo-db-shim, pseudo-unification-regression-test]

  - id: retire-v2-class
    files: [src/services/pseudo-db.ts]
    tests: []
    description: "Delete PseudoDbService class (pseudo-db.ts:283-1119), the V2 schema constant (lines 172-253), and the checkpointWal pre-commit hook wiring. getPseudoDb stays as the shim entry point. PseudoDbV6Shim is now the only implementation."
    parallel: false
    depends-on: [reroute-pseudo-api, reroute-code-api, reroute-onboarding, reroute-mcp-tools]

  - id: retire-v2-tests
    files: [src/services/__tests__/pseudo-db.test.ts]
    tests: []
    description: "Delete pseudo-db.test.ts (790 lines testing the deleted class). Salvage any uniquely V6-relevant cases into pseudo-query.test.ts."
    parallel: false
    depends-on: [retire-v2-class]

  - id: consolidate-schema-version
    files: [src/services/pseudo-db.ts, src/services/pseudo-schema.ts]
    tests: []
    description: "With V2 gone, the only SCHEMA_VERSION is the one in pseudo-schema.ts. Delete the duplicate in pseudo-db.ts. Ensure the snapshot cache at the new .collab/pseudo/cache/derived.sqlite location invalidates on the bumped version (validateSnapshot check already exists)."
    parallel: false
    depends-on: [retire-v2-class]
```

### Execution Waves

**Wave 1 (parallel — 6 tasks, independent foundations):**
- `pseudo-schema-v4`
- `scanner-receiver-hint`
- `pseudo-resolver-module`
- `prose-path-util`
- `pseudo-query-module`
- `snapshot-cache-relocate`

**Wave 2 (parallel on file-disjoint edits — 4 tasks):**
- `pseudo-indexer-resolve-pass` *(depends on schema-v4, scanner-receiver-hint, pseudo-resolver-module)*
- `prose-file-self-heal` *(depends on prose-path-util)*
- `prose-migration-func` *(depends on prose-path-util)*
- `upsert-prose-normalize` *(depends on prose-path-util)*

**Wave 3 (parallel tests — 4 tasks):**
- `pseudo-resolver-test`
- `pseudo-query-test`
- `prose-migration-test`
- `pseudo-unification-regression-test`

**Wave 4 (shim — 1 task, blocks reroutes):**
- `pseudo-db-shim`

**Wave 5 (parallel reroutes on different files — 4 tasks):**
- `reroute-pseudo-api`
- `reroute-code-api`
- `reroute-onboarding`
- `reroute-mcp-tools`

**Wave 6 (1 task):**
- `retire-v2-class` *(blocks on all Wave 5 reroutes)*

**Wave 7 (parallel — 2 tasks):**
- `retire-v2-tests`
- `consolidate-schema-version`

### Summary

- **Total tasks:** 22
- **Total waves:** 7
- **Max parallelism:** 6 (Wave 1)
- **Critical path length:** 7 tasks (Wave 1 → 2 → 3 → 4 → 5 → 6 → 7)
- **Canary test:** `pseudo-unification-regression-test` (Wave 3) — blocks every subsequent reroute. Any regression after this point fails loudly.
- **Critical UI zero-regression guards:** `getSourceLink` and `getFunctionsForSource` in `pseudo-query-test`.
- **Out of scope for this blueprint:** tree-sitter call graphs, intent tags, ranking/orphan reassignment policy changes, UI refactors. Preserving the UI contract (`ui/src/lib/pseudo-api.ts` response shapes) byte-for-byte is non-negotiable throughout.

---

## Open questions — resolved at /vibe-go

1. **Scanner `receiver_hint` extraction:** **approved.** `extractCallEdges` returns `{ callee_name, receiver_hint }`. Ships in Wave 1 task `scanner-receiver-hint`.
2. **Resolver approach:** **heuristic** (receiver-hint + SQL rounds). Rationale: 50-line delta vs days of tree-sitter work; `resolution_quality` column lets downstream surfaces downweight low-confidence edges; ctags remains a future internal upgrade that won't change the public surface. If we revisit and change the approach, we update the design doc and re-run `/vibe-blueprint`.
3. **`pseudo_stale_check` disposition:** **empty alias** returning `[]`. Preserves MCP tool surface for existing clients (the `/pseudocode` skill), matches the "preserve tool names" principle, upgradable later without an MCP contract break. Applied in Wave 5 task `reroute-mcp-tools`.
4. **Pre-commit path lint for prose files:** **deferred.** `toRelPosixPath` normalization on upsert + `readProseFile` self-heal already structurally prevent new absolute paths. A pre-commit hook is defense in depth for a case already structurally closed, and is scope creep for this blueprint. Tracked as a follow-up.
5. **Snapshot cache relocation:** **approved.** Moved from `<project>/.cache/derived.sqlite` to `<project>/.collab/pseudo/cache/derived.sqlite`. New Wave 1 task `snapshot-cache-relocate` owns the file paths in `pseudo-snapshot.ts`, `pseudo-db.ts`, and `pseudo-integration.multiplatform.test.ts`, plus the `.gitignore` entry.
