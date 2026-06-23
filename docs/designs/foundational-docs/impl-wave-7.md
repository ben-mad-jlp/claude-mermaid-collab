# Wave 7 Implementation — Final Cleanup

## Tasks completed
- **retire-v2-tests** — Deleted `src/services/__tests__/pseudo-db.test.ts` in its entirety.
- **consolidate-schema-version** — No additional changes required. The only stale SCHEMA_VERSION literal in the codebase lived inside the deleted test file; all remaining `SCHEMA_VERSION` references (pseudo-schema.ts defines it; pseudo-snapshot.ts and pseudo-status.ts import from it) are correct and centralized.

## Why the retired tests were dead
- Write-path tests (upsertStructural, upsertProse, deleteStructural, checkpointWal round-trips) — dead under V6 shim no-ops.
- Schema-migration tests asserting `schema_version.version = 2` — dead under V6's in-memory empty `schema_version` table.
- Read-path coverage — fully subsumed by Wave 3 test suites (pseudo-query.test.ts, pseudo-resolver.test.ts, pseudo-unification.test.ts, pseudo-migration-rel.test.ts — 53 passing tests).

## Verification
- `tsc --noEmit`: 0 errors (clean build).
- Zero surviving references to `PseudoDbService` in src/.
- `SCHEMA_VERSION` exists in exactly 3 files: `pseudo-schema.ts` (definition, `= 4`), `pseudo-snapshot.ts` (import+usage), `pseudo-status.ts` (import+usage). One source of truth.
- V6 test matrix: 53/53 pass.
- Full suite: 2384 pass / 1851 fail — no new regressions (remaining failures are pre-existing UI/jsdom unrelated to pseudo-db).

## Known non-blocking follow-up
- `vitest.config.ts:16` still lists `src/services/__tests__/pseudo-db.test.ts` in its exclude array. Harmless (excluding a non-existent path is a no-op) but can be cleaned in a small follow-up PR.
