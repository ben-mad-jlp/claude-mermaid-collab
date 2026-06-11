# Phase 6 Bug Review

Scope: bug-only review of Phase 6 two-level indexing work. Design compliance was NOT checked.

## Summary

- Critical: 0
- Important: 2
- Minor: 4

The core work (v2 schema, `upsertStructural` / `upsertProse` / `deleteStructural` / `getFileState` / `checkpointWal`, FTS `contentless_delete=1` migration, scanner, pre-commit pipeline, MCP tool registrations) is logically sound and uses prepared statements throughout. Transactions wrap multi-statement work with proper rollback semantics. FTS delete sites have all been migrated to the direct `DELETE FROM pseudo_fts WHERE rowid = ?` pattern and no stale `'delete'` command sites remain. Imports and handler wiring in `setup.ts` are correct.

The issues found are edge-case correctness problems — none cause data loss and none would crash ordinary usage, but they will produce subtly wrong data in real codebases.

## Important

### I1. Naive `param_count` comma-split breaks on generics/objects/defaults
- **File:** `src/services/pseudo-db.ts:399,423`
- **What:** Both the UPDATE and INSERT branches in `upsertStructural` compute `param_count` as `sm.params.trim() ? sm.params.split(',').length : 0`.
- **Why it matters:** This miscounts any parameter list containing a comma inside a type/default, e.g.:
  - `(a: Record<string, number>, b: number)` → reported as 3 (actual 2)
  - `(opts: { x: 1, y: 2 } = { x: 0, y: 0 })` → reported as 4+
  - `(cb: (a: number, b: number) => void)` → reported as 2
- Any callers that rely on `param_count` (filtering, UI) will see wrong counts. Note the scanner itself stores `param_count` correctly via this same bad split, so it's consistent — but consistently wrong.
- **Fix:** Use a depth-aware comma split that ignores commas inside `<…>`, `(…)`, `{…}`, `[…]`, and string literals. Or compute `param_count` once inside `source-scanner.ts` and add it to `StructuralMethod`, then pass through untouched.

### I2. `upsertProse` matching by name alone picks an arbitrary overload
- **File:** `src/services/pseudo-db.ts:478–481`
- **What:** When `pm.params` is null/undefined, the code does `existingMethods.find(m => m.name === pm.name)`, returning the first match. If the file has overloaded methods (`foo(x)` and `foo(x, y)`), a prose entry without params silently attaches to whichever the scanner listed first.
- **Why it matters:** Prose generated without params will quietly land on the wrong overload and overwrite any steps already attached to it. The new test `matches by name alone when params not provided` exists only in the single-method case, so the regression wouldn't be caught.
- **Fix:** When multiple methods share a name and `pm.params` is absent, either (a) require `params` explicitly (throw), (b) prefer the only method with `step_count = 0`, or (c) log a warning and skip rather than arbitrarily picking the first.

## Minor

### M1. `git add "${dbPath}"` in pre-commit path uses unquoted shell interpolation via execSync
- **Files:** `bin/structural-index.ts:96`, `bin/structural-index-project.ts:85`
- **What:** `execSync(\`git add "${dbPath}"\`, ...)` — the double quotes protect spaces but not backticks, `$`, or embedded double quotes in a project path.
- **Why it matters:** Edge-case only; will break projects at paths containing shell metacharacters. The path is always `<project>/.collab/pseudo/pseudo.db`, so it only breaks if the project root itself contains those characters.
- **Fix:** Use `execFileSync('git', ['add', dbPath], { cwd: projectRoot })` to skip the shell.

### M2. `upsertProse` sets `has_prose = 1` and `prose_updated_at` even when no methods matched
- **File:** `src/services/pseudo-db.ts:455–465`
- **What:** The file-level UPDATE runs before method matching, so if every prose method misses (all names mistyped) the file is still flagged as having prose.
- **Why it matters:** `getFileState` will report `hasProse: true` and the `/pseudocode` skill may skip regeneration despite there being no steps attached.
- **Fix:** Track whether at least one method matched, and only bump `prose_updated_at` / `has_prose` when something actually landed — or at minimum warn if the overall match count is zero.

### M3. `classStack` depth tracking breaks for class body opening brace on its own line in some shapes
- **File:** `src/services/source-scanner.ts:119–124`
- **What:** On matching `class Foo` the code pushes `{ openDepth: braceDepth + 1 }` and then applies the line's brace delta. If the class declaration line has no `{` (K&R-variant with `{` on the next line) the push records `openDepth = 1` but `braceDepth` stays `0`; on the next line the standalone `{` bumps depth to `1`, and the pop check `braceDepth < openDepth` (`1 < 1` false) keeps the class in scope as intended — so this actually works. However, any _subsequent_ class decl on the same outer level with `class Foo {` on one line would compute `openDepth = braceDepth + 1 = 1` again while braceDepth is already 0 before the delta; with the delta it goes to 1 and still matches. OK. Not a bug — verified. Removing from findings.
- (Left in doc for audit trail; see source_scanner tests pass all class cases.)

### M4. Scanner regex `TS_CLASS_METHOD_RE` misses multi-line method signatures
- **File:** `src/services/source-scanner.ts:99`
- **What:** The regex requires `{` on the same line as the method decl (`\s*\{` at the end). Real-world methods often split params across lines:
  ```
  public doThing(
    a: number,
    b: number,
  ): Promise<void> {
  ```
- **Why it matters:** Such methods will be silently missing from Level 1 structural output and therefore won't be listed in the pseudo-db at all. Many TS codebases hit this frequently. Source-link, coverage, and call-graph will under-report.
- **Fix:** Either make the trailing `\{` optional and detect the opening brace with a forward scan, or do a two-line lookahead merge before regex matching.

### M5. `bin/structural-index-project.ts` EXCLUDES list drops `__tests__` unconditionally
- **File:** `bin/structural-index-project.ts:19`
- **What:** Skipping `__tests__` directories means tests are never indexed, even though the structural scanner and `isSupportedExtension` would accept them. If users later call `pseudo_find_function` for a helper used only by tests, they'll get nothing.
- **Why it matters:** Policy choice, not a hard bug — but inconsistent with `src/mcp/setup.ts:3692`'s `pseudo_index_project` handler which ALSO excludes `__tests__`. Both agree, so at least consistent.
- **Fix (optional):** Make test-inclusion a flag on the tool call.

## Verified clean

- FTS5 DDL has `contentless_delete=1` (line 240).
- All FTS delete sites use `DELETE FROM pseudo_fts WHERE rowid = ?` — no `'delete'` command sites remain anywhere.
- `upsertStructural` and `upsertProse` correctly wrap multi-statement work in `db.transaction(() => { ... })`; bun:sqlite rolls back on thrown error.
- `migrate()` uses `INSERT OR REPLACE` for the schema_version row to survive a partial prior migration.
- `deleteStructural` calls `clearFtsForFilePath` before the files-row DELETE, so FTS entries get cleared before ON DELETE CASCADE drops the methods.
- `getFile` JSON-parse handles both string and array shapes for nested `steps_json` / `calls_json` (defensive and correct).
- All user-supplied values flow through prepared statements; no string concatenation SQL.
- All four new MCP tools (`pseudo_index_structural`, `pseudo_index_project`, `pseudo_upsert_prose`, `pseudo_get_file_state`) have matching handler switch cases with correct arg validation and typing.
- `scripts/pre-commit` correctly resolves project root via `git rev-parse --show-toplevel` and exits 0 unconditionally so it never blocks commits.
- `bin/structural-index.ts` catches scanner errors per-file (intentional per spec) and logs to `.collab/pseudo/structural-index.log`; crashes at top level also exit 0.
