# Pseudo-DB Audit and Schema Extension Recommendations

Audit of the current pseudo-db implementation with proposed improvements to bundle with the planned `source_line` / `source_line_end` / `source_file_path` schema extension.

## Part 1: Current Schema Summary

### Tables

**`files`** — one row per `.pseudo` file
- `id INTEGER PK AUTOINCREMENT`
- `file_path TEXT UNIQUE NOT NULL` — path to the `.pseudo` file
- `file_stem TEXT NOT NULL DEFAULT ''` — basename without `.pseudo`
- `title TEXT NOT NULL` — first `//` header line
- `purpose TEXT NOT NULL DEFAULT ''` — second `//` header line
- `module_context TEXT NOT NULL DEFAULT ''` — prose between headers and first FUNCTION
- `synced_at TEXT` — value of `// synced:` header
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))` — **never updated anywhere; no trigger. CRUFT.**

**`methods`** — one row per `FUNCTION`
- `id`, `file_id FK`
- `name`, `params TEXT`, `return_type TEXT`
- `is_exported INTEGER`
- `date TEXT` — `[YYYY-MM-DD]` tag
- `sort_order INTEGER`
- `UNIQUE(file_id, name)` — **BUG: breaks on overloaded methods; C#/TS legitimately allow this.**

**`method_steps`**
- `id`, `method_id FK`, `content`, `depth`, `sort_order`

**`method_calls`**
- `id`, `caller_method_id FK`, `callee_name`, `callee_file_stem`
- **No FK to callee** — edges resolved by string join on `file_stem`. Fragile with stem collisions across directories.

**`pseudo_fts`** — contentless FTS5 over `(method_name, step_content)` only. `title`, `purpose`, `module_context`, `params`, `return_type` are NOT searchable.

### Indexes
`idx_files_path`, `idx_files_stem`, `idx_methods_file`, `idx_methods_name`, `idx_method_steps_method`, `idx_method_calls_callee`, `idx_method_calls_caller`

### Real Bugs Found in Current Schema

1. **`updated_at` is a lie.** `upsertFile` does DELETE+INSERT, column always equals `created_at`. `listFiles()` returns it as `lastUpdated`.
2. **`getCoverage()` is broken.** Returns `coveredFiles === totalFiles`, `percent = 100`, empty `missingFiles`. No concept of "which source files exist" stored anywhere. `pseudo_coverage_report` MCP tool returns meaningless data.
3. **`getStats` has N+1** — calls `listFiles()` and sums in JS. Should be three scalar COUNT queries.
4. **`getFile()` has N+1** — one query for methods, then one for steps and one for calls **per method**. A 30-method file = 61 queries.
5. **Missing index** on `method_calls.callee_file_stem`. Only `callee_name` is indexed but the join uses both.
6. **`getCallGraph` stem-collision bug** — LEFT JOIN `files ON file_stem = callee_file_stem`. If two files share a stem (`src/util.pseudo` and `tests/util.pseudo`), the join double-counts.
7. **`getImpactAnalysis` recursive CTE has dead code.** Redundant join through `f_match`/`m_match` after depth-1 already has the info. `SELECT DISTINCT` + `GROUP BY` — one is dead.
8. **FTS delete dance is expensive.** `bulkIngest` does `GROUP_CONCAT` over full methods × steps just to emit delete rows before `DELETE FROM files`. For full rebuilds, `DROP TABLE pseudo_fts; CREATE...` inside the tx would be cheaper.
9. **`getExports()`'s `purpose` field is mislabeled** — it's actually concatenated step content, not the file purpose. Misleading field name.
10. **Brittle FUNCTION header regex** — `\([^)]*\)` can't handle nested parens in param types like `(cb: (x: T) => U)`. Generic type parameters not captured.
11. **Spec inconsistency** — the project-root `PSEUDOCODE_SPEC.md` example doesn't include `// synced:` but the skill REQUIRES it and the parser expects it. The skill-directory copy does include it.

---

## Part 2: Proposed Schema Changes

### MUST-HAVE (add now while schema is open)

#### On `files`

| Column | Type | Why | Parse Cost | Parser Change? |
|--------|------|-----|------------|----------------|
| `source_file_path` | TEXT | **Planned.** Map pseudo back to source. Enables click-to-open, real stale detection, coverage. | Cheap — read `// source:` header or derive from pseudo path | Yes — add `// source:` header support |
| `source_mtime` | TEXT (ISO) | Real stale detection (compare source mtime vs `synced_at`). Fixes `getCoverage()` and gives `pseudo_stale_check` real teeth. | Cheap — `fs.statSync` at ingest | No — set during upsert |
| `source_hash` | TEXT (short sha1) | Detect whether code under a function has drifted, not just the pseudo. | Cheap at ingest | No |
| `language` | TEXT (ts/tsx/py/cs/cpp/go/rs) | Derived from source extension. Unblocks language-conditional visibility rules. | Cheap | Yes — `// language:` header (optional) |
| `indexed_at` | TEXT DEFAULT (datetime('now')) | Real "last re-indexed" timestamp. **Replaces broken `updated_at`.** | Free | No |
| `line_count` | INTEGER | File-level complexity. Enables "biggest files" views. | Free | No |

**Drop or rename `updated_at`** — replace with `indexed_at`. Currently a lie.

#### On `methods`

| Column | Type | Why | Parse Cost | Parser Change? |
|--------|------|-----|------------|----------------|
| `source_line` | INTEGER | **Planned.** Jump to function. | Hybrid: skill may hint, parser falls back to source scan | Yes |
| `source_line_end` | INTEGER | **Planned.** Method span. | Same | Yes |
| `visibility` | TEXT (public/private/protected/internal/null) | TS and C# both have it. Enables API-surface extraction. | Cheap if captured at pseudo-write time | Yes — `VISIBILITY:` marker |
| `is_async` | INTEGER | Call-graph colouring, "unawaited promise" heuristics. | Cheap | Yes — `ASYNC:` marker |
| `kind` | TEXT (function/method/constructor/getter/setter/callback) | Spec rule 7 requires named callbacks to get FUNCTION blocks but they're indistinguishable today. | Cheap marker | Yes — `KIND:` marker |
| `param_count` | INTEGER | Complexity metric. | Free — parser computes | No (derived) |
| `step_count` | INTEGER | Denormalized count for sort-by-size without join. | Free | No (derived) |
| `owning_symbol` | TEXT | Containing class/interface for methods. | Small parser change | Optional — parse from dotted name |

**Drop `UNIQUE(file_id, name)`.** Incorrectly rejects overloaded methods. Replace with `UNIQUE(file_id, name, sort_order)` or remove.

**Do NOT add `source_file_path` on `methods`** — keep it only on `files`. One pseudo == one source file is a useful invariant.

#### On `method_calls`

| Column | Type | Why | Parse Cost | Parser Change? |
|--------|------|-----|------------|----------------|
| `callee_method_id` | INTEGER NULL REFERENCES methods(id) ON DELETE SET NULL | Resolve the edge to a real FK at ingest time. **Fixes stem-collision bug.** | Small — second pass at end of ingest | No |
| `is_resolved` | INTEGER (computed) | Lets "unresolved calls" surface as UI affordance. | Free | No |

**New index:** `CREATE INDEX idx_method_calls_stem ON method_calls(callee_file_stem, callee_name)`

#### FTS Expansion

Add `title`, `purpose`, `module_context`, and `params` to the FTS table. Single highest-ROI FTS change — right now searching for a file's purpose returns zero hits unless the phrase happens to appear in a step.

---

### NICE-TO-HAVE (consider bundling)

| Addition | Why | Cost |
|----------|-----|------|
| `methods.doc` TEXT | Capture `DOC:` marker extracted from jsdoc/docstring. Tooltips and richer search. | Small parser change |
| `methods.complexity` INTEGER | Cyclomatic proxy: count IF/ELSE/FOR/WHILE/TRY in steps. | Free |
| `methods.deprecated` INTEGER + `deprecation_note` TEXT | `DEPRECATED:` marker. Migration views. | Small |
| `methods.throws` TEXT | `THROWS:` marker. Error-flow views. | Small |
| `method_calls.call_kind` TEXT | `direct`/`constructor`/`await`/`callback`. Graph edge styling. | Small |
| `file_imports(file_id, imported_stem, symbols_json)` table | Full dependency graph. Can be derived as a view. | Free |
| `method_tags(method_id, tag)` table | Freeform `TAGS:` labels. Extensible. | Small |
| `methods.is_test` | `TEST:` marker. Coverage overlay. | Small |

---

## Part 3: Query/Endpoint Improvements

### Existing Endpoints That Benefit

1. **`GET /api/pseudo/stats`** — replace JS summation with three COUNT queries.
2. **`GET /api/pseudo/file` (N+1)** — collapse to two queries using json_group_array.
3. **`GET /api/pseudo/coverage`** — currently broken. With `source_file_path` + `source_mtime`, coverage becomes real.
4. **`GET /api/pseudo/stale`** — compare `synced_at < source_mtime` rather than "date tag older than N days".
5. **`GET /api/pseudo/graph`** and **`pseudo_impact_analysis`** — recursive CTE becomes id-based walk. No string joins, correct across collisions.
6. **`GET /api/pseudo/orphans`** — proper dead code definition with `visibility` + resolved call graph.
7. **`GET /api/pseudo/search`** — widen FTS to include `title`/`purpose`/`module_context`/`params`.

### New Endpoints Unlocked

- **`GET /api/pseudo/api-surface`** — list exported methods with visibility and return types
- **`GET /api/pseudo/deprecated`**
- **`GET /api/pseudo/unresolved-calls`** — surfaces typos and missing pseudo
- **`GET /api/pseudo/source-link?method=...`** — return `source_file_path#L<start>-L<end>` for editor deep-linking. **Headline win.**
- **`GET /api/pseudo/complexity?threshold=`**
- **`POST /api/pseudo/bulk-files`** — batch fetch

---

## Part 4: Pseudocode Skill Updates

**This is a critical part of the schema extension** — if we add columns, the skill must emit the data that populates them.

### Current Skill Location

- **Path:** `skills/pseudocode/`
- **Files:** `SKILL.md` (8.2 KB instructions) + `PSEUDOCODE_SPEC.md` (7.3 KB format spec)
- **Invocation:** `/pseudocode` slash command or `mermaid-collab:pseudocode` Skill tool reference
- **Current tools allowed:** Read, Write, Edit, Glob, Grep, Bash, Agent

### Current Skill Format (what it produces today)

**Header:**
```
// Short title
// One or two sentences describing what this file does and why it exists.
// synced: 2026-03-26T14:30:00Z
```

**Function block:**
```
FUNCTION functionName(params) -> returnType                             EXPORT [YYYY-MM-DD]
  CALLS: callee1 (file-stem), callee2 (file-stem)
  1. Step description
  2. Step description
```

**What the skill currently does NOT emit:**
- File source path, language, line count
- Function visibility (public/private/protected/internal)
- Async markers
- Function kind (constructor/getter/setter/callback)
- Line numbers or line hints
- Doc extracts, throws, tags
- Deprecated markers, test markers

### Updated Format — File-Level Headers

Add optional headers after the `// synced:` line:

```
// Short title
// One or two sentences describing what this file does and why it exists.
// synced: 2026-03-26T14:30:00Z
// source: src/services/alias-generator.ts
// language: typescript
```

**Parser behavior:**
- `// source:` — recorded as `files.source_file_path`. If missing, parser attempts to derive from the pseudo file path (strip `.pseudo`, probe common extensions `.ts`, `.tsx`, `.py`, `.cs`, `.cpp`, `.go`, `.rs`).
- `// language:` — recorded as `files.language`. If missing, parser derives from the source file extension.
- `source_mtime`, `source_hash`, `line_count` are computed by the parser at ingest time, not written by the skill.

### Updated Format — Function-Level Metadata Markers

**Design decision: directive-style lines after FUNCTION header, before body.** Chosen over extending the FUNCTION line itself because it scales to many markers without creating a regex nightmare.

```
FUNCTION authenticate(username, password) -> Promise<AuthToken>          EXPORT [2026-04-09]
  VISIBILITY: public
  ASYNC: true
  THROWS: AuthenticationError, RateLimitError
  CALLS: queryDatabase (db-client), validateToken (auth-utils)
  1. Look up user in database.
  2. Verify password hash.
  3. IF valid, generate JWT token.
  4. IF invalid, increment failed attempt counter.
```

**Markers recognized by the parser (all optional):**

| Marker | Values | Maps to |
|--------|--------|---------|
| `VISIBILITY:` | public / private / protected / internal | `methods.visibility` |
| `ASYNC:` | true | `methods.is_async` |
| `KIND:` | function / method / constructor / getter / setter / callback | `methods.kind` |
| `DEPRECATED:` | `<reason text>` | `methods.deprecated` + `deprecation_note` (nice-to-have) |
| `THROWS:` | `Err1, Err2, Err3` | `methods.throws` (nice-to-have) |
| `DOC:` | `<summary line>` | `methods.doc` (nice-to-have) |
| `TAGS:` | `tag1, tag2` | `method_tags` table (nice-to-have) |
| `TEST:` | true | `methods.is_test` (nice-to-have) |

**Parser computes automatically (not emitted by skill):**
- `params_count` — count the params string
- `step_count` — count the step lines
- `owning_symbol` — extract from dotted function names like `UserService.login`
- `is_async` — can also be inferred from `ASYNC:` marker

### Line Number Strategy — Hybrid Approach

**Three-tier fallback** for populating `source_line` / `source_line_end`:

1. **Skill hints** (preferred when skill knows): add a comment like `// ~ line 45` on the FUNCTION line
2. **Parser source scan** (fallback): parser reads the sibling source file and does a language-aware search for the function name (regex matching on language-specific signatures)
3. **Leave null** (graceful degradation): if neither works, `source_line` stays null. Feature A dropdown falls back to CodeMirror Lezer parsing.

**Recommendation:** Don't require the skill to emit line numbers. It's error-prone and would require Claude to count lines accurately. Let the parser do it via source scan. The skill just needs to emit `// source: <path>` so the parser knows which file to scan.

### Backward Compatibility

**All new markers are optional.** Old `.pseudo` files without markers continue to parse correctly:
- Missing `// source:` → parser attempts derivation, column may be null
- Missing `VISIBILITY:` → defaults to null (which the UI can render as "unknown")
- Missing any marker → the corresponding column is null

The skill's update logic must handle both old and new formats. When updating an old file, it can optionally add new markers but must not clobber content it doesn't understand.

### Concrete SKILL.md Changes

**1. Add a new step between current Step 2 and Step 3:**

```markdown
### Step 2b: Source Metadata (Optional Headers)

After the `// synced:` line, you may add file-level metadata headers:

    // source: src/services/alias-generator.ts
    // language: typescript

Include `// source:` when you know the path. The parser uses this to cross-reference
the source file for line number discovery and change detection.
```

**2. Update the Step 3 generation example to show the new markers:**

```markdown
FUNCTION authenticate(username, password) -> Promise<AuthToken>    EXPORT [2026-04-09]
  VISIBILITY: public
  ASYNC: true
  THROWS: AuthenticationError
  CALLS: queryDatabase (db-client)
  1. Look up user in database.
  2. Verify password hash.
  3. IF valid, generate JWT token.
```

**3. Add a "Function Metadata Markers" subsection** listing all supported markers with a rule:
> Use markers only when they add clarity. A public synchronous function with no throws needs no markers. Omit markers that add no value.

**4. Update the "If `.pseudo` file exists — Update" flow:**
- Check whether visibility or async-ness changed
- Check whether new exceptions were added
- Update the corresponding markers if so
- Update `// synced:` timestamp

### Concrete PSEUDOCODE_SPEC.md Changes

**1. Spec-level:** Fix the inconsistency — the project-root copy should include `// synced:` in the header example, matching the skill-directory copy.

**2. Add "### Function-Level Metadata (Optional)" section** after "### Cross-file references (CALLS)" with the full marker list and examples.

**3. Add "### File-Level Metadata (Optional)" section** for `// source:` and `// language:` headers.

### Language-Specific Guidance for the Skill

Add a section to SKILL.md about language-specific conventions:

| Language | Visibility inference | Async marker | Kind markers |
|----------|---------------------|--------------|--------------|
| TypeScript | Use explicit `public/private/protected` keywords when present; default public if EXPORT | `ASYNC: true` for `async function` | `KIND: constructor/getter/setter/method` |
| C# | Use explicit `public/private/protected/internal` keywords | `ASYNC: true` for `async Task<T>` | `KIND: constructor/getter/setter/method` |
| C++ | Best-effort from `public:`/`private:` sections in class | N/A (or `ASYNC: true` for coroutines) | `KIND: constructor/destructor/method` |
| Python | Leading `_` = private by convention, `__` = private-mangled | `ASYNC: true` for `async def` | `@property` → getter, etc. |

### Parser Changes Required

The parser (`src/services/pseudo-parser.ts`) needs:

1. **Replace the FUNCTION regex with a line tokeniser.** Current regex can't handle nested parens. Every future marker addition cracks it further. This is a must-do.
2. **Add header parsing** for `// source:` and `// language:`.
3. **Add metadata line parsing** — recognize `VISIBILITY:`, `ASYNC:`, `KIND:`, `DEPRECATED:`, `THROWS:`, `DOC:`, `TAGS:`, `TEST:` as metadata before the first step.
4. **Add source file scan** for line number discovery when `// source:` is present.
5. **Add derived field computation** — `param_count`, `step_count`, `owning_symbol` from parsed data.
6. **Add language-specific line extraction** — TS → C# → C++ order. Good-effort, not 100% accurate.

---

## Part 5: Migration Strategy

### Approach

The SQLite file lives at `{project}/.collab/pseudo/pseudo.db` and is **gitignored** — no cross-user migration needed. Each user re-indexes on first run. Low risk.

1. **Add a `schema_version` table** (`id INTEGER PK CHECK(id=1), version INTEGER`). If missing, treat as v0.
2. At service construction, read version. If below target, drop and recreate with new schema, then **full re-ingest** by walking `.pseudo` files (DB is cache).
3. For source-derived columns (`source_mtime`, `source_hash`, `line_count`, `language`, `source_line`), compute during re-ingest.
4. For marker-dependent columns (`visibility`, `is_async`, `kind`, `deprecated`), default to null — they get filled in lazily as pseudo files are rewritten via `/pseudocode`. **Progressive enhancement.**
5. **All new columns must be nullable** so untouched `.pseudo` files keep working.

### Language-Specific Gaps

- **Python:** auto-infer `visibility='private'` for names starting with `_` when `language='py'`
- **Go:** capital first letter = exported (can co-populate `is_exported`)
- **Rust:** `pub`/`pub(crate)` → `public`/`internal`
- **C#/TS:** explicit modifiers, one-to-one mapping
- **C++:** best-effort from class visibility sections

---

## Part 6: Anti-Recommendations

### Do NOT add:

1. **Structured `method_params` table** — parser needs real type tokeniser first
2. **`test_coverage` column backed by runner output** — scope creep
3. **Embedding/vector column** — FTS5 is sufficient
4. **`history`/`audit` table** — git is the audit log
5. **Normalizing `module_context`** — it's free-form prose by spec
6. **`source_file_path` on `methods`** — duplication with `files`
7. **`call_count`/`last_called_at`** — implies runtime telemetry
8. **Denormalizing `method_calls` into `files`** — breaks impact analysis
9. **"Fixing" `updated_at` with a trigger** — just replace with `indexed_at`
10. **Expanding FTS to trigram** — doubles index size for marginal gains
11. **Per-step FK to `method_calls`** — nobody asked for this
12. **Forcing the skill to emit line numbers** — error-prone, let the parser scan

### Cruft to Clean in the Same PR

- Remove/rename unused `updated_at` → `indexed_at`
- Fix or delete broken `getCoverage()`
- Rename `getExports().purpose` (mislabeled — it's concatenated steps)
- Replace FTS delete dance in `bulkIngest` with DROP+CREATE
- **Replace FUNCTION header regex with a line tokeniser**
- Fix inconsistency between project-root and skill-directory `PSEUDOCODE_SPEC.md`

---

## Recommended Scope for This PR

Bundle everything in a single focused migration:

1. **Schema changes** (all MUST-HAVE columns) with `schema_version` table
2. **Parser overhaul**:
   - Regex → line tokeniser for FUNCTION headers
   - New header parsing (`// source:`, `// language:`)
   - New metadata line parsing (VISIBILITY, ASYNC, KIND, etc.)
   - Source file scan for line numbers
   - Derived field computation
3. **Skill updates**:
   - `SKILL.md` — new Step 2b, updated Step 3 examples, Function Metadata Markers section, language-specific guidance
   - `PSEUDOCODE_SPEC.md` — File-Level Metadata section, Function-Level Metadata section
   - Fix project-root / skill-directory consistency
4. **Bug fixes**: coverage, stats N+1, getFile N+1, stem-collision, missing index, unused updated_at, FTS delete dance
5. **Widened FTS** (title, purpose, module_context, params)
6. **NEW `/api/pseudo/source-link` endpoint** — the headline feature

**Defer NICE-TO-HAVE** (deprecated, throws, doc, tags, test markers, file_imports table, method_tags table, call_kind) to follow-ups as features need them.

**Test plan:**
- Re-ingest a known project's pseudo files; verify all MUST-HAVE columns are populated
- Verify old `.pseudo` files without new markers still parse
- Verify skill-updated files round-trip (write → parse → re-write idempotently)
- Test line number extraction per language (TS, C#, C++)
- Verify broken endpoints now work (coverage, stale, graph with stem collision)

---

## Critical Files

**Backend:**
- `src/services/pseudo-db.ts` — schema, queries, bugs
- `src/services/pseudo-parser.ts` — regex → lexer, new markers, source scan
- `src/routes/pseudo-api.ts` — endpoint cleanups, new endpoints
- `src/mcp/setup.ts` — MCP tool registrations

**Skill:**
- `skills/pseudocode/SKILL.md` — updated instructions
- `skills/pseudocode/PSEUDOCODE_SPEC.md` — updated format spec
- `PSEUDOCODE_SPEC.md` (project root) — fix consistency with skill copy