# Blueprint: Pseudo-DB v6 Rebuild

Implementation plan derived from `design-pseudo-db-initial-population` v6. Single contiguous work stream across 8 dependency waves. Total tasks: 37. Honest scope: 28-40 days.

## Source Artifacts
- `design-pseudo-db-initial-population` (v6)

---

## 1. Structure Summary

### New files

- [ ] `src/services/pseudo-id.ts` — Deterministic method ID + bag-of-words body fingerprint helpers
- [ ] `src/services/pseudo-schema.ts` — SQLite schema DDL as a module (files, methods, method_steps, method_calls, file_imports, overlay_matches, orphan_prose, scan_runs, scan_errors, fts5)
- [ ] `src/services/pseudo-snapshot.ts` — `.cache/derived.sqlite` ATTACH/integrity_check serialize + load
- [ ] `src/services/pseudo-prose-file.ts` — Committed prose file reader/writer with atomic tmp-rename + fsync + schema validation + diff-sanity
- [ ] `src/services/pseudo-docstring.ts` — Per-language docstring extractors (JSDoc, TSDoc, PEP 257, C# XML doc, Doxygen)
- [ ] `src/services/pseudo-indexer.ts` — `runFullScan` / `runIncrementalScan` / `runReranking` / `runOrphanDetection` with AbortSignal plumbing
- [ ] `src/services/pseudo-overlay.ts` — Hierarchical overlay lookup with 6-level fallback producing `match_quality` metadata
- [ ] `src/services/pseudo-drift.ts` — Layer 2 periodic + Layer 3 idle drift detection
- [ ] `src/services/pseudo-watcher.ts` — chokidar wiring for Layer 1 continuous drift
- [ ] `src/services/pseudo-ctags.ts` — ctags detect + JSON parse + complement scanner for Go/Rust/Java/Kotlin/Ruby
- [ ] `src/services/pseudo-ranking.ts` — Git-blame ownership pass (single `git log --all` invocation) + priority scoring
- [ ] `src/services/pseudo-orphan.ts` — Single-git-pass orphan detection with cross-branch awareness + fuzzy suggestions
- [ ] `src/services/pseudo-fts.ts` — FTS5 setup + query helpers (used by `pseudo_search` and `pseudo_find_function`)
- [ ] `src/services/pseudo-migration.ts` — One-time v1 SQLite → v6 prose files migration
- [ ] `src/services/pseudo-path-escape.ts` — Windows reserved-name escaping + collision hash suffix
- [ ] `src/mcp/tools/pseudo-status.ts` — `pseudo_db_status`
- [ ] `src/mcp/tools/pseudo-rescan.ts` — `pseudo_rescan`, `pseudo_rerank`
- [ ] `src/mcp/tools/pseudo-reassign.ts` — `pseudo_reassign_prose`, `pseudo_reassign_prose_bulk`
- [ ] `src/mcp/tools/pseudo-search.ts` — `pseudo_search`
- [ ] `src/mcp/tools/pseudo-graph.ts` — `pseudo_import_graph`, `pseudo_call_chain`, `pseudo_stats_delta`
- [ ] `src/mcp/tools/pseudo-ranking-tools.ts` — `pseudo_hot_files`, `pseudo_list_heuristic_files`, `pseudo_team_ownership`
- [ ] `src/mcp/tools/pseudo-orphan-tools.ts` — `pseudo_list_orphaned_prose`, `pseudo_cleanup_orphaned_prose`
- [ ] `skills/pseudocode-seed/SKILL.md` — New skill using `pseudo_hot_files`
- [ ] `ui/src/components/pseudo/PseudoStatusBar.tsx` — Onboarding status indicator
- [ ] `ui/src/components/pseudo/ProseOriginBadge.tsx` — "AUTO" chip for heuristic prose
- [ ] `ui/src/components/pseudo/RenameWarningsList.tsx` — One-click reassign surface

### Modified files

- [ ] `src/services/pseudo-db.ts` — Rewrite for `:memory:` backing + snapshot load + auto-trigger + retry + overlay wiring
- [ ] `src/services/source-scanner.ts` — Extract `walkProject()` async generator, keep existing regex scanners, remove dead walker code
- [ ] `src/mcp/setup.ts:3771-3828` — Replace existing `pseudo_*` tool handlers with calls to new tool modules; add new tool registrations
- [ ] `src/mcp/tools/pseudo-upsert-prose.ts` (extracted from setup.ts) — Required `origin` param, diff-sanity check, deterministic ID on merge
- [ ] `skills/pseudocode/SKILL.md` — Updated heuristic-upgrade workflow + rename detection flow
- [ ] `.claude-plugin/plugin.json` — Add SessionStart → `pseudo_rescan` hook wiring

### Key type definitions

```ts
// src/services/pseudo-id.ts
export interface MethodIdentity {
  file_path: string;
  enclosing_class: string | null;
  name: string;
  normalized_params: string;
}
export function computeMethodId(m: MethodIdentity): string;
export function normalizeParams(rawParams: string): string;
export function computeBodyFingerprint(methodBody: string): string;

// src/services/pseudo-schema.ts
export const SCHEMA_VERSION = 3;
export function createSchema(db: Database): void;
export function dropSchema(db: Database): void;

// src/services/pseudo-snapshot.ts
export interface SnapshotValidation {
  valid: boolean;
  reason?: 'missing' | 'integrity_check' | 'schema_mismatch' | 'file_count' | 'sample_hash' | 'too_old';
}
export function writeSnapshot(db: Database, project: string): Promise<void>;
export function validateSnapshot(path: string, gitFileCount: number, sampleFiles: Map<string, string>): Promise<SnapshotValidation>;
export function loadSnapshot(db: Database, path: string): Promise<void>;

// src/services/pseudo-prose-file.ts
export interface ProseFileV3 {
  schema_version: 3;
  file: string;
  title: string;
  purpose: string;
  module_context: string;
  methods: Array<{
    id: string;
    name: string;
    enclosing_class: string | null;
    normalized_params: string;
    body_fingerprint: string;
    prose_origin: 'manual' | 'llm';
    steps: Array<{ order: number; content: string }>;
    tags: { deprecated: boolean; since?: string };
  }>;
}
export function readProseFile(path: string): Promise<ProseFileV3 | null>;
export function writeProseFile(path: string, content: ProseFileV3): Promise<void>;
export function validateProseSchema(raw: unknown): ProseFileV3;

// src/services/pseudo-overlay.ts
export type MatchQuality = 'exact' | 'param_mismatch' | 'class_mismatch' | 'fuzzy_rename' | 'fuzzy_move' | 'orphan';
export interface OverlayResult {
  attachedProse: Map<string /*method row id*/, ProseMethodEntry>;
  matches: Array<{ method_row_id: string; quality: MatchQuality; warning?: string }>;
  orphans: Array<{ prose_method: ProseMethodEntry; suggestions: FuzzyMatch[] }>;
}
export function overlayProseOnMethods(
  proseFiles: Map<string, ProseFileV3>,
  sourceMethods: SourceMethodRow[]
): OverlayResult;

// src/services/pseudo-drift.ts
export interface DriftChecker {
  start(): void;
  stop(): void;
  checkNow(mode: 'stat' | 'hash_sample' | 'full'): Promise<DriftReport>;
}
export function createDriftChecker(project: string, indexer: PseudoIndexer): DriftChecker;

// src/services/pseudo-indexer.ts
export interface ScanOptions {
  signal?: AbortSignal;
  trigger: 'auto' | 'manual' | 'incremental' | 'watcher' | 'reconcile' | 'sessionstart';
}
export interface PseudoIndexer {
  runFullScan(opts?: ScanOptions): Promise<ScanRun>;
  runIncrementalScan(paths: string[], opts?: ScanOptions): Promise<ScanRun>;
  runIncrementalScanForFile(path: string, opts?: ScanOptions): Promise<void>;
  runReranking(opts?: ScanOptions): Promise<void>;
  runOrphanDetection(opts?: ScanOptions): Promise<OrphanReport>;
  cancel(): void;
}
```

### Component interactions

```
MCP tool call
   │
   ▼
getPseudoDb(project)  ──► opens :memory: SQLite, kicks background scan if needed
   │                       tries warm-start snapshot load first
   ▼
pseudo-db.ts (singleton per project)
   │
   ├─► pseudo-indexer.ts  ──► pseudo-schema.ts (schema init)
   │                       ──► source-scanner.ts (walker + regex scan)
   │                       ──► pseudo-docstring.ts (heuristic extract)
   │                       ──► pseudo-ctags.ts (complement scan)
   │                       ──► pseudo-prose-file.ts (read committed)
   │                       ──► pseudo-overlay.ts (hierarchical match)
   │                       ──► pseudo-id.ts (deterministic IDs)
   │                       ──► pseudo-ranking.ts (git-blame)
   │                       ──► pseudo-orphan.ts (cross-branch detect)
   │                       ──► pseudo-snapshot.ts (serialize at end)
   │
   ├─► pseudo-watcher.ts ──► Layer 1 drift via chokidar
   │
   ├─► pseudo-drift.ts   ──► Layers 2+3 drift (periodic + idle)
   │
   └─► pseudo-fts.ts     ──► FTS5 queries
         │
         ▼
    MCP tool module responds with prose_origin + match_quality + warnings
```

---

## 2. Function Blueprints

### `computeMethodId(m: MethodIdentity): string`

```
1. Normalize file_path: replace backslash with forward slash, strip leading ./
2. Build key = [path, enclosing_class ?? '', name, normalized_params].join('::')
3. hash = SHA1(key)
4. return 'm_' + hash.slice(0, 8)
```

**Edge cases:** unicode method names (accept as-is, hash is byte-based), empty enclosing_class normalized to empty string, params with generic brackets `<T>` preserved.

**Test strategy:** unit tests with known inputs + expected hashes (pin the function output so regressions show up).

---

### `normalizeParams(rawParams: string): string`

```
1. Strip surrounding parens from rawParams
2. Split on top-level commas (respecting nesting in <>, [], {}, ())
3. For each param:
   a. Strip leading modifiers (public, private, readonly, ...)
   b. Extract just the type annotation (everything after ':')
   c. Strip default values (everything after '=')
   d. Collapse whitespace to single space
   e. If no type annotation (untyped), use 'any' as fallback
4. Return joined with ',' (no spaces)
```

**Edge cases:** destructured params (`{a, b}: Opts`), rest params (`...args: any[]`), Python default args (`x=5`), untyped languages (return 'untyped' marker).

**Test strategy:** table test with 20+ param signatures covering TS/JS/Python/C# edge cases.

---

### `computeBodyFingerprint(methodBody: string): string`

```
1. identifiers = tokenize(methodBody)
   .filter(token => isIdentifier(token))
   .filter(token => !isKeyword(token))
2. unique = Set(identifiers)
3. filtered = [...unique].filter(t => !STOP_WORDS.has(t))
4. sorted = filtered.sort()
5. return 'h_' + SHA1(sorted.join(' ')).slice(0, 8)

STOP_WORDS = [
  'this', 'self', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var',
  'function', 'def', 'async', 'await', 'new', 'null', 'undefined', 'true', 'false',
  'throw', 'try', 'catch', 'finally', 'break', 'continue'
]
```

**Edge cases:** empty body (return `'h_empty___'`), body with only comments after stripping (return empty-marker), body with > 500 unique identifiers (truncate to first 500 sorted for bounded hash cost).

**Test strategy:**
- Identical bodies → same fingerprint
- Variable rename → same fingerprint
- Add logging → same fingerprint (logger is stop word)
- Add new API call → different fingerprint
- Reorder statements → same fingerprint

---

### `walkProject(root: string, opts?: WalkOptions): AsyncIterable<string>`

```
1. If opts.respectGitignore (default true) and root is a git repo:
   a. Spawn `git ls-files --cached --others --exclude-standard`
   b. For each path, yield it if it passes extension/exclude filters
2. Else:
   a. Use fs.promises.opendir for recursive walk
   b. Skip SCANNER_EXCLUDES directories
   c. For each file, yield if extension is supported
3. Always layer .pseudoignore patterns on top
4. Respect AbortSignal between batches of 50 files
```

**Edge cases:** symlinks (follow but break cycles via visited set), submodules (walk top-level only, skip submodule contents), permission errors (log to scan_errors, continue).

**Test strategy:** fixture directories with gitignore, pseudoignore, symlinks, binary files.

---

### `runFullScan(opts: ScanOptions): Promise<ScanRun>`

```
1. Acquire in-process scan mutex (reject if already running)
2. Create scan_runs row with status='running'
3. try:
     a. Delete all rows from in-memory tables (fresh scan)
     b. Initialize empty overlay_matches, orphan_prose
     c. Walk project → yield source file paths
     d. For each source file:
        - Check AbortSignal, bail if set
        - Read file, compute source_hash
        - If size > 500KB or > 10K lines: insert stub row, continue
        - Run scanSourceFile() → structural methods
        - Run extractDocstringProse() → heuristic prose per method
        - For each method: compute deterministic id + body_fingerprint
        - Insert file row + method rows + method_steps (heuristic)
        - Capture import_edges, call_edges
     e. Read all committed prose files from .collab/pseudo/prose/
     f. Run overlayProseOnMethods() to upgrade heuristic → manual/llm
     g. Run runOrphanDetection() to classify unmatched prose
     h. Update scan_runs row: status='done', files_scanned, errors
     i. Write snapshot to .cache/derived.sqlite
   catch (err):
     - Update scan_runs row: status='failed', error=err.message
     - Rethrow
   finally:
     - Release scan mutex
4. Return scan_runs row
```

**Error handling:** per-file scan errors go to scan_errors table, don't abort the run. Walker failures and SQLite errors abort the run with scan_runs.status='failed'. AbortSignal triggers scan_runs.status='cancelled'.

**Test strategy:** integration test on a fixture project; verify scan_runs + files + methods + overlay_matches tables are populated correctly.

---

### `overlayProseOnMethods(proseFiles: Map<string, ProseFileV3>, sourceMethods: SourceMethodRow[]): OverlayResult`

```
1. Build sourceByFile map: file_path → SourceMethodRow[]
2. Build sourceByid map: computed_id → SourceMethodRow
3. attachedProse = Map()
4. matches = []
5. orphans = []
6. For each prose_file in proseFiles:
     For each prose_method in prose_file.methods:
       source = try in order:
         a. sourceByid.get(prose_method.id)   → 'exact'
         b. sourceByFile[prose_file].find by (class, name, params match)  → 'exact'
         c. sourceByFile[prose_file].find by (class, name) param tolerance → 'param_mismatch'
         d. sourceByFile[prose_file].find by name alone → 'class_mismatch'
         e. sourceByFile[prose_file].find by body_fingerprint match → 'fuzzy_rename'
         f. sourceByid (across all files) find by body_fingerprint match → 'fuzzy_move'
         g. null → 'orphan'
       if source:
         attachedProse.set(source.id, prose_method)
         matches.push({ method_row_id: source.id, quality, warning })
       else:
         suggestions = fuzzyMatchSameDirectory(prose_method, sourceByFile[prose_file])
         orphans.push({ prose_method, suggestions })
7. Return { attachedProse, matches, orphans }
```

**Error handling:** malformed prose files (fails schema validation) are logged to scan_errors but do not abort overlay.

**Test strategy:**
- Write prose for a method, rename it in source, verify fuzzy_rename match fires
- Move a method to another file, verify fuzzy_move
- Delete a method entirely, verify orphan + suggestions
- Write prose with params mismatch, verify param_mismatch warning

---

### `validateSnapshot(path, gitFileCount, sampleFiles): Promise<SnapshotValidation>`

```
1. If !fs.existsSync(path): return { valid: false, reason: 'missing' }
2. Open SQLite at path in readonly mode
3. Run PRAGMA integrity_check; if not 'ok': return { valid: false, reason: 'integrity_check' }
4. SELECT value FROM cache_meta WHERE key='schema_version'
   If !== SCHEMA_VERSION: return { valid: false, reason: 'schema_mismatch' }
5. SELECT COUNT(*) FROM files
   If outside gitFileCount ± 5%: return { valid: false, reason: 'file_count' }
6. SELECT value FROM cache_meta WHERE key='generated_at'
   If now - generated_at > 7 days: return { valid: false, reason: 'too_old' }
7. For each (path, hash) in sampleFiles:   // 30 random files
     SELECT source_hash FROM files WHERE file_path = ?
     If stored !== current_hash: return { valid: false, reason: 'sample_hash' }
8. Close readonly connection
9. Return { valid: true }
```

**Error handling:** any SQLite error during validation → `{ valid: false, reason: 'integrity_check' }`.

**Test strategy:**
- Valid snapshot → loads in <1s
- Corrupted snapshot → integrity_check fails, deleted, cold rebuild
- Schema mismatch → rejected
- Stale snapshot (8 days old) → rejected
- File count drifted > 5% → rejected

---

### `runOrphanDetection(opts: ScanOptions): Promise<OrphanReport>`

```
1. Compute current working tree source set (via walkProject)
2. Collect committed prose files from .collab/pseudo/prose/
3. Run single `git log --all --name-only --since=30.days.ago --pretty=format:` → parse paths → Set(recentFiles)
4. For each prose_file_path:
     source_path = derive from prose_file_path (strip .collab/pseudo/prose/ prefix, strip .json suffix)
     If source_path IN currentSourceSet: skip (has matching source)
     ElseIf source_path IN recentFiles:
       status = 'cross-branch-orphan'
     Else:
       status = 'orphan-candidate'
       suggestions = fuzzyMatchSameDirectory(prose_file, currentSourceSet)
     Insert into orphan_prose table
5. Return { crossBranch: [...], actualOrphans: [...] }
```

**Error handling:** git command failures → log to scan_errors, return empty set (all prose files counted as valid since we can't tell).

**Test strategy:** fixture with moved files across git history.

---

### `writeProseFile(path: string, content: ProseFileV3): Promise<void>`

```
1. Validate content against ProseFileV3 schema (ajv or hand-rolled)
2. Ensure directory exists (mkdir -p)
3. tmpPath = path + '.tmp'
4. handle = fs.openSync(tmpPath, 'w')
5. fs.writeSync(handle, JSON.stringify(content, null, 2))
6. fs.fsyncSync(handle)
7. fs.closeSync(handle)
8. fs.renameSync(tmpPath, path)
```

**Error handling:** if tmp write fails, cleanup tmpPath and rethrow. If rename fails, leave tmp file for next scan to clean up.

**Test strategy:** crash injection between write and rename; verify no corruption of existing file.

---

### `runMigrationFromV1(project: string): Promise<MigrationReport>`

```
1. Check if old pseudo.db exists at legacy path
2. If not → return { migrated: 0 }
3. Open old pseudo.db in readonly
4. SELECT file_path, title, purpose, module_context FROM files WHERE has_prose = 1
5. For each file:
     methodRows = SELECT name, params, return_type, ... FROM methods WHERE file_id = ?
     stepRows = SELECT ... FROM method_steps WHERE method_id IN (...)
     Reconstruct ProseFileV3:
       - For each method, compute deterministic id from (file_path, class, name, normalized(params))
       - Compute body_fingerprint by re-reading the current source file
       - Set prose_origin: 'manual' (v1 prose was always manual)
     writeProseFile(.collab/pseudo/prose/<file>.json, reconstructed)
6. Close old db, delete old pseudo.db
7. Write migration completion flag to .collab/pseudo/.migrated
8. Return { migrated: fileCount }
```

**Error handling:** per-file migration failures go to a migration-errors log; continue with remaining files. Catastrophic failures (can't open old db) abort cleanly.

**Test strategy:** fixture v1 pseudo.db + fixture source → verify produced prose files match expected shape.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  # ───────────────────────────────────────────────────────────
  # Wave 1 — Foundation primitives (all parallel, no deps)
  # ───────────────────────────────────────────────────────────
  - id: pseudo-id
    files: [src/services/pseudo-id.ts]
    tests: [src/services/pseudo-id.test.ts]
    description: "Deterministic method ID via SHA1(file::class::name::normalized_params), normalized_params helper, bag-of-words body_fingerprint with stop words and order-independent hashing"
    parallel: true
    depends-on: []

  - id: pseudo-schema
    files: [src/services/pseudo-schema.ts]
    tests: [src/services/pseudo-schema.test.ts]
    description: "SCHEMA_VERSION = 3, createSchema(db) with tables: files, methods, method_steps, method_calls, file_imports, overlay_matches, orphan_prose, scan_runs, scan_errors, cache_meta; FTS5 virtual table over title/purpose/step_content/method_names; indices for lookup patterns"
    parallel: true
    depends-on: []

  - id: pseudo-path-escape
    files: [src/services/pseudo-path-escape.ts]
    tests: [src/services/pseudo-path-escape.test.ts]
    description: "Windows reserved-name escaping (CON/AUX/NUL/COM1-9/LPT1-9/PRN → append underscore), forbidden-char replacement (<>:\"|?* → _), collision hash suffix, optional _path_map.json sidecar when escaping occurred"
    parallel: true
    depends-on: []

  - id: source-walker
    files: [src/services/source-scanner.ts]
    tests: [src/services/source-scanner.test.ts]
    description: "Add shared walkProject() async generator honoring git ls-files for tracked repos and fs walk for untracked-but-not-ignored files, layered .pseudoignore patterns, AbortSignal support every 50 files, symlink cycle detection"
    parallel: true
    depends-on: []

  # ───────────────────────────────────────────────────────────
  # Wave 2 — Core storage + prose I/O + docstrings
  # ───────────────────────────────────────────────────────────
  - id: pseudo-snapshot
    files: [src/services/pseudo-snapshot.ts]
    tests: [src/services/pseudo-snapshot.test.ts]
    description: "writeSnapshot via ATTACH DATABASE + CREATE TABLE AS SELECT for every table, validateSnapshot with PRAGMA integrity_check + schema version check + ±5% file count + 30-file random source_hash sample + 7-day TTL, loadSnapshot via INSERT SELECT into :memory:"
    parallel: true
    depends-on: [pseudo-schema]

  - id: pseudo-prose-file
    files: [src/services/pseudo-prose-file.ts]
    tests: [src/services/pseudo-prose-file.test.ts]
    description: "ProseFileV3 type, readProseFile with schema validation, writeProseFile with atomic tmp+fsync+rename, validateProseSchema (ajv or hand-rolled), path encoding via pseudo-path-escape"
    parallel: true
    depends-on: [pseudo-id, pseudo-path-escape]

  - id: pseudo-docstring
    files: [src/services/pseudo-docstring.ts]
    tests: [src/services/pseudo-docstring.test.ts]
    description: "Per-language docstring extractors (JSDoc, TSDoc, PEP 257 with numpy/Google-flavor detection, C# XML doc, Doxygen). Within-2-lines attribution rule, first-line→title, remaining→purpose, @param/@returns/@throws/lists→steps, @deprecated/@since→tags. Returns ambiguity errors for cases where attachment is unclear."
    parallel: true
    depends-on: []

  # ───────────────────────────────────────────────────────────
  # Wave 3 — Overlay + migration + drift layers + scanner
  # ───────────────────────────────────────────────────────────
  - id: pseudo-overlay
    files: [src/services/pseudo-overlay.ts]
    tests: [src/services/pseudo-overlay.test.ts]
    description: "Hierarchical overlay lookup: 1) id exact, 2) (file, class, name, params) exact, 3) (file, class, name) param tolerance, 4) (file, name) no class, 5) body_fingerprint same-file, 6) body_fingerprint cross-file, 7) orphan with fuzzy suggestions. Returns OverlayResult with match_quality per attachment."
    parallel: true
    depends-on: [pseudo-prose-file, pseudo-id]

  - id: pseudo-migration
    files: [src/services/pseudo-migration.ts]
    tests: [src/services/pseudo-migration.test.ts]
    description: "One-time v1 SQLite → v6 prose files: detect legacy pseudo.db, read files+methods+method_steps, reconstruct ProseFileV3 per file with computed deterministic IDs + current-source body_fingerprints, writeProseFile, delete old db, write .migrated flag"
    parallel: true
    depends-on: [pseudo-prose-file, pseudo-id]

  - id: pseudo-regex-scanner
    files: [src/services/source-scanner.ts]
    tests: [src/services/source-scanner.regex.test.ts]
    description: "Regex scanner refactor: keep existing TS/JS/PY/C#/C++ regex extraction, return StructuralMethod[] with enclosing_class for class methods, is_async, is_exported, call edges. Does NOT write directly to DB — pure function returning data for the indexer to insert."
    parallel: false
    depends-on: [source-walker]

  - id: pseudo-fts
    files: [src/services/pseudo-fts.ts]
    tests: [src/services/pseudo-fts.test.ts]
    description: "FTS5 wiring: INSERT triggers on files/methods/method_steps tables to keep fts5 virtual table current, rank() query helpers for pseudo_find_function and pseudo_search, filter by prose_origin support"
    parallel: true
    depends-on: [pseudo-schema]

  # ───────────────────────────────────────────────────────────
  # Wave 4 — Indexer core + ctags + ranking + orphan + drift
  # ───────────────────────────────────────────────────────────
  - id: pseudo-indexer-core
    files: [src/services/pseudo-indexer.ts]
    tests: [src/services/pseudo-indexer.test.ts]
    description: "runFullScan, runIncrementalScan, runIncrementalScanForFile: acquire in-process mutex, AbortSignal plumbing, per-file error capture to scan_errors, scan_runs bookkeeping with start/finish timestamps, delegates to walker/scanner/overlay/orphan/ranking, writes snapshot at end"
    parallel: false
    depends-on: [pseudo-schema, source-walker, pseudo-regex-scanner, pseudo-docstring, pseudo-overlay, pseudo-snapshot, pseudo-fts]

  - id: pseudo-ctags
    files: [src/services/pseudo-ctags.ts]
    tests: [src/services/pseudo-ctags.test.ts]
    description: "Opt-in complement scanner: detect system universal-ctags via ctags --version, spawn with --output-format=json --fields=+nKzSl for Go/Rust/Java/Kotlin/Ruby extensions only. Map ctags JSON output to StructuralMethod[] with kind/scope/line. Graceful fallback when absent — log warning, proceed with regex only."
    parallel: true
    depends-on: [pseudo-regex-scanner]

  - id: pseudo-ranking
    files: [src/services/pseudo-ranking.ts]
    tests: [src/services/pseudo-ranking.test.ts]
    description: "Single git log --all --name-only --since=90.days.ago --format='%H %at %ae' pass, parse into file → {owner, touch_count_90d, last_touched, co_authors[]}, compute priority = touch_count_90d * log(line_count), UPDATE files rows, detect generated file patterns (*-generated.*, *.pb.go, etc) to exclude"
    parallel: true
    depends-on: [pseudo-indexer-core]

  - id: pseudo-orphan
    files: [src/services/pseudo-orphan.ts]
    tests: [src/services/pseudo-orphan.test.ts]
    description: "Single git log --all --name-only --since=30.days.ago pass → Set(recentFiles), walk prose tree, derive source_path from each prose file, classify as current/cross-branch-orphan/orphan-candidate, fuzzy-match same-directory suggestions for orphan candidates, INSERT into orphan_prose table"
    parallel: true
    depends-on: [pseudo-indexer-core]

  - id: pseudo-drift
    files: [src/services/pseudo-drift.ts]
    tests: [src/services/pseudo-drift.test.ts]
    description: "createDriftChecker returns start/stop/checkNow interface. Layer 2: setInterval every 5 min, git ls-files + stat, queue runIncrementalScanForFile on mismatches. Layer 3: after 30s no MCP activity, random 10% content-hash sample, detect in-place edits. Respects in-process mutex, pauses during active scans."
    parallel: true
    depends-on: [pseudo-indexer-core]

  # ───────────────────────────────────────────────────────────
  # Wave 5 — MCP tools + auto-trigger + watcher
  # ───────────────────────────────────────────────────────────
  - id: pseudo-db-rewrite
    files: [src/services/pseudo-db.ts]
    tests: [src/services/pseudo-db.test.ts]
    description: "Rewrite getPseudoDb for :memory: backing. On first call: try warm-start snapshot load; on failure, kick background runFullScan. Singleton per project. Fire-and-forget scan with retry policy (no auto-retry within 5min of failure). Attach drift checker + watcher. Dispose cleanly on server shutdown."
    parallel: false
    depends-on: [pseudo-indexer-core, pseudo-drift, pseudo-migration]

  - id: pseudo-watcher
    files: [src/services/pseudo-watcher.ts]
    tests: [src/services/pseudo-watcher.test.ts]
    description: "chokidar wrapping: watches source tree + .collab/pseudo/prose/, 100ms debounced batched queue, on source change → indexer.runIncrementalScanForFile, on prose change → indexer.reloadProseOverlay. Respects in-process mutex, pauses during full scans."
    parallel: true
    depends-on: [pseudo-indexer-core]

  - id: pseudo-tool-status
    files: [src/mcp/tools/pseudo-status.ts]
    tests: [src/mcp/tools/pseudo-status.test.ts]
    description: "pseudo_db_status tool: schemaVersion, fileCount, filesWithProse, proseBreakdown {heuristic,manual,llm,mixed,none}, lastScan, isScanning, scanProgress, warnings from orphan_prose + overlay_matches, ctagsAvailable, cacheMode"
    parallel: true
    depends-on: [pseudo-db-rewrite]

  - id: pseudo-tool-rescan
    files: [src/mcp/tools/pseudo-rescan.ts]
    tests: [src/mcp/tools/pseudo-rescan.test.ts]
    description: "pseudo_rescan({mode: 'full'|'incremental'|'drift_check', cancel?}) and pseudo_rerank({cancel?}) tools. Wire cancel flag through AbortSignal to in-progress scans."
    parallel: true
    depends-on: [pseudo-db-rewrite]

  - id: pseudo-tool-upsert-prose
    files: [src/mcp/tools/pseudo-upsert-prose.ts]
    tests: [src/mcp/tools/pseudo-upsert-prose.test.ts]
    description: "Updated pseudo_upsert_prose with required origin: 'manual'|'llm' parameter. Schema validate input. Diff-sanity check (reject if new methods drop > 50% of existing). In-process per-file mutex. Read existing → merge preserving other entries → compute deterministic IDs for new entries → writeProseFile → fire-and-forget in-memory update."
    parallel: true
    depends-on: [pseudo-db-rewrite, pseudo-prose-file]

  - id: pseudo-tool-reassign
    files: [src/mcp/tools/pseudo-reassign.ts]
    tests: [src/mcp/tools/pseudo-reassign.test.ts]
    description: "pseudo_reassign_prose({file, old, new}) single reassignment + pseudo_reassign_prose_bulk({mappings, confirm: true}) for post-refactor batch. Load prose file, find entry by old identity, update name/class/params fields (ID stays stable), writeProseFile atomically, trigger overlay refresh."
    parallel: true
    depends-on: [pseudo-db-rewrite, pseudo-prose-file]

  - id: pseudo-tool-search
    files: [src/mcp/tools/pseudo-search.ts]
    tests: [src/mcp/tools/pseudo-search.test.ts]
    description: "pseudo_search(query, {filterOrigin}) and updated pseudo_find_function(name) — both query the fts5 virtual table via pseudo-fts helpers, returning ranked results with prose_origin + match_quality"
    parallel: true
    depends-on: [pseudo-db-rewrite, pseudo-fts]

  - id: pseudo-tool-graph
    files: [src/mcp/tools/pseudo-graph.ts]
    tests: [src/mcp/tools/pseudo-graph.test.ts]
    description: "pseudo_import_graph(file) joining file_imports, pseudo_call_chain(method, {direction, depth}) via recursive CTE over method_calls, pseudo_stats_delta({sinceRunId}) diffing scan_runs bookkeeping"
    parallel: true
    depends-on: [pseudo-db-rewrite]

  - id: pseudo-tool-ranking-tools
    files: [src/mcp/tools/pseudo-ranking-tools.ts]
    tests: [src/mcp/tools/pseudo-ranking-tools.test.ts]
    description: "pseudo_hot_files({limit}) returning files ORDER BY priority DESC, pseudo_list_heuristic_files({limit, orderBy}) filtering prose_origin='heuristic', pseudo_team_ownership() aggregating co_authors into team clusters"
    parallel: true
    depends-on: [pseudo-db-rewrite, pseudo-ranking]

  - id: pseudo-tool-orphan-tools
    files: [src/mcp/tools/pseudo-orphan-tools.ts]
    tests: [src/mcp/tools/pseudo-orphan-tools.test.ts]
    description: "pseudo_list_orphaned_prose returning {crossBranch, actualOrphans: [{file, suggestions}]}, pseudo_cleanup_orphaned_prose({files, confirm: true}) — require explicit confirm, atomically delete the prose files, update in-memory orphan_prose table"
    parallel: true
    depends-on: [pseudo-db-rewrite, pseudo-orphan]

  - id: pseudo-tool-get-file-state
    files: [src/mcp/tools/pseudo-get-file-state.ts]
    tests: [src/mcp/tools/pseudo-get-file-state.test.ts]
    description: "Updated pseudo_get_file_state returning {file, file_prose_origin, warnings (from overlay_matches for this file), methods: [...with prose_origin and match_quality per method]}. Skill-readable warnings array for rename candidates."
    parallel: true
    depends-on: [pseudo-db-rewrite]

  # ───────────────────────────────────────────────────────────
  # Wave 6 — MCP setup wiring + hooks + skills
  # ───────────────────────────────────────────────────────────
  - id: mcp-setup-wiring
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts]
    description: "Replace lines 3771-3828 pseudo_* tool handlers with calls to new tool modules. Register all new tool schemas (pseudo_db_status, pseudo_rescan, pseudo_rerank, pseudo_reassign_prose*, pseudo_search, pseudo_hot_files, pseudo_list_heuristic_files, pseudo_list_orphaned_prose, pseudo_cleanup_orphaned_prose, pseudo_import_graph, pseudo_call_chain, pseudo_stats_delta, pseudo_team_ownership). Remove dead code paths."
    parallel: false
    depends-on: [pseudo-tool-status, pseudo-tool-rescan, pseudo-tool-upsert-prose, pseudo-tool-reassign, pseudo-tool-search, pseudo-tool-graph, pseudo-tool-ranking-tools, pseudo-tool-orphan-tools, pseudo-tool-get-file-state]

  - id: plugin-sessionstart-hook
    files: [.claude-plugin/plugin.json]
    tests: []
    description: "Add SessionStart hook wiring that calls pseudo_rescan({mode: 'incremental'}) to keep the DB warm on session entry. Existing SessionStart hook at lines 21-30 gets a second command."
    parallel: true
    depends-on: [pseudo-tool-rescan]

  - id: skill-pseudocode-update
    files: [skills/pseudocode/SKILL.md]
    tests: []
    description: "Update skill prose: heuristic prose is a draft to upgrade, rename detection via match_quality warnings, teach model to run pseudo_reassign_prose on fuzzy_rename warnings with high confidence, show the user the bulk reassign path after big refactors"
    parallel: true
    depends-on: [pseudo-tool-upsert-prose, pseudo-tool-reassign]

  - id: skill-pseudocode-seed
    files: [skills/pseudocode-seed/SKILL.md]
    tests: []
    description: "New /pseudocode-seed skill: calls pseudo_hot_files to get top-K priority files, walks them in order running the existing /pseudocode flow on each, bounded by user-specified budget, reports progress to the user"
    parallel: true
    depends-on: [pseudo-tool-ranking-tools]

  # ───────────────────────────────────────────────────────────
  # Wave 7 — UI components
  # ───────────────────────────────────────────────────────────
  - id: ui-pseudo-status-bar
    files: [ui/src/components/pseudo/PseudoStatusBar.tsx]
    tests: [ui/src/components/pseudo/PseudoStatusBar.test.tsx]
    description: "Onboarding UI component that polls pseudo_db_status every 2s when isScanning, shows progress bar {current}/{total}, lastScan result, ctagsAvailable note, cacheMode indicator, integrates into Sidebar onboarding slot"
    parallel: true
    depends-on: [pseudo-tool-status, mcp-setup-wiring]

  - id: ui-prose-origin-badge
    files: [ui/src/components/pseudo/ProseOriginBadge.tsx]
    tests: [ui/src/components/pseudo/ProseOriginBadge.test.tsx]
    description: "AUTO badge component for heuristic prose visible in sidebar + pseudo viewer. Distinct style (gray chip with AUTO label), click-to-explain tooltip, shows in every place prose is listed"
    parallel: true
    depends-on: [mcp-setup-wiring]

  - id: ui-rename-warnings
    files: [ui/src/components/pseudo/RenameWarningsList.tsx]
    tests: [ui/src/components/pseudo/RenameWarningsList.test.tsx]
    description: "Component reading pseudo_db_status.warnings for fuzzy_rename/fuzzy_move entries, displays list with Approve/Dismiss buttons wired to pseudo_reassign_prose, bulk Approve All triggering pseudo_reassign_prose_bulk with confirm"
    parallel: true
    depends-on: [pseudo-tool-status, pseudo-tool-reassign, mcp-setup-wiring]

  # ───────────────────────────────────────────────────────────
  # Wave 8 — Integration, Windows, edge cases, docs
  # ───────────────────────────────────────────────────────────
  - id: test-integration-multiplatform
    files: [src/services/__tests__/pseudo-integration.multiplatform.test.ts]
    tests: [src/services/__tests__/pseudo-integration.multiplatform.test.ts]
    description: "Integration tests running on macOS/Linux/Windows: full scan on fixture repo, snapshot write+load roundtrip, incremental scan on file change, watcher event handling, committed prose roundtrip, migration from v1 fixture, ctags opt-in path"
    parallel: true
    depends-on: [mcp-setup-wiring, ui-pseudo-status-bar, ui-prose-origin-badge, ui-rename-warnings, skill-pseudocode-update, skill-pseudocode-seed, plugin-sessionstart-hook]

  - id: test-stress-monorepo
    files: [src/services/__tests__/pseudo-stress.test.ts]
    tests: [src/services/__tests__/pseudo-stress.test.ts]
    description: "Stress tests on synthetic 10k-file monorepo: measure cold scan time, warm-start load time, FTS query latency, incremental scan under bulk refactor burst, memory footprint ceiling"
    parallel: true
    depends-on: [mcp-setup-wiring]

  - id: test-identity-edge-cases
    files: [src/services/__tests__/pseudo-identity.edge.test.ts]
    tests: [src/services/__tests__/pseudo-identity.edge.test.ts]
    description: "Edge cases for deterministic ID + overlay: TypeScript overloads + impl signature, generic methods <T>, arrow function assigned to const, Python dataclass methods, C++ templates, computed method names, same-name across classes, rename refactor scenarios"
    parallel: true
    depends-on: [mcp-setup-wiring]

  - id: docs-migration-guide
    files: [docs/pseudo-db-v6-migration.md]
    tests: []
    description: "User-facing migration guide: what changes from v1, how prose files are committed, how to handle rename warnings, how to bulk-reassign, how to opt out via .pseudoignore, OneDrive/WSL2 limitations, cache mode explanation"
    parallel: true
    depends-on: [mcp-setup-wiring]
```

### Execution Waves

**Wave 1 (parallel, 4 tasks):**
- pseudo-id, pseudo-schema, pseudo-path-escape, source-walker

**Wave 2 (parallel, 3 tasks — depends on Wave 1):**
- pseudo-snapshot, pseudo-prose-file, pseudo-docstring

**Wave 3 (parallel, 4 tasks — depends on Wave 2 + Wave 1):**
- pseudo-overlay, pseudo-migration, pseudo-regex-scanner, pseudo-fts

**Wave 4 (serial: indexer-core first, then parallel fan-out):**
- pseudo-indexer-core (serial, depends on Waves 1-3)
- Then parallel: pseudo-ctags, pseudo-ranking, pseudo-orphan, pseudo-drift

**Wave 5 (serial: db-rewrite + watcher, then parallel tool fan-out):**
- pseudo-db-rewrite (serial, depends on indexer-core + drift + migration)
- pseudo-watcher (parallel with tools)
- Then parallel: pseudo-tool-status, pseudo-tool-rescan, pseudo-tool-upsert-prose, pseudo-tool-reassign, pseudo-tool-search, pseudo-tool-graph, pseudo-tool-ranking-tools, pseudo-tool-orphan-tools, pseudo-tool-get-file-state

**Wave 6 (serial: MCP wiring, then parallel skill/hook updates):**
- mcp-setup-wiring (serial, depends on all Wave 5 tool modules)
- Then parallel: plugin-sessionstart-hook, skill-pseudocode-update, skill-pseudocode-seed

**Wave 7 (parallel, 3 tasks — depends on mcp-setup-wiring):**
- ui-pseudo-status-bar, ui-prose-origin-badge, ui-rename-warnings

**Wave 8 (parallel, 4 tasks — depends on everything):**
- test-integration-multiplatform, test-stress-monorepo, test-identity-edge-cases, docs-migration-guide

### Summary
- **Total tasks:** 37
- **Total waves:** 8
- **Max parallelism:** 9 (Wave 5 tool fan-out)
- **Honest scope:** 28-40 days of focused work, matching the design doc's phase estimate
- **Critical path:** Wave 1 → 2 → 3 → pseudo-indexer-core → pseudo-db-rewrite → mcp-setup-wiring → Wave 8 integration tests
