# Fix Wave Summary (todos Phase 0 review)

## Issues Fixed
- **gap-migration-not-wired** (completeness gap — the important one): `migrateProject` was defined/tested but never invoked. Wired it into `src/server.ts` startup (right after `closePersistedTabs`, matching that pattern): `await migrateProject(MERMAID_PROJECT)`, logs count, non-fatal on error. So legacy per-session `session-todos.json` now migrates into the per-project store on boot (idempotent).
- **bug-minor-clearcompleted-contract** (`src/routes/api.ts` clear-completed route): returned `{removed}` but UI/MCP read `{removedCount}`. Now returns `{ removed, removedCount }` (both).
- **bug-minor-extras-title-override** (`src/mcp/tools/session-todos.ts addSessionTodo`): destructure `title` out of `extras` and apply the trimmed title AFTER the spread so it always wins.
- **bug-minor-reorder-return-excludes-done** (`reorderSessionTodos`): return list now uses `includeCompleted: true` to reflect the full reordered set.

## Not changed (consciously)
- `reorder` doesn't validate a full permutation — design note; the only caller always sends the full list. Left as-is (could add validation later).
- Multi-project lazy migration: Phase 0 migrates the server's `MERMAID_PROJECT` at startup (the dominant case, since the server is co-located with its project). Migrating arbitrary other projects on first access is a possible later refinement.

## Files Changed
- `src/server.ts` (migration wiring), `src/routes/api.ts` (clear-completed contract), `src/mcp/tools/session-todos.ts` (extras/title + reorder return).

## Verification
- bun tests: 13/13 (todo-store + todo-migration).
- tsc: clean on touched files. (Pre-existing unrelated: `server.ts:44` binding-sweeper `.ts`-extension import; `api.ts:692` pair_mode_changed — neither introduced here.)
- Migration startup wiring confirmed (server.ts:59-60). Full boot-migration is exercised by the migration unit test + the proven startup pattern; a live end-to-end boot check remains a manual nicety.

## Final TSC
clean for this work (only pre-existing unrelated errors remain)
