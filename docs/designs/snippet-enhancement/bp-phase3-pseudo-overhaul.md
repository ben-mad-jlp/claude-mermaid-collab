# Blueprint: Phase 3 — Pseudo-DB Overhaul

Phase 3 of the snippet-enhancement migration. Fixes bugs that exist today in the pseudo-db while extending the schema and parser so Phase 4+ navigation features have the data they need (function line numbers, real source-link endpoint, proper coverage, widened FTS). Also updates the `/pseudocode` skill so freshly generated pseudo files emit the new metadata.

This is a single large, coherent change — schema, parser, skill, bug fixes, and new endpoint all land together. The pseudo SQLite DB is gitignored so users re-index on first run; no cross-user migration concern.

## Source Artifacts
- `migration-plan` — Phase 3 section (3.1–3.5)
- `pseudo-db-audit` — full schema analysis, bugs, parser findings, skill update plan
- `feature-brainstorm` — language priority decisions

## Scope Decisions
- **Languages:** TypeScript is primary. C# and C++ are both good-effort. Python is opportunistic. Parser must not crash on any language — null out fields it can't extract.
- **All five sub-phases in one blueprint** — schema, parser, skill, bug fixes, source-link endpoint.
- **NICE-TO-HAVE columns deferred** — only the MUST-HAVE columns from the audit land now (see Section 1.2). Deprecated/throws/doc/tags/test markers and file_imports/method_tags tables wait for a future phase that actually needs them.

---

## 1. Structure Summary

### 1.1 Files

**Backend**
- [ ] `src/services/pseudo-db.ts` — **modify** — schema extension + `schema_version` table + migration-on-startup + bug fixes in query methods + new `getSourceLink()` method + new `getStats()` method using COUNT + `getCoverage()` rewrite + widened FTS
- [ ] `src/services/pseudo-parser.ts` — **modify** — replace FUNCTION header regex with a line tokeniser, add `// source:` / `// language:` header parsing, add `VISIBILITY:` / `ASYNC:` / `KIND:` metadata line parsing, add per-language source file scan for line numbers, add derived field computation (param_count, step_count, owning_symbol), add second-pass call resolution to populate `callee_method_id`
- [ ] `src/routes/pseudo-api.ts` — **modify** — new `GET /api/pseudo/source-link` endpoint, update `getStats` dispatch, update `getCoverage` dispatch, update `getExports` response shape (rename mislabeled `purpose` → `stepSummary`)
- [ ] `src/services/__tests__/pseudo-parser.test.ts` — **new** — unit tests for the tokeniser: FUNCTION header variants (nested parens, generics, no params, no return type), metadata marker parsing, `// source:` header extraction, backward compatibility with old-format files
- [ ] `src/services/__tests__/pseudo-db.test.ts` — **new** — unit tests for schema migration (v0 → current), new column population, overloaded method handling, `getCoverage()`, `getStats()`, `getSourceLink()`, call-graph no longer breaks on stem collisions
- [ ] `src/routes/pseudo-api.test.ts` — **modify** — add tests for the new source-link endpoint + updated stats/coverage/exports endpoint shapes

**Skill + Spec**
- [ ] `skills/pseudocode/SKILL.md` — **modify** — add Step 2b (file-level headers), update Step 3 example to show metadata markers, add Function Metadata Markers subsection, expand Language-Specific Guidance table
- [ ] `skills/pseudocode/PSEUDOCODE_SPEC.md` — **modify** — add File-Level Metadata section, add Function-Level Metadata section
- [ ] `PSEUDOCODE_SPEC.md` (project root) — **modify** — fix inconsistency with skill-directory copy (add `// synced:` + `[YYYY-MM-DD]` date to header/function examples) + add the new sections

### 1.2 Type Definitions — MUST-HAVE additions

**`src/services/pseudo-parser.ts`:**

```typescript
// Extended ParsedPseudoFile
export interface ParsedPseudoFile {
  title: string;
  purpose: string;
  syncedAt: string | null;
  sourceFilePath: string | null;    // NEW — from // source: header, or derived
  language: string | null;          // NEW — from // language: header, or derived from extension
  moduleContext: string;
  methods: ParsedMethod[];
}

// Extended ParsedMethod
export interface ParsedMethod {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  date: string | null;
  calls: Array<{ name: string; fileStem: string }>;
  steps: ParsedStep[];
  sortOrder: number;
  // NEW — optional metadata
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  isAsync: boolean;                 // NEW — from ASYNC: marker
  kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'callback' | null;
  // NEW — derived in parser
  paramCount: number;
  stepCount: number;
  owningSymbol: string | null;       // extracted from dotted names like UserService.login
  // NEW — populated by source file scan (may be null if scan fails)
  sourceLine: number | null;
  sourceLineEnd: number | null;
}
```

**`src/services/pseudo-db.ts` — `files` table additions:**

| Column | Type | Notes |
|---|---|---|
| `source_file_path` | TEXT NULL | From parser; nullable |
| `source_mtime` | TEXT NULL | ISO timestamp; `fs.statSync` at ingest |
| `source_hash` | TEXT NULL | Short sha1; best-effort |
| `language` | TEXT NULL | From parser |
| `indexed_at` | TEXT DEFAULT (datetime('now')) | Real re-index time; **replaces broken `updated_at`** |
| `line_count` | INTEGER NULL | File size in lines |

**`src/services/pseudo-db.ts` — `methods` table additions:**

| Column | Type | Notes |
|---|---|---|
| `source_line` | INTEGER NULL | Hybrid: parser scan fallback to null |
| `source_line_end` | INTEGER NULL | Same |
| `visibility` | TEXT NULL | From VISIBILITY: marker |
| `is_async` | INTEGER NOT NULL DEFAULT 0 | From ASYNC: marker |
| `kind` | TEXT NULL | From KIND: marker |
| `param_count` | INTEGER NOT NULL DEFAULT 0 | Derived |
| `step_count` | INTEGER NOT NULL DEFAULT 0 | Derived |
| `owning_symbol` | TEXT NULL | Derived from dotted name |

**Drop `UNIQUE(file_id, name)`** — incorrectly rejects overloads. Replace with no constraint (there's no natural key for overloaded methods; rely on `sort_order` for ordering).

**`src/services/pseudo-db.ts` — `method_calls` table:**

| Column | Type | Notes |
|---|---|---|
| `callee_method_id` | INTEGER NULL REFERENCES methods(id) ON DELETE SET NULL | Populated by second-pass resolution after all files ingested |

**New index:** `CREATE INDEX idx_method_calls_stem ON method_calls(callee_file_stem, callee_name)` — fixes the missing-index audit finding.

**New table:** `schema_version`

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
```

Target version: **`1`** (v0 = missing table, any existing DB).

**Widened FTS:**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS pseudo_fts USING fts5(
  method_name,
  step_content,
  title,
  purpose,
  module_context,
  params,
  content='',
  tokenize='porter unicode61'
);
```

### 1.3 Component Interactions

```
Startup (getPseudoDb(project))
     │
     ▼
PseudoDbService constructor
     │  1. CREATE TABLE IF NOT EXISTS (new schema)
     │  2. Read schema_version — if missing or < 1, DROP all data tables + recreate
     │  3. Walk .collab/pseudo indexed files (or nothing if fresh) — users re-ingest
     │     lazily via pseudo_sync_code / /pseudocode skill
     │  4. Set schema_version = 1
     ▼

/pseudocode skill processes a .ts file
     │
     ▼
pseudoParser.parsePseudo(content)
     │  1. Line tokeniser handles FUNCTION header (replaces regex)
     │  2. Parse // source: and // language: headers
     │  3. Parse VISIBILITY/ASYNC/KIND lines before step 1
     │  4. Derive param_count, step_count, owning_symbol
     ▼
pseudoDb.upsertFile(filePath, parsed)
     │  1. Compute source_mtime/source_hash/line_count via fs.statSync on parsed.sourceFilePath
     │  2. If parsed.sourceFilePath present, run language-specific source scan to fill
     │     method.sourceLine / sourceLineEnd (best-effort per language)
     │  3. Insert files row + methods rows + method_steps + method_calls
     │  4. Second pass: for each method_calls row, resolve callee_method_id by joining
     │     on (callee_name, callee_file_stem) against methods/files
     │  5. Rebuild FTS entries including widened columns
     ▼

UI / MCP / Claude call /api/pseudo/source-link?name=...&hintFileStem=...
     │
     ▼
pseudoApi → pseudoDb.getSourceLink(name, hintFileStem?)
     │  Returns [{ sourceFilePath, sourceLine, sourceLineEnd, language, isExported }, ...]
```

---

## 2. Function Blueprints

### 2.1 Parser (`src/services/pseudo-parser.ts`)

#### `parsePseudo(content: string): ParsedPseudoFile` — **rewrite**

Replace the FUNCTION header regex with a line tokeniser.

**Pseudocode:**
1. Split content into lines.
2. **Header phase:** consume leading `//` lines. First = title, second = purpose. For subsequent `//` lines, parse `synced:`, `source:`, `language:` via simple prefix match. Stop when a non-`//` line is hit.
3. If `sourceFilePath` missing after header phase, derive from the `.pseudo` file path (strip `.pseudo`, probe common extensions — caller of `parsePseudo` doesn't know its own path though, so we actually can't probe here; the *db layer* does the derivation). Parser returns `sourceFilePath = null` if no header present.
4. If `language` missing, derive from sourceFilePath extension when caller provides it; otherwise null.
5. **Module context phase:** consume prose lines until the first `FUNCTION` token. (Same as today.)
6. **Function phase:** for each block starting with `FUNCTION`, call `parseFunctionHeader(line)` (new helper, below), then consume metadata lines (`VISIBILITY:`, `ASYNC:`, `KIND:`, `CALLS:`) in any order *before* the first numbered step. Then consume body until `---` separator or next `FUNCTION`.
7. Compute derived fields: `paramCount = count of comma-separated tokens in params string (0 if empty)`, `stepCount = steps.length`, `owningSymbol = name.includes('.') ? name.split('.')[0] : null`.
8. Return populated `ParsedPseudoFile`.

**Error handling:** Parser should be tolerant — malformed lines become `null` fields or are skipped, never throw.

**Edge cases:**
- File with no headers → title/purpose empty strings, sourceFilePath/language null
- Function with nested parens in params (e.g. `cb: (x: T) => U`) → tokeniser must handle
- Function with generics (e.g. `foo<T>(x: T): T`) → tokeniser must handle
- Multiple `// synced:` lines → take the first
- Unknown metadata marker (e.g. `FOO: bar`) → ignore silently (forward compat)
- Legacy files without any metadata markers → produce a `ParsedMethod` with all new fields defaulting to null/0/false; everything still works

**Test strategy:** snapshot tests on existing `.pseudo` files in the repo (via Glob on `**/*.pseudo`), plus targeted unit tests for each new feature.

#### `parseFunctionHeader(line: string): { name, params, returnType, isExport, date } | null` — **new helper**

Line tokeniser replacing the regex.

**Pseudocode:**
1. Check line starts with `FUNCTION ` (with space). If not, return null.
2. Advance past `FUNCTION `.
3. Read identifier (letters/digits/`_`/`.`) — this is `name`.
4. If next char is `(`: enter param-reading mode. Walk chars tracking paren depth (handles nested parens like `(cb: (x: T) => U)`). Collect everything between the outer `(` and matching `)`. Strip the outer parens, trim = `params`.
5. If next non-whitespace is `->`, skip it, read until end-of-line OR until we hit `EXPORT` / `[YYYY-MM-DD]` marker. Trim = `returnType`.
6. Remaining tail may contain `EXPORT` keyword and/or `[YYYY-MM-DD]` date, in either order. Extract both with regex on the tail only (small, safe regex).
7. Return populated object.

**Error handling:** If any step fails (unclosed paren, bad identifier), return null — caller treats as non-function line.

**Edge cases:**
- Generics in name (`foo<T>`) — NOT supported per spec (method name is an identifier); generics inside params are handled via paren-depth walking.
- Return type containing `EXPORT` as a type name → EXPORT must be whitespace-delimited; guard with `\b` or whitespace check.
- Async function: parser does NOT auto-infer async from `Promise<...>` return type. Relies on explicit `ASYNC: true` marker.

#### `parseMethodMetadata(line: string): { key: string; value: string } | null` — **new helper**

Recognize metadata lines like `  VISIBILITY: public` or `  ASYNC: true`.

**Pseudocode:**
1. Trim the line.
2. Regex: `^([A-Z][A-Z_]+):\s*(.*)$` → `{ key, value }`.
3. Return null if no match.

**Recognized keys in Phase 3:** `VISIBILITY`, `ASYNC`, `KIND`, `CALLS`. Other keys are ignored silently (forward compat for NICE-TO-HAVE markers).

**Edge cases:**
- Marker after the first step line → ignore (must be before step 1)
- Key with lowercase → not matched, treated as prose

#### `scanSourceFileForLines(sourcePath: string, methods: ParsedMethod[], language: string): void` — **new, called from db layer**

This is **not** in the parser per se — it lives in `pseudo-db.ts` because it needs filesystem access at ingest time. But the implementation is language-aware logic so it's documented here with the parser.

**Pseudocode:**
1. Read the source file. If read fails → bail, leave all sourceLine/sourceLineEnd null. Don't throw.
2. Split into lines.
3. For each method, search for its definition line using a language-specific regex:
   - **TypeScript/JavaScript** (`ts`/`tsx`/`js`/`jsx`):
     - `function foo`, `const foo =`, `async function foo`, `const foo = async`
     - Class methods: `foo(...)` on an indented line inside a class — heuristic via leading whitespace
     - Arrow in object literal: `foo: (...)` or `foo: async (...)`
   - **C#** (`cs`): regex `(public|private|protected|internal|static|async|\s)*\s*(?:[A-Za-z_<>,\s]+\s+)?<name>\s*\(` — good-effort
   - **C++** (`cpp`/`cc`/`h`/`hpp`): regex `<name>\s*\([^)]*\)\s*(?:const)?\s*\{?` — good-effort
   - **Python** (`py`): `def <name>\s*\(`, `async def <name>\s*\(`
   - **Other**: skip
4. First match wins. Populate `sourceLine`. Leave `sourceLineEnd` null unless we can determine the closing brace (TS/JS/C#/C++ via brace-depth walking — only for the primary language TS; other languages leave `sourceLineEnd` null).
5. Methods whose name contains a dot (`Foo.bar`) → search for the bare name `bar`, not the dotted form.

**Error handling:** Every file read and every regex operation is wrapped in try/catch. Any failure sets the field to null and continues.

**Edge cases:**
- Overloaded methods (multiple matches): assign line to the first; others get same line number (acceptable for Phase 3; Phase 4 can disambiguate by param signature when it matters)
- Arrow functions: match the `const foo =` line, not the arrow
- Class methods without access modifier: matched by indentation + name heuristic
- File is binary or too large (>1MB): skip scan, null all fields

### 2.2 DB Service (`src/services/pseudo-db.ts`)

#### Schema migration (inside constructor)

**Pseudocode:**
1. `this.db.exec(SCHEMA)` — creates new schema if fresh DB
2. Query `SELECT version FROM schema_version WHERE id = 1` — wrap in try/catch because table may not exist
3. If no row or version < 1:
   - Drop all data tables: `DROP TABLE IF EXISTS pseudo_fts; DROP TABLE IF EXISTS method_calls; DROP TABLE IF EXISTS method_steps; DROP TABLE IF EXISTS methods; DROP TABLE IF EXISTS files;`
   - Re-run SCHEMA
   - `INSERT INTO schema_version (id, version) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET version = 1`
4. Log `[pseudo-db] migrated to v1` once per process

**Note:** Users re-index via `/pseudocode` skill. No automatic re-ingest from disk — the DB is a cache.

#### `upsertFile(filePath, parsed): void` — **modify**

Add:
1. After parsing, if `parsed.sourceFilePath` exists, call `fs.statSync(sourceFilePath)` to get mtime/size, compute `source_hash` via crypto.createHash('sha1') on first 64KB of the file (bounded for performance), read line count via file content.
2. Call `scanSourceFileForLines(parsed.sourceFilePath, parsed.methods, parsed.language)` to populate `sourceLine`/`sourceLineEnd` on each method (mutates methods array in place).
3. Insert files row with new columns.
4. Insert methods rows with new columns (visibility, is_async, kind, source_line, source_line_end, param_count, step_count, owning_symbol).
5. After inserting all methods for this file, DO NOT resolve callee_method_id here. Defer to `bulkIngest` or a new `resolveCallees()` pass — because other files haven't been ingested yet.
6. Replace the per-method FTS insert with the widened row (title/purpose/module_context/params/method_name/step_content).

Wait — single-file `upsertFile` breaks cross-file callee resolution timing. Fix: after upsert, call `this.resolveCalleesForFile(fileId)` which only updates `method_calls` rows where `callee_file_stem` already matches a known file stem in the DB. That handles the common case of ingesting one file at a time.

#### `bulkIngest(files): void` — **modify**

1. Same extensions to inserts as `upsertFile`.
2. Replace the FTS delete dance with `DROP VIRTUAL TABLE IF EXISTS pseudo_fts; CREATE VIRTUAL TABLE pseudo_fts USING fts5(...)` inside the transaction. Cheaper and correct for full rebuilds.
3. After all files inserted, do a single pass: `UPDATE method_calls SET callee_method_id = (SELECT m.id FROM methods m JOIN files f ON f.id = m.file_id WHERE f.file_stem = method_calls.callee_file_stem AND m.name = method_calls.callee_name LIMIT 1)` — resolves all edges in one SQL statement.

#### `resolveCalleesForFile(fileId: number): void` — **new private method**

Called after `upsertFile`. Updates callee_method_id for both:
- All method_calls rows that *target* methods in this file (so references from previously-ingested files now get resolved)
- All method_calls rows *originating* from methods in this file (so this file's outbound refs get resolved if the targets exist)

**Pseudocode:**
```sql
-- Forward resolution: new file's outbound calls
UPDATE method_calls SET callee_method_id = (
  SELECT m.id FROM methods m
  JOIN files f ON f.id = m.file_id
  WHERE f.file_stem = method_calls.callee_file_stem
    AND m.name = method_calls.callee_name
  LIMIT 1
)
WHERE caller_method_id IN (SELECT id FROM methods WHERE file_id = ?);

-- Backward resolution: existing calls that now point to this file
UPDATE method_calls SET callee_method_id = (
  SELECT m.id FROM methods m
  WHERE m.file_id = ?
    AND m.name = method_calls.callee_name
  LIMIT 1
)
WHERE callee_method_id IS NULL
  AND callee_file_stem = (SELECT file_stem FROM files WHERE id = ?);
```

#### `getStats(): { fileCount, methodCount, exportCount }` — **new** (replaces the inline N+1 in pseudo-api.ts)

```sql
SELECT
  (SELECT COUNT(*) FROM files) AS fileCount,
  (SELECT COUNT(*) FROM methods) AS methodCount,
  (SELECT COUNT(*) FROM methods WHERE is_exported = 1) AS exportCount
```

Returns one row. Replaces the JS reduce in the route handler.

#### `getFile(filePath): PseudoFileWithMethods | null` — **modify**

Replace the N+1 with a single query using `json_group_array`:

```sql
SELECT
  f.*,
  (SELECT json_group_array(json_object(
    'id', m.id,
    'name', m.name,
    'params', m.params,
    'returnType', m.return_type,
    'isExported', m.is_exported = 1,
    'date', m.date,
    'visibility', m.visibility,
    'isAsync', m.is_async = 1,
    'kind', m.kind,
    'sourceLine', m.source_line,
    'sourceLineEnd', m.source_line_end,
    'steps', (SELECT json_group_array(json_object('content', ms.content, 'depth', ms.depth))
              FROM method_steps ms WHERE ms.method_id = m.id ORDER BY ms.sort_order),
    'calls', (SELECT json_group_array(json_object('name', mc.callee_name, 'fileStem', mc.callee_file_stem))
              FROM method_calls mc WHERE mc.caller_method_id = m.id)
  )) FROM methods m WHERE m.file_id = f.id ORDER BY m.sort_order) AS methods_json
FROM files f WHERE f.file_path = ?
```

Parse `methods_json` with `JSON.parse`. One DB call instead of `1 + N * 2`.

#### `getCallGraph(): { nodes, edges }` — **modify**

Use `callee_method_id` instead of the stem-string join. When `callee_method_id IS NOT NULL`, the edge is resolved. Unresolved edges are dropped (same behavior as today but without the stem collision bug).

```sql
SELECT
  caller.name AS caller_name, f_caller.file_path AS caller_file,
  callee.name AS callee_name, f_callee.file_path AS callee_file
FROM method_calls mc
JOIN methods caller ON caller.id = mc.caller_method_id
JOIN files f_caller ON f_caller.id = caller.file_id
JOIN methods callee ON callee.id = mc.callee_method_id
JOIN files f_callee ON f_callee.id = callee.file_id
```

#### `getImpactAnalysis(methodName, fileStem): { direct, transitive }` — **modify**

Simplify the recursive CTE now that edges are id-based:

```sql
WITH RECURSIVE impact(method_id, depth) AS (
  SELECT mc.caller_method_id, 1
  FROM method_calls mc
  JOIN methods m ON m.id = mc.callee_method_id
  JOIN files f ON f.id = m.file_id
  WHERE m.name = ? AND f.file_stem = ?

  UNION

  SELECT mc2.caller_method_id, impact.depth + 1
  FROM impact
  JOIN method_calls mc2 ON mc2.callee_method_id = impact.method_id
  WHERE impact.depth < 10
)
SELECT DISTINCT m.name, f.file_path, MIN(depth) AS depth
FROM impact
JOIN methods m ON m.id = impact.method_id
JOIN files f ON f.id = m.file_id
GROUP BY m.id
ORDER BY depth
```

#### `getCoverage(directory?: string): CoverageReport` — **rewrite**

**Approach:** Compare actual source files on disk to what's indexed.

**Pseudocode:**
1. Recursively walk the project's source tree (respecting common excludes: `node_modules`, `.git`, `dist`, `build`, `.collab`). Use `fs.readdirSync` recursively.
2. Filter to files matching indexable extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.cs`, `.cpp`, `.c`, `.h`, `.hpp`, `.go`, `.rs`.
3. Filter further to exclude: `.test.`, `.spec.`, `__tests__`, `.d.ts`.
4. If `directory` provided, prefix-filter the found files.
5. Query `SELECT source_file_path FROM files WHERE source_file_path IS NOT NULL`. Collect a Set.
6. `coveredFiles = files on disk that have a row with matching source_file_path`.
7. `totalFiles = files on disk that qualify`.
8. `missingFiles = disk files not in the indexed Set`.
9. Return correct numbers.

**Edge case:** Directory doesn't exist → return `{ coveredFiles: 0, totalFiles: 0, percent: 0, missingFiles: [] }`.

**Known limitation:** Coverage only works for files that have both a `// source:` header AND the scan-time derivation path. Legacy files without the header show up as uncovered. That's correct behavior — they should get the header added via `/pseudocode` re-run.

#### `getSourceLink(name: string, hintFileStem?: string): Array<{ sourceFilePath, sourceLine, sourceLineEnd, language, isExported }>` — **new**

**Pseudocode:**
1. Build query with optional hintFileStem filter:
```sql
SELECT
  f.source_file_path,
  m.source_line,
  m.source_line_end,
  f.language,
  m.is_exported
FROM methods m
JOIN files f ON f.id = m.file_id
WHERE m.name = ?
  AND m.source_line IS NOT NULL
  AND f.source_file_path IS NOT NULL
  [[ AND f.file_stem = ? ]]
ORDER BY m.is_exported DESC, f.file_stem
```
2. Return rows mapped to the result shape.

**Edge cases:**
- No hint, multiple matches: return all (caller can show a picker)
- No matches: return empty array
- Method exists in DB but sourceLine is null (scan failed): skip

#### `getExports(): Array<{ filePath, methodName, stepSummary }>` — **modify field name**

Rename the mislabeled `purpose` field to `stepSummary` in the return type. Update pseudo-api.ts response accordingly. Callers using `result.purpose` will need a follow-up, but a quick grep shows this is only used in MCP pseudo tools which can be updated in the same task.

**Risk flag:** grep the codebase before renaming to catch all consumers.

### 2.3 Routes (`src/routes/pseudo-api.ts`)

#### `GET /api/pseudo/stats` — **modify**

Replace the inline `listFiles().reduce(...)` with a call to the new `db.getStats()`. Return shape unchanged.

#### `GET /api/pseudo/coverage` — **modify**

Already calls `db.getCoverage()`. The DB method is being rewritten; the route needs no code change unless the return shape changes (it shouldn't).

#### `GET /api/pseudo/source-link` — **new endpoint**

```
GET /api/pseudo/source-link?project=...&name=foo&hintFileStem=utils
→ { candidates: [{ sourceFilePath, sourceLine, sourceLineEnd, language, isExported }, ...] }
```

**Pseudocode:**
1. Validate `project` + `name`.
2. `const candidates = db.getSourceLink(name, hintFileStem);`
3. Return `Response.json({ candidates })`.

### 2.4 Skill + Spec Updates

#### `skills/pseudocode/SKILL.md`

Add after current Step 2 (before Step 3):

```markdown
### Step 2b — File Source Metadata

After the `// synced:` line, add a `// source:` header pointing to the source file this pseudo describes, and optionally a `// language:` header:

    // source: src/services/alias-generator.ts
    // language: typescript

The parser uses `// source:` to cross-reference source line numbers for navigation features. If omitted, the parser falls back to probing common extensions next to the pseudo file. `// language:` is derived from the source file extension when omitted.
```

Update Step 3's generation example to show metadata markers:

```
FUNCTION authenticate(username, password) -> Promise<AuthToken>    EXPORT [2026-04-09]
  VISIBILITY: public
  ASYNC: true
  CALLS: queryDatabase (db-client)
  1. Look up user in database.
  2. Verify password hash.
  3. IF valid, generate JWT token.
```

Add a new "Function Metadata Markers" subsection:

| Marker | Values | Purpose |
|---|---|---|
| `VISIBILITY:` | public / private / protected / internal | Access modifier |
| `ASYNC:` | true | Marks async functions |
| `KIND:` | function / method / constructor / getter / setter / callback | Function kind |
| `CALLS:` | `name (file-stem), ...` | Cross-file references (existing) |

Add language-specific conventions (extend the existing "Language-Specific Guidance" section):

| Language | Visibility inference | Async marker | Notes |
|---|---|---|---|
| TypeScript | Explicit `public/private/protected` or default public when EXPORT | `ASYNC: true` for `async function` | Primary language |
| C# | Explicit `public/private/protected/internal` | `ASYNC: true` for `async Task<T>` | Good-effort |
| C++ | From `public:/private:` sections when available | N/A (or for coroutines) | Good-effort |
| Python | Leading `_` = private convention | `ASYNC: true` for `async def` | Opportunistic |

#### `skills/pseudocode/PSEUDOCODE_SPEC.md`

Add a new "File-Level Metadata (Optional)" section after the header description documenting `// source:` and `// language:`.

Add a new "Function-Level Metadata (Optional)" section before "Cross-file references (CALLS)" documenting the `VISIBILITY:` / `ASYNC:` / `KIND:` markers with examples.

#### `PSEUDOCODE_SPEC.md` (project root)

1. Fix the inconsistency: add `// synced:` to the header example (line 34) and the footer example (line 124). Add `[YYYY-MM-DD]` suffix to all `EXPORT` markers in the example functions (lines 129, 138, 146).
2. Mirror the two new sections from the skill-directory copy.
3. Goal: after this change, `diff PSEUDOCODE_SPEC.md skills/pseudocode/PSEUDOCODE_SPEC.md` should show zero differences.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: db-overhaul
    files:
      - src/services/pseudo-db.ts
      - src/services/__tests__/pseudo-db.test.ts
    tests:
      - src/services/__tests__/pseudo-db.test.ts
    description: "Schema migration (schema_version table, new columns on files/methods/method_calls, widened FTS, drop UNIQUE(file_id,name)). New getStats/getSourceLink/getCoverage. Rewrite getFile to single query using json_group_array. Fix getCallGraph and getImpactAnalysis to use callee_method_id. New private resolveCalleesForFile. Replace FTS delete dance in bulkIngest with DROP+CREATE. Rename getExports().purpose → stepSummary. Add unit tests covering migration, new columns, overloaded methods, getCoverage, getSourceLink, getCallGraph with stem collisions."
    parallel: true
    depends-on: []

  - id: skill-and-spec-updates
    files:
      - skills/pseudocode/SKILL.md
      - skills/pseudocode/PSEUDOCODE_SPEC.md
      - PSEUDOCODE_SPEC.md
    tests: []
    description: "Add Step 2b (source metadata header) to SKILL.md. Update Step 3 example to show VISIBILITY/ASYNC/KIND markers. Add Function Metadata Markers table. Extend Language-Specific Guidance with visibility/async rules per language. Mirror changes to skills/pseudocode/PSEUDOCODE_SPEC.md (File-Level + Function-Level Metadata sections). Fix project-root PSEUDOCODE_SPEC.md to match skill-dir copy (synced: header, [YYYY-MM-DD] date markers, new sections)."
    parallel: true
    depends-on: []

  - id: parser-overhaul
    files:
      - src/services/pseudo-parser.ts
      - src/services/__tests__/pseudo-parser.test.ts
    tests:
      - src/services/__tests__/pseudo-parser.test.ts
    description: "Extend ParsedPseudoFile with sourceFilePath/language. Extend ParsedMethod with visibility/isAsync/kind/paramCount/stepCount/owningSymbol/sourceLine/sourceLineEnd. Replace FUNCTION header regex with a line tokeniser (parseFunctionHeader) that handles nested parens and generics. Add parseMethodMetadata helper recognizing VISIBILITY/ASYNC/KIND lines before the first step. Parse // source: and // language: file headers. Compute derived fields (paramCount/stepCount/owningSymbol). Backward compatible with legacy files. Unit tests: snapshot tests on existing .pseudo files in the repo plus targeted tests for each new feature."
    parallel: true
    depends-on: [db-overhaul]

  - id: pseudo-api-endpoints
    files:
      - src/routes/pseudo-api.ts
      - src/routes/pseudo-api.test.ts
    tests:
      - src/routes/pseudo-api.test.ts
    description: "Refactor GET /stats to call new db.getStats(). Wire up new GET /source-link endpoint with query params name + hintFileStem. Update callers of getExports() in MCP tools (grep for .purpose) to use stepSummary. Add tests for source-link endpoint and updated stats/coverage shapes."
    parallel: true
    depends-on: [db-overhaul]

  - id: parser-ingest-integration
    files:
      - src/services/pseudo-db.ts
    tests:
      - src/services/__tests__/pseudo-db.test.ts
    description: "In pseudo-db.ts's upsertFile and bulkIngest, wire in the new parser fields (visibility/isAsync/kind/sourceLine/etc.) to the INSERT statements. Add scanSourceFileForLines implementation (TS primary, C#/C++ good-effort, Python opportunistic). Call resolveCalleesForFile after upsertFile. Compute source_mtime/source_hash/line_count via fs.statSync + bounded file read. Add tests for end-to-end parser-to-db round trip with source file scan."
    parallel: false
    depends-on: [db-overhaul, parser-overhaul]
```

### Execution Waves

**Wave 1 (2 parallel tasks):**
- `db-overhaul`
- `skill-and-spec-updates`

**Wave 2 (2 parallel tasks):**
- `parser-overhaul`
- `pseudo-api-endpoints`

**Wave 3 (1 task):**
- `parser-ingest-integration` (the glue task — only wires parser output into db ingest after both sides exist)

### Summary
- Total tasks: 5
- Total waves: 3
- Max parallelism: 2

---

## 4. Out of Scope / Deferred

**NICE-TO-HAVE columns** (per audit) — not in Phase 3:
- `methods.deprecated` + `deprecation_note`
- `methods.throws`
- `methods.doc`
- `methods.is_test`
- `method_tags` table
- `file_imports` table
- `method_calls.call_kind`
- `methods.complexity`

**Other deferrals:**
- **NICE-TO-HAVE endpoints** (`/api-surface`, `/deprecated`, `/unresolved-calls`, `/complexity`, bulk-files batch) — not needed for Phase 4+ navigation features. Defer until a feature demands them.
- **100% parser accuracy** — parser is tolerant by design. Any unparseable line becomes null fields. No crash guarantees.
- **Source scan accuracy beyond good-effort** — TS primary, all others good-effort per user decision. Failing scans leave sourceLine null.
- **Disambiguating overloaded methods by param signature** in source scan — first match wins in Phase 3; Phase 4 can add disambiguation when needed.
- **Migration from a live DB with data** — unnecessary; pseudo.db is gitignored, users re-index.
- **`method_params` structured table** — the audit calls for a real type tokeniser first. Defer.

---

## 5. Validation

At the end of Phase 3 the following must work:

1. **Schema migrates cleanly.** An existing v0 DB (or a fresh install) comes up at v1 without errors. `schema_version` table exists.
2. **Old-format files still parse.** A `.pseudo` file with no `// source:` / `// language:` / metadata markers goes through the parser and produces a ParsedPseudoFile with all new fields null/default, no errors.
3. **New-format files populate all columns.** A `.pseudo` file with full metadata goes through parser → db and every new column has the right value.
4. **Overloaded methods don't error.** A `.pseudo` with two `FUNCTION foo(...)` entries on the same file (different params) ingests without a UNIQUE constraint violation.
5. **`getCoverage()` returns real data.** Walks source tree, compares to `source_file_path` set, returns non-trivial `missingFiles`.
6. **`getStats()` uses COUNT queries.** Verify via explain or manual check — no JS reduce over listFiles.
7. **`getFile()` is one query.** Verify via enabling query logging or by counting queries in a test.
8. **`getCallGraph()` doesn't double-count on stem collisions.** Create two `.pseudo` files in different directories with the same stem, verify edges resolve correctly via `callee_method_id`.
9. **`GET /api/pseudo/source-link?name=login` returns candidates.** End-to-end: write a TS file with a `login` function, write a pseudo with `// source:`, run upsert, hit the endpoint, see `{ candidates: [{ sourceFilePath, sourceLine, language, isExported }] }`.
10. **`/pseudocode` skill produces metadata markers.** Run on a new file, check the output has `// source:`, `VISIBILITY:`, `ASYNC:` where applicable.
11. **Root and skill-dir specs are identical.** `diff PSEUDOCODE_SPEC.md skills/pseudocode/PSEUDOCODE_SPEC.md` shows no differences.
12. **No regressions.** Existing Phase 1 + Phase 2 features unchanged. Existing `pseudo-api.test.ts` + any other affected test suites still pass.
13. **Tests green.** `npm run test:backend -- pseudo` runs all the new + existing pseudo tests green.

---

## 6. Risks + Mitigation

### Regex → tokeniser replacement
**Risk:** the new parser has bugs that existing `.pseudo` files didn't expose.
**Mitigation:** glob all `.pseudo` files in the repo and snapshot-test the parser output against the old regex parser. Add a comparison test that flags any difference.

### Source line extraction inaccuracy
**Risk:** C#/C++ regex misses method definitions.
**Mitigation:** Accept as good-effort. Tests for each language exercise typical cases. Future enhancement path via real parsers.

### `callee_method_id` resolution on single-file `upsertFile`
**Risk:** when a single file is upserted, its calls to files not yet in the DB stay unresolved forever.
**Mitigation:** `resolveCalleesForFile` does backward-resolution too (scans existing unresolved rows that point to the new file's stem). When a new file B is added later, previously-unresolved calls from A→B get resolved.

### Spec file consistency fix
**Risk:** the project-root PSEUDOCODE_SPEC.md is read by the `/pseudocode` skill at runtime — editing it may change behavior.
**Mitigation:** the skill already falls back to the skill-dir copy; keeping them identical is the stated goal. Run the skill on a small test file before finalizing to confirm output matches expectations.

### Field rename `purpose` → `stepSummary` in getExports
**Risk:** MCP tools or UI components that consume this field break silently.
**Mitigation:** `parser-overhaul` / `pseudo-api-endpoints` task includes a mandatory Grep step — before renaming, search for `.purpose` in `src/mcp/tools/` and `ui/src/`. Update any matches in the same task.
