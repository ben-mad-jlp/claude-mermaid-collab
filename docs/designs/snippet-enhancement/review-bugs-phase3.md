# Bug Review — Phase 3 (Pseudo-DB Overhaul)

Scope: uncommitted working-tree changes to pseudo-db.ts, pseudo-parser.ts, pseudo-api.ts, their tests, and skills/pseudocode docs.

Verified by running `bun test` against the two new test files and `bun run test:backend` against pseudo-api.test.ts.

## Result
- pseudo-db.ts correctness: CLEAN
- pseudo-parser.ts correctness: CLEAN
- New test suites (`pseudo-db.test.ts` 18/18, `pseudo-parser.test.ts` 30/30) all PASS under `bun test`.
- 1 test-correctness bug found in `pseudo-api.test.ts` (latent — currently masked by pre-existing vitest infra failure).
- 1 important infra mismatch that blocks the new API tests from running under `npm run test:backend` (pre-existing but made worse by Phase 3).
- 1 minor coverage walker miss.

---

## Bug 1 — Important — Test assertions contradict scanner behavior (latent)

File: `src/routes/pseudo-api.test.ts`

Three test cases in the new describe blocks pass hand-rolled `sourceLine` / `sourceLineEnd` values and expect them back verbatim, but `upsertFile` runs `scanSourceFileForLines` BEFORE insert, which OVERWRITES `method.sourceLine` / `sourceLineEnd` with what it finds in the real source file on disk.

Cases:
- Lines 406-442 `returns candidates for methods with sourceLine` — writes `export function foo() {}\n` (line 1) as `foo.ts`, passes `sourceLine: 42, sourceLineEnd: 58`, and `expect(...).toEqual({ sourceLine: 42, sourceLineEnd: 58, ... })`. The scanner will rewrite these to line 1 / null (findClosingBrace can't close on same line without `{` preceding `}` properly — actually it will close at 1 since `{` and `}` are on the same line). The assertion will fail the moment the vitest mock issue is fixed.
- Lines 444-481 `filters by hintFileStem` — same pattern: writes `export function foo() {}\n` (line 1) to both `a.ts` and `b.ts`, passes `sourceLine: 10, 30`, asserts `sourceLine === 10`. Scanner will rewrite both to 1.

Why it matters: as soon as the `bun:sqlite` vitest mock is patched to support `prepare`, these assertions start failing because the scanner silently re-derives line numbers from disk.

Fix (pick one):
- Option A: remove the `sourceLine` / `sourceLineEnd` asserts; just verify `candidates.length === 1` and `sourceFilePath === srcPath`.
- Option B: place the function at the line the test expects (e.g. 41 newlines of header before `export function foo()`).
- Option C: make the source file NOT exist / use an extension the scanner skips (e.g. `.xyz` with `language: 'haskell'`) so the scanner early-returns and preserves the caller-supplied line.

The parallel test in `src/services/__tests__/pseudo-db.test.ts:335` (“returns candidate with sourceLine when method has sourceLine”) gets this right — it carefully puts `findMe` on line 10 with 8 header lines. Use it as the template.

## Bug 2 — Important — Vitest mock of bun:sqlite lacks `prepare`; Phase 3 adds 7 more tests that can’t run

File: `vitest.setup.ts` (pre-existing) interacting with the NEW pseudo-api tests.

`vitest.setup.ts` mocks `bun:sqlite` with a `DatabaseWrapper` that exposes only `query`, `run`, `exec`, `close` — no `prepare`. `pseudo-db.ts` calls `this.db.prepare(...)` everywhere, so ANY pseudo-db path under vitest throws `TypeError: this.db.prepare is not a function` (including the new `INSERT INTO schema_version ... VALUES (1, ?)` on line 268 during migrate()).

Pre-existing state: `pseudo-api.test.ts` already had 16 failing tests at HEAD for this exact reason (verified by stashing + re-running). Phase 3 adds 7 new tests (stats x2, source-link x4, exports x2 minus the 400-error case that doesn't touch the DB), which ALSO fail with the same error. Net: `pseudo-api.test.ts` now reports 23 failing / 4 passing under `test:backend`.

Additionally: `src/services/__tests__/pseudo-db.test.ts` and `pseudo-parser.test.ts` import from `'bun:test'`, which vitest doesn't provide. Under `bun run test:backend` vitest walks these files (they match the `src/**/*.test.ts` glob) and reports `(0 test)` for each. They work only under the `bun test` runner. (Other `bun:test` files in the same `__tests__` folder predate Phase 3 and exhibit the same behavior, so this isn't a regression — just noting it so the tests aren't assumed to run in `test:backend`.)

Fix (pick one):
- Short-term: extend `vitest.setup.ts`'s `DatabaseWrapper` to provide a `prepare(sql)` method that returns an object with `get/all/run` bound to a reused better-sqlite3 statement. (Existing files tests would also start working.)
- Or exclude `src/routes/pseudo-api.test.ts` and the pseudo-db/parser `__tests__` files from vitest's `include` and run them only via `bun test`.
- Or rewrite the new pseudo-api stats/source-link/exports tests to call the pseudo-db service directly (not through vitest + the mock), or co-locate them under `src/services/__tests__/` using `bun:test` — where they already work cleanly in the pseudo-db test file.

Note: If you fix the scanner-overwrite problem in Bug 1 at the same time you fix the mock in Bug 2, the new pseudo-api tests should go green. Otherwise fixing Bug 2 alone will expose Bug 1.

## Bug 3 — Minor — Coverage walker doesn’t skip `__tests__` directories

File: `src/services/pseudo-db.ts` lines 966-991 (`walkSourceTree`).

`if (name.includes('__tests__')) continue;` runs only inside the `entry.isFile()` branch. Test-helper files inside a `__tests__` directory that don’t match `.test.` / `.spec.` / `.d.ts` (e.g. `src/services/__tests__/fixtures.ts`) will be walked into and counted as source, inflating `totalFiles` and appearing as `missing` in coverage.

Not critical because `COVERAGE_EXCLUDES` handles common cases and most tests match `.test.` or `.spec.`, but worth tightening.

Fix: move the `__tests__` check into the directory branch — e.g. at the top of the loop:

```ts
if (COVERAGE_EXCLUDES.has(name)) continue;
if (name === '__tests__') continue;
if (name.startsWith('.') && name !== '.') continue;
```

## Verified correct (no bugs)

### pseudo-db.ts
- Schema migration uses `DROP TABLE IF EXISTS` and recreates cleanly (lines 258-268).
- `schema_version` uses `id INTEGER PRIMARY KEY CHECK (id = 1)` and `INSERT VALUES (1, ?)`.
- FTS table widened with `title`, `purpose`, `module_context`, `params` columns and matching INSERT in upsertFile + bulkIngest.
- `methods` table has NO `UNIQUE(file_id, name)` constraint — overloaded methods work (confirmed by test `handles overloaded methods`).
- `getStats` uses COUNT subqueries (line 914-920), not JS reduce.
- `getCallGraph` joins on `mc.callee_method_id` (line 789), not stem string — verified by `resolves edges using callee_method_id` test.
- `getImpactAnalysis` recursive CTE uses `callee_method_id` / `method_id`, not names (lines 841-854).
- `resolveCalleesForFile` runs both forward (by caller file_id) and backward (fills in NULL pointers to this file) passes.
- `getCoverage` walks the filesystem and diffs against the `source_file_path` set.
- `getSourceLink` correctly filters `source_line IS NOT NULL AND source_file_path IS NOT NULL`, orders exports first.
- `scanSourceFileForLines` mutates the passed methods array in-place; `upsertFile` and `bulkIngest` both call it BEFORE the method insert loop.
- Scanner escapes the method name with `escapeRegex` before building the regex.
- Scanner strips dotted prefix (`searchName = method.name.split('.').pop()!` when the name contains `.`).
- Unknown languages return `null` from `findMethodLineForLanguage` — no crash.
- `findClosingBrace` uses a `seenOpen` flag + depth counter; handles same-line and multi-line cases.
- `getFile` json_group_array fallback handles both array-returning (bun:sqlite with native JSON) and string-returning (raw JSON) drivers via `Array.isArray(m.steps_json) ? ... : JSON.parse(...)`.
- `computeSourceMeta` wraps all disk access in try/catch and silently degrades.

### pseudo-parser.ts
- `parseFunctionHeader` uses a depth counter to walk nested parens — `map(cb: (x: T) => U) -> U[]` parses correctly (verified by test).
- `extractMethodMetadata` uses the `firstStepSeen` flag to bound metadata parsing to the pre-step region; unknown uppercase markers are dropped silently (forward compat).
- CALLS lines are passed through to the output body so `parseCallsFromBody` still runs on them.
- Derived fields `paramCount`, `stepCount`, `owningSymbol` are computed in both code paths (tests `paramCount = 3`, `stepCount reflects...`, `owningSymbol = Foo`).
- Legacy files with no new markers parse cleanly (`backward compatibility` test).
- Empty-content early-return and main-return both include `sourceFilePath` + `language`.
- Header parser reads `title`, `purpose`, then scans subsequent `//` lines for `synced:`, `source:`, `language:` markers (not positional after line 3).

### New test suites
- `src/services/__tests__/pseudo-db.test.ts` — 18/18 passing under `bun test`. Assertions are real (no `expect(true).toBe(true)` stubs); fixtures place functions at the expected line numbers; overloaded-method and stem-collision cases actually exercise the bug they describe.
- `src/services/__tests__/pseudo-parser.test.ts` — 30/30 passing under `bun test`. Coverage includes header parsing, nested-paren tokeniser, EXPORT/date, metadata markers with validation, derived fields, and backward compatibility.
