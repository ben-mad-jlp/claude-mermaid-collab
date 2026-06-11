# Blueprint: Phase 6 — Pseudo-DB Two-Level Indexing (SQLite-Only)

Phase 6 of the snippet-enhancement migration. Eliminates the `.pseudo` file format entirely, splits pseudo-db population into a cheap structural layer (Level 1, regex-based, runs on every commit) and an expensive prose layer (Level 2, LLM-driven, opt-in), and commits the SQLite db to git via a surgical `.gitignore` exception so code intelligence is shared across teammates without any export/import dance.

## Source Artifacts

- `design-pseudo-db-two-levels` — the locked design doc

## 1. Structure Summary

### 1.1 Files

**Modified:**
- [ ] `src/services/pseudo-db.ts` — schema v2, new methods (`upsertStructural`, `upsertProse`, `deleteStructural`, `getFileState`, `checkpointWal`), delete old methods (`upsertFile`, `bulkIngest`, `resolveSourceFilePath`), update every existing query method for the new column layout
- [ ] `src/services/__tests__/pseudo-db.test.ts` — rewritten to use new methods + new column names
- [ ] `src/routes/pseudo-api.ts` — update any queries that referenced removed methods; existing endpoints keep working
- [ ] `src/routes/pseudo-api.test.ts` — update seed calls to use `upsertStructural` + `upsertProse` instead of `upsertFile`
- [ ] `src/mcp/setup.ts` — register new MCP tools, remove deprecated tools
- [ ] `.gitignore` — add surgical exception for `pseudo.db`, add `*.pseudo` blanket ignore
- [ ] `skills/pseudocode/SKILL.md` — rewritten to ~30 lines around direct MCP tool calls

**New:**
- [ ] `src/services/source-scanner.ts` — regex-based scanner, pure function, emits `StructuralMethod[]`
- [ ] `src/services/__tests__/source-scanner.test.ts` — unit tests per language
- [ ] `bin/structural-index.ts` — pre-commit CLI, reads staged files, runs scanner + upsertStructural, stages db
- [ ] `bin/structural-index-project.ts` — full-project scan, used by schema migration and manual re-index
- [ ] `scripts/pre-commit` — git hook wrapper that calls `bin/structural-index.ts`

**Deleted:**
- [ ] `src/services/pseudo-parser.ts` (351 lines)
- [ ] `src/services/__tests__/pseudo-parser.test.ts`
- [ ] `skills/pseudocode/PSEUDOCODE_SPEC.md` (skill-dir copy)
- [ ] `PSEUDOCODE_SPEC.md` (project-root copy)
- [ ] `scripts/post-commit`
- [ ] `scripts/pseudo-track-commit.sh`
- [ ] `scripts/pseudo-hook-check.sh`
- [ ] `scripts/pseudo-track-commit.pseudo`
- [ ] `scripts/pseudo-hook-check.pseudo`
- [ ] **Every `.pseudo` file in the repo** (~100+ files in `src/**/*.pseudo` and `ui/**/*.pseudo` — single cleanup commit within the phase)
- [ ] `.pseudo-needs-update` (if it exists — was tracked by the old hook)

### 1.2 Key Type Definitions

```typescript
// src/services/source-scanner.ts
export interface StructuralMethod {
  name: string;
  params: string;
  returnType: string;
  sourceLine: number;
  sourceLineEnd: number | null;
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  isExported: boolean;
  owningSymbol: string | null;
}

export interface ScanResult {
  language: string;
  methods: StructuralMethod[];
  lineCount: number;
  sourceHash: string;  // sha1 of file content (first 64KB)
}

// src/services/pseudo-db.ts additions
export interface ProseStep {
  content: string;
  depth: number;
}

export interface ProseMethod {
  name: string;
  params?: string;  // disambiguator for overloads
  steps: ProseStep[];
  calls: Array<{ name: string; fileStem: string }>;
}

export interface ProseData {
  title?: string;
  purpose?: string;
  moduleContext?: string;
  methods: ProseMethod[];
}

export interface FileState {
  methods: Array<{
    name: string;
    params: string;
    sourceHash: string | null;
    hasSteps: boolean;
  }>;
  proseUpdatedAt: string | null;
  hasProse: boolean;
}
```

### 1.3 Schema v2

```sql
CREATE TABLE schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,              -- absolute source code file path
  file_stem TEXT NOT NULL DEFAULT '',          -- basename without extension
  language TEXT,
  source_mtime TEXT,
  source_hash TEXT,
  line_count INTEGER,
  title TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  module_context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  structural_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  prose_updated_at TEXT,
  has_prose INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '',
  return_type TEXT NOT NULL DEFAULT '',
  is_exported INTEGER NOT NULL DEFAULT 0,
  date TEXT,                         -- kept but unused (legacy)
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT,
  is_async INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  source_line INTEGER,
  source_line_end INTEGER,
  param_count INTEGER NOT NULL DEFAULT 0,
  step_count INTEGER NOT NULL DEFAULT 0,
  owning_symbol TEXT
);

-- method_steps, method_calls, pseudo_fts — unchanged from Phase 3
```

Target schema version: **2**.

### 1.4 Component Interactions

```
User stages source file changes and runs `git commit`
     │
     ▼
.git/hooks/pre-commit → scripts/pre-commit → bin/structural-index.ts
     │
     ▼
structural-index.ts:
  1. git diff --cached --name-only --diff-filter=AMR  → list of modified/added files
  2. git diff --cached --name-only --diff-filter=D    → list of deleted files
  3. filter to supported extensions via source-scanner.isSupported()
  4. for each modified/added: scanSourceFile() → db.upsertStructural()
  5. for each deleted: db.deleteStructural()
  6. db.checkpointWal()
  7. git add .collab/pseudo/pseudo.db
  8. exit 0 (even on scanner errors; log to .collab/pseudo/structural-index.log)
     │
     ▼
Commit proceeds with code + db staged together. Atomic consistency.

Later, user runs /pseudocode src/auth.ts (Level 2):
     │
     ▼
Skill (now ~30 lines):
  1. Read source from disk
  2. Call pseudo_get_file_state(project, filePath) → current methods + prose state
  3. Decide which methods need regenerating (new methods OR sourceHash changed OR !hasSteps)
  4. Generate prose via LLM
  5. Call pseudo_upsert_prose(project, filePath, data)
     │
     ▼
pseudo-db writes method_steps, method_calls, files.title/purpose/module_context.
     │
     ▼
Next commit: pre-commit hook sees auth.ts isn't staged, but the db is dirty
with prose changes. Hook stages the db via git add. Prose lands in git.
```

---

## 2. Function Blueprints

### 2.1 `src/services/source-scanner.ts`

#### `scanSourceFile(absPath: string): ScanResult | null`

**Pseudocode:**
1. `try { stat = fs.statSync(absPath); if (stat.size > 1_000_000) return null; }`
2. Read file contents as UTF-8. On error, return null.
3. Detect language from extension via `extToLanguage(extname(absPath))`. Return null if unsupported.
4. Split into lines.
5. Dispatch to per-language scanner (`scanTypeScript`, `scanCSharp`, `scanCpp`, `scanPython`). Each returns `StructuralMethod[]`.
6. Compute `sourceHash = createHash('sha1').update(content).digest('hex').slice(0, 16)`.
7. Return `{ language, methods, lineCount: lines.length, sourceHash }`.

**Error handling:** every step wrapped in try/catch; return null on any failure. Source scanner is best-effort.

**Edge cases:**
- File too large (>1MB) → null
- Binary file → content likely garbled, regexes return [], caller sees empty methods but otherwise valid ScanResult
- Empty file → valid ScanResult with methods=[]

**Test strategy:** 20-25 unit tests per language. Sample inputs: simple function, arrow function, async, exported, class method, nested functions, malformed input.

#### `scanTypeScript(lines: string[]): StructuralMethod[]`

**Pseudocode:**
1. Walk `lines` with index tracking.
2. For each line, try matching in order:
   - `FUNCTION_DECL_RE` (reused from Phase 4's extract-functions regex, refined)
   - `ARROW_RE` (const name = async () =>)
   - `FUNC_EXPR_RE` (const name = function() {})
   - `CLASS_METHOD_RE` (public|private|protected async? name(params): returnType {)
3. On match, extract name, params, returnType, isAsync, isExported, visibility.
4. Compute `sourceLineEnd` via brace-depth walker from Phase 4's `findMatchingBraceLineIndex` (already handles strings, comments, template-literal interpolation).
5. Derive `kind` from match type ('function' | 'method' | 'callback').
6. Derive `owningSymbol` from a state machine that tracks class contexts: when we see `class Foo {`, push 'Foo' onto a stack; on matching `}`, pop. Method's `owningSymbol` is the current stack top.
7. Default `paramCount` = params split by comma count.
8. Return the collected methods sorted by sourceLine.

**Reuse from Phase 4:** `extract-functions.ts` already has `findMatchingBraceLineIndex` and most regexes. The scanner can import those helpers rather than duplicating — but `extract-functions.ts` lives in `ui/src/lib/` which the server can't import. **Decision: duplicate the helpers** in the new server-side module. It's ~100 lines of logic, worth the code duplication to keep server/ui boundaries clean.

**Error handling:** if any regex match throws (shouldn't in practice), catch and skip that line.

**Test strategy:**
- Simple `function foo() {}` → one method, visibility null, isExported false
- `export async function bar(x: number): Promise<string> { return ""; }` → isExported, isAsync, correct params, return type
- `export class Foo { public login() {} }` → kind='method', owningSymbol='Foo', visibility='public'
- Nested `{}` in string / comment / template literal → sourceLineEnd correct
- Overloaded methods → multiple rows with same name, different params

#### Similar per-language scanners: `scanCSharp`, `scanCpp`, `scanPython`

Each reuses Phase 3's `findMethodLineForLanguage` regex patterns but runs them in a loop over lines rather than stopping at first match.

C# regex: `^\s*(?:public|private|protected|internal|static|async|override|virtual|\s)*[A-Za-z_<>,\s\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)`

C++ regex: `\b([A-Za-z_][A-Za-z0-9_:]*)\s*\(([^)]*)\)\s*(?:const)?\s*\{`

Python regex: `^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)`

**Good-effort semantics:** these are allowed to miss methods; TypeScript is the primary target.

### 2.2 `src/services/pseudo-db.ts` — new methods

#### `upsertStructural(filePath: string, language: string, scan: ScanResult): void`

**Pseudocode:**
1. Begin transaction.
2. Upsert file row: if filePath exists, UPDATE; else INSERT. Set language, source_hash, source_mtime (now), line_count, structural_indexed_at (now). Leave title/purpose/module_context/has_prose/prose_updated_at alone.
3. Load existing methods for this file: `SELECT id, name, params FROM methods WHERE file_id = ?`.
4. Build a Set of "want" keys: `${m.name}|${m.params}` for each scan method.
5. For existing methods whose key is NOT in "want": DELETE (cascades to method_steps, method_calls, pseudo_fts rows for these methods via the method_id).
6. For each scan method:
   - Lookup existing by `(name, params)` pair.
   - If exists: UPDATE structural columns (return_type, source_line, source_line_end, visibility, is_async, kind, param_count, sort_order, is_exported, owning_symbol). Leave `step_count` alone (Level 2 owns that).
   - If not: INSERT new row with structural fields; `step_count = 0`.
7. Commit transaction.

**Error handling:** transactional; partial failures roll back.

**Edge cases:**
- File with 0 methods: still upsert the files row (structural_indexed_at refreshed) and delete any orphaned methods.
- Method renamed in source: appears as one delete + one insert in the diff. Prose for the old method is lost (documented behavior).
- Overloaded method signatures that differ only by formatting: treated as different methods. Noted as known limitation.

**Test strategy:**
- Insert file with 3 methods, verify files + methods rows.
- Re-run with same methods → no changes, only `structural_indexed_at` updated.
- Re-run with method removed → method row + its steps/calls deleted.
- Re-run with method added → new row inserted.
- Overloaded methods (two with same name, different params) → both preserved.
- Preserves prose: seed file with methods via `upsertStructural`, add prose via `upsertProse`, re-run `upsertStructural` with same method set → prose still present.

#### `deleteStructural(filePath: string): void`

**Pseudocode:**
1. Begin transaction.
2. `DELETE FROM files WHERE file_path = ?` — cascades to methods, method_steps, method_calls.
3. Clear FTS entries (use the existing `clearFtsForFile` path, adapted for new column name).
4. Commit.

**Test strategy:** seed file, delete, verify no rows remain.

#### `upsertProse(filePath: string, data: ProseData): void`

**Pseudocode:**
1. Begin transaction.
2. Find file by `file_path`. If not found, return silently (Level 1 must run first). Optionally log a warning.
3. UPDATE files row: set title, purpose, module_context, prose_updated_at (now), has_prose = 1.
4. For each method in `data.methods`:
   - Match by `(name, params)` if params provided, else by `name` alone (may match multiple — update all).
   - If found: DELETE existing method_steps + method_calls for that method_id, INSERT new ones from data, UPDATE `methods.step_count`.
   - If not found: log warning, skip (structural data must exist first).
5. Rebuild FTS entries for affected methods.
6. Commit.

**Error handling:** method not found → warn and continue; don't fail the whole upsert.

**Edge cases:**
- Empty `data.methods` → only updates the file-level fields. Useful for refreshing title/purpose without touching methods.
- Method name matches multiple (overloads) and params not provided → updates all matching rows with same content. Document this.

**Test strategy:**
- Upsert structural first, then prose → verify file row has title/purpose/module_context, method row has steps and calls.
- Upsert prose twice for same method → second overwrites first.
- Upsert prose for non-existent method → warning logged, no rows changed.

#### `getFileState(filePath: string): FileState | null`

**Pseudocode:**
1. Look up file row.
2. If not found, return null.
3. Query methods: `SELECT name, params, step_count FROM methods WHERE file_id = ? ORDER BY sort_order`.
4. Return:
   ```ts
   {
     methods: rows.map(r => ({
       name: r.name,
       params: r.params,
       sourceHash: fileRow.source_hash,  // per-file hash, simpler than per-method
       hasSteps: r.step_count > 0,
     })),
     proseUpdatedAt: fileRow.prose_updated_at,
     hasProse: fileRow.has_prose === 1,
   }
   ```

**Test strategy:** seed with known state, verify return shape.

#### `checkpointWal(): void`

**Pseudocode:**
```typescript
this.db.exec('PRAGMA wal_checkpoint(FULL)');
```

One-liner. Needs to be exposed because the pre-commit CLI needs to call it before staging the db file.

### 2.3 `src/services/pseudo-db.ts` — migration

#### Constructor migration block (replaces Phase 3's `migrate()`)

**Pseudocode:**
1. Read current `schema_version` (or 0 if table doesn't exist).
2. If `currentVersion < 2`:
   - Log "[pseudo-db] migrating from v${currentVersion} → v2"
   - Drop all data tables: `pseudo_fts`, `method_calls`, `method_steps`, `methods`, `files`, `schema_version`
   - Create v2 schema
   - Insert `schema_version (1, 2)`
   - Schedule a post-initialization full-project structural scan (or do it inline — see below)
3. If `currentVersion >= 2`, run `CREATE TABLE IF NOT EXISTS` (idempotent no-op).

**Full-project scan timing:** running the scan inline during construction blocks the constructor. Better: the constructor sets a `needsInitialScan` flag on the service. The server startup code checks the flag and runs `bin/structural-index-project.ts` (or an equivalent in-process scan) asynchronously after construction. Document this carefully.

### 2.4 `bin/structural-index.ts`

**Pseudocode:**
1. Parse argv for project path (default: current working directory).
2. Resolve db via `getPseudoDb(project)`.
3. Run `git diff --cached --name-only --diff-filter=AMR` via `execSync`. Split on newline.
4. Filter to supported extensions using `source-scanner.isSupportedExtension()`.
5. For each file: absolute path, `scanSourceFile(abs)`, `db.upsertStructural(abs, scan.language, scan)`. Catch errors per file, log to `.collab/pseudo/structural-index.log`.
6. Run `git diff --cached --name-only --diff-filter=D`. For each: `db.deleteStructural(abs)`.
7. `db.checkpointWal()`.
8. Run `git add <dbpath>` via `execSync`.
9. Exit 0.

**Error handling:** every major operation wrapped in try/catch. Log and continue. Final exit is always 0 unless a catastrophic failure (db corruption — rethrow and exit 1 to block the commit).

**Performance budget:** <1s for typical commits. The scanner is ~ms per file, db upsert is ~ms, so 10 files = 20-50ms total. WAL checkpoint + git add = another ~50ms. Comfortable.

**Test strategy:** manual for Phase 6 (the CLI is thin glue; the tested pieces are source-scanner and upsertStructural).

### 2.5 `bin/structural-index-project.ts`

**Pseudocode:**
1. Parse argv for project path.
2. Walk the source tree (reuse `walkSourceTree` from the current `getCoverage` method — worth extracting as a utility).
3. For each file, `scanSourceFile` + `upsertStructural`.
4. Log progress ("Indexed N files").
5. `checkpointWal()`, `git add`.
6. Exit.

**Performance:** depends on project size. For claude-mermaid-collab (~300 source files), expect 2-5s.

### 2.6 `scripts/pre-commit`

```bash
#!/bin/bash
# Git pre-commit hook — runs Level 1 structural index on staged source files.
# Installed via: cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
bun run "$PROJECT_ROOT/bin/structural-index.ts" "$PROJECT_ROOT" 2>&1
exit 0  # Never block the commit; errors are logged
```

Simple passthrough. Error handling is inside the CLI.

### 2.7 `src/mcp/setup.ts` — new MCP tools

#### `pseudo_index_structural(project, filePath)` handler

Calls `db.upsertStructural` after calling the scanner. Returns `{ success: true, methodCount }`.

#### `pseudo_index_project(project)` handler

Walks the source tree and re-indexes everything. Slow — should be used sparingly.

#### `pseudo_upsert_prose(project, filePath, data)` handler

Calls `db.upsertProse`. Schema validates `data` matches `ProseData`.

#### `pseudo_get_file_state(project, filePath)` handler

Calls `db.getFileState`. Used by the `/pseudocode` skill to decide what needs regenerating.

**Tools deleted:** any tools that used `upsertFile` / `bulkIngest` (unlikely — those were internal). Check during implementation.

### 2.8 Rewritten `skills/pseudocode/SKILL.md`

```markdown
---
name: pseudocode
description: Use when creating, updating, or reviewing pseudocode for source code files. The pseudocode is stored in the pseudo-db (SQLite) and rendered in the collab UI.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, mcp__mermaid__pseudo_get_file_state, mcp__mermaid__pseudo_upsert_prose
---

# Pseudocode Skill

Generate or update plain-English descriptions of what source code files do. Results are written directly to the pseudo-db via MCP tools. There are no `.pseudo` files on disk — everything lives in SQLite.

## Usage

- `/pseudocode <file-path>` — process a single file
- `/pseudocode <directory>` — process all qualifying files in a directory
- `/pseudocode` (no args) — process files changed since the last commit (`git diff --name-only HEAD`)

## Step 1 — Determine target files

Follow the same skip rules as before:
- Skip index/barrel files
- Skip pure type definition files
- Skip test files
- Skip files under 20 lines

## Step 2 — For each target file

1. Read the source code file from disk.
2. Call `mcp__mermaid__pseudo_get_file_state(project, filePath)` to see what's already in the db.
3. Determine which methods need regenerating:
   - All methods if `proseUpdatedAt` is null (first time) or `hasProse` is false
   - Methods whose source has changed since `proseUpdatedAt` (use `source_hash` comparison — but for simplicity, regenerate all methods whose hasSteps is false, plus all if sourceHash changed)
4. Generate prose for each target method:
   - Title (one-line summary of the file)
   - Purpose (1-2 sentence description)
   - Module context (prose between file header and first function, if applicable)
   - For each method: a list of numbered steps in plain English (the pseudocode), plus CALLS references for cross-file function invocations
5. Call `mcp__mermaid__pseudo_upsert_prose(project, filePath, data)` where `data` is the ProseData shape.

## Pseudocode Style

(Same style principles as before: plain English, numbered steps, IF/ELSE for branching, 30-second rule, intent over implementation. No format markers because there's no file format.)

## Report

After processing, report how many files were processed and how many methods had their prose regenerated.
```

That's it. Way shorter than the old skill.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: db-overhaul-v2
    files:
      - src/services/pseudo-db.ts
    tests:
      - src/services/__tests__/pseudo-db.test.ts
    description: "Rewrite pseudo-db.ts for schema v2. Change files.file_path to store source path. Rename synced_at → prose_updated_at. Add structural_indexed_at, has_prose columns. Add upsertStructural / upsertProse / deleteStructural / getFileState / checkpointWal methods. Delete upsertFile / bulkIngest / resolveSourceFilePath. Update every existing query method (getFile, getCallGraph, getSourceLink, getFunctionsForSource, etc.) for the new column layout. Update migration block to drop all tables on v1→v2 and recreate. Keep CALLS resolution logic (callee_file_stem joins file_stem derived from source basenames)."
    parallel: true
    depends-on: []

  - id: source-scanner-lib
    files:
      - src/services/source-scanner.ts
      - src/services/__tests__/source-scanner.test.ts
    tests:
      - src/services/__tests__/source-scanner.test.ts
    description: "New module exporting scanSourceFile(absPath) and StructuralMethod / ScanResult types. Dispatches per language: TypeScript/JavaScript (primary, class + arrow + function decl + function expr), C#, C++, Python (good-effort). Duplicates the Phase 4 findMatchingBraceLineIndex brace walker. Computes sourceHash. Walks a class-context stack for owningSymbol. 20+ unit tests covering language branches, edge cases, malformed input."
    parallel: true
    depends-on: []

  - id: gitignore-and-pseudo-cleanup
    files:
      - .gitignore
    tests: []
    description: "Update .gitignore: remove blanket /.collab/, add /.collab/sessions/ + /.collab/pseudo/pseudo.db-wal + /.collab/pseudo/pseudo.db-shm + !/.collab/pseudo/pseudo.db. Add *.pseudo blanket ignore. Delete every .pseudo file in the repo (100+ files under src/ and ui/). Delete scripts/pseudo-track-commit.pseudo and scripts/pseudo-hook-check.pseudo. This is mostly file deletion — bulk via Glob + Bash git rm."
    parallel: true
    depends-on: []

  - id: db-tests-rewrite
    files:
      - src/services/__tests__/pseudo-db.test.ts
    tests:
      - src/services/__tests__/pseudo-db.test.ts
    description: "Rewrite pseudo-db tests to use the new methods. Remove parsePseudo and ParsedPseudoFile references. Seed via upsertStructural + upsertProse instead of upsertFile. Verify column layout changes (file_path stores source path, prose_updated_at column, etc.). Add new tests for upsertStructural (insert, update, delete-method, preserve-prose), upsertProse (insert, update, match-by-name-and-params), getFileState, checkpointWal."
    parallel: true
    depends-on: [db-overhaul-v2]

  - id: pseudo-api-update
    files:
      - src/routes/pseudo-api.ts
      - src/routes/pseudo-api.test.ts
    tests:
      - src/routes/pseudo-api.test.ts
    description: "Update pseudo-api.ts if any route referenced removed methods. Update pseudo-api.test.ts to seed via upsertStructural + upsertProse instead of the old upsertFile path. All existing endpoints (/stats, /files, /file, /graph, /impact, /coverage, /source-link, /functions-for-source, /references, /search) continue to work with schema v2."
    parallel: true
    depends-on: [db-overhaul-v2]

  - id: mcp-tools-update
    files:
      - src/mcp/setup.ts
    tests: []
    description: "Add new MCP tools pseudo_index_structural, pseudo_index_project, pseudo_upsert_prose, pseudo_get_file_state. Delete any old tools that referenced upsertFile / bulkIngest (likely none — those were internal). Keep all existing read-only pseudo_* tools."
    parallel: true
    depends-on: [db-overhaul-v2]

  - id: bin-structural-index-clis
    files:
      - bin/structural-index.ts
      - bin/structural-index-project.ts
    tests: []
    description: "New bin/structural-index.ts (pre-commit CLI reading staged files from git) and bin/structural-index-project.ts (full-project walker). Both use source-scanner + db.upsertStructural + db.checkpointWal. structural-index.ts also runs git add for the db file. Both exit 0 on scanner errors, log to .collab/pseudo/structural-index.log."
    parallel: true
    depends-on: [db-overhaul-v2, source-scanner-lib]

  - id: delete-pseudo-parser
    files:
      - src/services/pseudo-parser.ts
      - src/services/__tests__/pseudo-parser.test.ts
    tests: []
    description: "Delete pseudo-parser.ts and its test file. Remove any remaining imports of ParsedPseudoFile / ParsedMethod / ParsedStep / parsePseudo across the codebase. At this point (after Wave 2), none of the modified files should still reference these — this task just deletes them and verifies via Grep."
    parallel: false
    depends-on: [db-overhaul-v2, db-tests-rewrite, pseudo-api-update, mcp-tools-update]

  - id: pre-commit-hook
    files:
      - scripts/pre-commit
      - scripts/post-commit
      - scripts/pseudo-track-commit.sh
      - scripts/pseudo-hook-check.sh
    tests: []
    description: "Create new scripts/pre-commit that calls bin/structural-index.ts. Delete scripts/post-commit, scripts/pseudo-track-commit.sh, scripts/pseudo-hook-check.sh. Update the scripts/pseudo-* .pseudo siblings (delete them). Add install instructions to skills/pseudocode/SKILL.md (or a README) for how to symlink into .git/hooks/pre-commit."
    parallel: true
    depends-on: [bin-structural-index-clis]

  - id: skill-rewrite
    files:
      - skills/pseudocode/SKILL.md
      - skills/pseudocode/PSEUDOCODE_SPEC.md
      - PSEUDOCODE_SPEC.md
    tests: []
    description: "Rewrite skills/pseudocode/SKILL.md to ~30 lines around direct MCP tool calls (pseudo_get_file_state + pseudo_upsert_prose). Delete skills/pseudocode/PSEUDOCODE_SPEC.md. Delete PSEUDOCODE_SPEC.md (project root). Remove all references to .pseudo files, format markers, install mode, sync mode, .pseudo-needs-update, .pseudo-sync."
    parallel: true
    depends-on: [mcp-tools-update]
```

### Execution Waves

**Wave 1 (3 parallel, no deps):**
- `db-overhaul-v2`
- `source-scanner-lib`
- `gitignore-and-pseudo-cleanup`

**Wave 2 (4 parallel, depend on Wave 1):**
- `db-tests-rewrite` (depends on db-overhaul-v2)
- `pseudo-api-update` (depends on db-overhaul-v2)
- `mcp-tools-update` (depends on db-overhaul-v2)
- `bin-structural-index-clis` (depends on db-overhaul-v2 + source-scanner-lib)

**Wave 3 (3 parallel, depend on Wave 2):**
- `delete-pseudo-parser` (depends on all Wave 2 tasks that might have held onto parser imports)
- `pre-commit-hook` (depends on bin-structural-index-clis)
- `skill-rewrite` (depends on mcp-tools-update)

### Summary
- Total tasks: 10
- Total waves: 3
- Max parallelism: 4

---

## 4. Out of Scope / Deferred

- **Prose persistence beyond SQLite.** No `prose.json`, no export format. The committed db is the persistence mechanism.
- **Session persistence.** Linked snippets stay per-user state under `.collab/sessions/*`, gitignored. Team sharing of linked editor state is a separate future concern.
- **Method identity across renames.** A rename looks like delete+insert to Level 1. Prose for the old method is lost. Committed db history is the safety net — `git show HEAD~1:.collab/pseudo/pseudo.db` can recover old prose if urgently needed.
- **C# / C++ / Python parity with TypeScript.** Good-effort per Phase 3 precedent. TypeScript is the primary target.
- **Auto-install of the pre-commit hook.** The install step stays manual (`cp scripts/pre-commit .git/hooks/pre-commit`). An `/pseudocode install` command could wrap this but isn't in scope.
- **Merge conflict automation.** Binary db conflicts require manual resolution (pick one side, re-index). Documented as a known limitation.

---

## 5. Validation

At the end of Phase 6 the following must work end-to-end:

1. **Schema migration runs cleanly.** Existing v1 db → v2 db → full-project scan populates all `files` and `methods` rows with structural data.
2. **Pre-commit hook fires on `git commit`.** Edit a source file, stage it, commit — the db file is updated and included in the same commit.
3. **`git log -p .collab/pseudo/pseudo.db`** shows binary changes for every code commit (confirms the db is tracked).
4. **Fresh checkout** (e.g., `git clone` or worktree) has a fully-populated db. Cmd+K search, Function Jump Dropdown, Go-to-Definition all work immediately without warmup.
5. **Phase 4 features still work.** Function Jump Dropdown populates, references popover navigates.
6. **Phase 5 features still work.** Cmd+K search finds structural hits across the whole project (not just files someone ran `/pseudocode` on).
7. **`/pseudocode src/auth.ts`** runs without a `.pseudo` file being created. Prose appears in the db, visible via PseudoSideBySideView toggle.
8. **No `.pseudo` files in the repo.** `find . -name "*.pseudo"` returns zero results (modulo gitignored worktrees).
9. **No references to `pseudo-parser.ts`** in the codebase. `grep -r "pseudo-parser\|parsePseudo\|ParsedPseudoFile"` returns no matches in non-git-history sources.
10. **`bin/structural-index.ts`** run manually on a staged change set completes in <1s for a 10-file change.
11. **All tests green.** Backend pseudo-db tests, pseudo-api tests, source-scanner tests.

---

## 6. Risks + Mitigation

### Binary db in git
**Risk:** db file grows with history, bloating the repo and PR noise.
**Mitigation:** accept as the trade-off for free team sharing. Binary diffs for a ~5-10MB file are manageable with git's delta compression. Document that large refactors should batch commits to avoid churn.

### Pre-commit hook latency
**Risk:** scanner + db upsert takes too long on large commits (100+ files).
**Mitigation:** Level 1 is regex-based and inherently fast. Budget is <1s for typical commits, <5s for large ones. If it ever becomes painful, move to async post-commit but accept one-commit lag.

### Merge conflicts on the db file
**Risk:** two branches modifying the db → manual resolution required.
**Mitigation:** document the resolution procedure (accept one side, re-run `bin/structural-index-project.ts`, re-run `/pseudocode` for prose). For most workflows, rebasing before merging avoids the conflict entirely.

### Full-project scan on first upgrade
**Risk:** first run after upgrade takes a few seconds while it scans every file.
**Mitigation:** acceptable one-time cost. Log progress to stdout. Alternatively, pre-populate the db in the same Phase 6 commit so teammates pulling master don't see the scan at all (they get a fully-indexed db from git).

### Loss of existing prose
**Risk:** the v2 migration wipes all existing prose. Users have to regenerate.
**Mitigation:** documented in the Phase 6 release notes. Users can run `/pseudocode` on files they care about to rebuild. This is the one real cost of the simplification.

### Deleted `.pseudo` files in PR review
**Risk:** deleting 100+ `.pseudo` files in one commit creates a noisy PR.
**Mitigation:** do the deletion in a dedicated commit within Phase 6. PR reviewers glance at the `-` lines and accept them en masse.

---

## 7. Success Criteria

Phase 6 is done when:

- [x] All 10 tasks completed and verified
- [x] Zero `.pseudo` files in the repo
- [x] `pseudo-parser.ts` deleted
- [x] Schema version is 2
- [x] `/pseudocode` skill writes prose directly to db via MCP
- [x] Pre-commit hook runs Level 1 and stages the db
- [x] Phase 4 and Phase 5 UI features still work
- [x] All backend tests green
- [x] The vibe-review bug check finds no critical or important bugs
