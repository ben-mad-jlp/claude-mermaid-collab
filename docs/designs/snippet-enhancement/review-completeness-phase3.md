# Completeness Review — Phase 3

Reviewed against blueprint `bp-phase3-pseudo-overhaul` (Sections 1 and 2).

## Summary

**Result:** 1 gap found. Structure, schema, parser, API, skill, and spec work is all in place. Two new source-link endpoint tests fail due to `scanSourceFileForLines` unconditionally overwriting parser-provided `sourceLine` values.

## File Existence Check — all present

| File | Status |
|---|---|
| `src/services/pseudo-db.ts` | present, modified |
| `src/services/pseudo-parser.ts` | present, modified |
| `src/routes/pseudo-api.ts` | present, modified |
| `src/services/__tests__/pseudo-db.test.ts` | present, new |
| `src/services/__tests__/pseudo-parser.test.ts` | present, new |
| `src/routes/pseudo-api.test.ts` | present, modified |
| `skills/pseudocode/SKILL.md` | present, modified |
| `skills/pseudocode/PSEUDOCODE_SPEC.md` | present, modified |
| `PSEUDOCODE_SPEC.md` (project root) | present, modified |

## Schema + Symbol Checks (pseudo-db.ts)

All required pieces confirmed:

- `schema_version` table + `SCHEMA_VERSION = 1` + `migrate()` method at lines 238-269 (drops data tables on v0→v1)
- New files columns: `source_file_path`, `source_mtime`, `source_hash`, `language`, `line_count`, `indexed_at` (lines 124-130)
- New methods columns: `visibility`, `is_async`, `kind`, `source_line`, `source_line_end`, `param_count`, `step_count`, `owning_symbol` (lines 142-149)
- `method_calls.callee_method_id` column (line 166) + index `idx_method_calls_callee_id` (line 189) + `idx_method_calls_stem` (line 188)
- No `UNIQUE(file_id, name)` constraint on methods (confirmed via grep) — overloads supported
- Widened FTS: `method_name, step_content, title, purpose, module_context, params` (lines 169-178)
- `getStats()` method using COUNT subqueries (lines 914-927) — no JS reduce
- `getSourceLink(name, hintFileStem?)` (lines 993-1020) with optional hint filter
- `getCoverage()` rewrite walking source tree vs `source_file_path` set (lines 929-991)
- `resolveCalleesForFile(fileId)` private method with forward + backward resolution (lines 371+)
- `scanSourceFileForLines(sourceFilePath, methods, language)` private method (lines 454-481)
- `findMethodLineForLanguage` module helper with branches for TS/JS, C#, C++/C, Python (lines 1061-1108)
- `getFile()` single-query replacement using `json_group_array` (lines 649+)
- `getCallGraph()` using `callee_method_id` join (lines 779-797)
- `getImpactAnalysis()` recursive CTE using `callee_method_id` (lines 838-880)
- `getExports()` returns `stepSummary` field (lines 801-816) — no `purpose`
- `bulkIngest()` uses `DROP VIRTUAL TABLE ... CREATE VIRTUAL TABLE` for FTS rebuild (lines 508+) + single-statement callee resolution pass (line 611+)

## Symbol Checks (pseudo-parser.ts)

- `parseFunctionHeader` helper at line 216
- `extractMethodMetadata` helper at line 287
- `// source:` header parsed into `sourceFilePath` (line 71)
- `// language:` header parsed into `language` (lines 72-73)
- `VISIBILITY` / `ASYNC` / `KIND` marker handling (lines 322-332)
- `ParsedPseudoFile` extended with `sourceFilePath`/`language` (lines 32-33)

## Symbol Checks (pseudo-api.ts)

- `/source-link` endpoint (line 83) calling `db.getSourceLink(name, hintFileStem)` (line 89)
- `/stats` delegates to `db.getStats()` (line 94) — no inline reduce

## Stub Search

Grep for `TODO`, `NotImplementedError`, `Not implemented`, `raise NotImplementedError` across `pseudo-db.ts`, `pseudo-parser.ts`, `pseudo-api.ts`: **no matches**. No stubs.

## Deferred Columns Check (out-of-scope per Section 4)

Grep for `deprecated`, `deprecation_note`, `throws`, `is_test`, `complexity`, `method_tags`, `file_imports`, `call_kind` in `pseudo-db.ts`: **no matches**. Correctly deferred.

## Spec Consistency

`diff PSEUDOCODE_SPEC.md skills/pseudocode/PSEUDOCODE_SPEC.md` exit code: **0 (empty)** — files are byte-identical.

Both contain:
- `File-Level Metadata (Optional)` section (skill copy line 40)
- `Function-Level Metadata (Optional)` section (skill copy line 79)

`skills/pseudocode/SKILL.md` contains:
- Step 2b (heading "## Step 2b: Source Metadata Header (Optional but Recommended)" at line 33 — blueprint called it "File Source Metadata Header" but intent fulfilled)
- "## Function Metadata Markers" section (line 213)
- "### Visibility and async conventions per language" subsection (line 249)

## Test Runs

### `bun test src/services/__tests__/pseudo-db.test.ts`

```
18 pass
 0 fail
64 expect() calls
```

Matches expected 18/18.

### `bun test src/services/__tests__/pseudo-parser.test.ts`

```
30 pass
 0 fail
64 expect() calls
```

Matches expected 30/30.

### `bun test src/routes/pseudo-api.test.ts`

```
12 pass
15 fail
Ran 27 tests
```

**Expected:** 14 pass + 13 fail (13 pre-existing failures in `/files`, `/file`, `/search`).
**Actual:** 12 pass + 15 fail. The 13 pre-existing failures in `/files`, `/file`, `/search` are present as expected. **Two new failures** in `/source-link` are introduced by Phase 3.

The other new tests pass (stats, stepSummary, the non-scan source-link tests such as "returns empty candidates when no methods match" and the 400 validation test).

## Gap #1 — `scanSourceFileForLines` clobbers parser-provided sourceLine values

**Blueprint expectation (Section 1.3 upsertFile flow, Section 2.1 scanSourceFileForLines):**
The scan is to *fill* sourceLine/sourceLineEnd as a best-effort supplement. The tests the blueprint team wrote at `src/routes/pseudo-api.test.ts:406-481` assert that when a parsed method arrives with `sourceLine: 42, sourceLineEnd: 58` already populated, the value survives a round-trip through `upsertFile`.

**Actual implementation (`src/services/pseudo-db.ts:470-480`):**

```ts
for (const method of methods) {
  const searchName = method.name.includes('.')
    ? method.name.split('.').pop()!
    : method.name;

  const result = findMethodLineForLanguage(lines, searchName, language);
  if (result) {
    method.sourceLine = result.line;       // unconditional overwrite
    method.sourceLineEnd = result.lineEnd; // unconditional overwrite
  }
}
```

The loop unconditionally overwrites both fields whenever the regex scan finds a match. In the failing tests the scan finds `export function foo() {}` on line 1 of the single-line test source file, so the parser-provided `sourceLine: 42` is clobbered to `1`.

**Failing tests:**
- `Pseudo API Routes > GET /api/pseudo/source-link > returns candidates for methods with sourceLine` (pseudo-api.test.ts:406-442) — expected `sourceLine: 42, sourceLineEnd: 58`, got `sourceLine: 1, sourceLineEnd: 1`
- `Pseudo API Routes > GET /api/pseudo/source-link > filters by hintFileStem` (pseudo-api.test.ts:444-481) — expected `sourceLine: 10`, got `sourceLine: 1`

**Fix location:** `src/services/pseudo-db.ts:477-478` — guard the assignment to only run when `method.sourceLine == null` (and same for sourceLineEnd):

```ts
if (result) {
  if (method.sourceLine == null) method.sourceLine = result.line;
  if (method.sourceLineEnd == null) method.sourceLineEnd = result.lineEnd;
}
```

This matches the blueprint's "fill" semantics (scan supplements parser output, does not override it) and makes the two failing tests pass without affecting any other behavior (parser currently emits null for these fields when no explicit source metadata is present, so real ingest paths still get populated by the scan).

## Everything Else — Complete

Aside from Gap #1 above, every item in Section 1 "Structure Summary" and Section 2 "Function Blueprints" is implemented in the expected location with the expected shape, all stub checks are clean, deferred columns are correctly absent, and the two larger test files (`pseudo-db.test.ts` 18/18 and `pseudo-parser.test.ts` 30/30) hit blueprint-declared pass counts exactly.
