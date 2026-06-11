# Vibe: snippet-enhancement

## Goal
Build the "Code Artifact" feature and expand it with Phase 1-6 enhancements.

## Context
- Phase 1-5 all shipped and committed (8b421a9 → 010bd15)
- v5.56.0 tag pushed
- Phase 6 design doc: `design-pseudo-db-two-levels` (locked in)
- Phase 6 blueprint: `bp-phase6-pseudo-db-sqlite-only`

## Currently Doing
- Phase 6 execution complete — all 10 tasks across 3 waves done.
- Wave 1: db-overhaul-v2, source-scanner-lib, gitignore-and-pseudo-cleanup ✓
- Wave 2: db-tests-rewrite, pseudo-api-update, mcp-tools-update, bin-structural-index-clis ✓
  - Mid-wave: FTS5 contentless-table bug in pseudo-db.ts surfaced by 3 agents. Fixed by adding `contentless_delete=1` to the `pseudo_fts` DDL and replacing `'delete'` commands with plain `DELETE FROM pseudo_fts WHERE rowid = ?`. Also fixed schema_version insert on v0→v2 migration.
  - Smoke test: `bun bin/structural-index-project.ts` indexed 397 files / 1473 methods / 0 errors.
- Wave 3: delete-pseudo-parser, pre-commit-hook, skill-rewrite ✓
  - 32/32 pseudo-db tests pass; pseudo-api `exports > stepSummary` passes
  - SKILL.md 268 → 50 lines

## Follow-up flags (not in Phase 6 scope, need decisions)
1. `.claude/settings.json:18` PostToolUse hook references deleted `scripts/pseudo-hook-check.sh` — dangling. Wire it to `scripts/pre-commit` via a git commit trigger or remove.
2. `scratch/test-pseudo.ts` untracked, imports deleted `parsePseudo` — safe to delete.
3. `.gitignore:10` has stale `.pseudo-needs-update` entry.
4. `pseudo-db.test.ts` uses `bun:test` imports, can't run under vitest. Pre-existing runner mismatch.

## Next step
Run /vibe-review to run the parallel bug + completeness review across all Phase 6 changes before committing.
