# Wave 3 Implementation — Test Coverage

## Tasks completed
- **pseudo-resolver-test** — `src/services/__tests__/pseudo-resolver.test.ts` (7 tests)
- **pseudo-query-test** — `src/services/__tests__/pseudo-query.test.ts` (15 tests, 156 expect calls)
- **prose-migration-test** — `src/services/__tests__/pseudo-migration-rel.test.ts` (16 tests, 51 expect calls)
- **pseudo-unification-regression-test** — `src/services/__tests__/pseudo-unification.test.ts` (15 tests, 26 expect calls)

## Bug discovered and fixed
The resolver test exposed a real incremental-rescan bug: when a method was renamed, the ON DELETE SET NULL cascade nulled `callee_method_id` on inbound edges in other files, but their stale `resolution_quality` was never reset because the scoped reset UPDATE only touched rows whose caller lived in `scopeFiles`.

**Fix applied to `src/services/pseudo-resolver.ts`:** Prepended an unscoped NULL-cleanup UPDATE at the top of `resolveCallEdges` that always resets `resolution_quality='unresolved'` where `callee_method_id IS NULL AND resolution_quality NOT IN ('ambiguous', 'unresolved')`. The existing scope-filtered reset and round-updates remain unchanged.

## Verification
- 53 tests pass / 0 fail / 262 expect() calls across all 4 wave files
- `tsc --noEmit` reports no errors in any of the wave files or the patched resolver
- Non-fatal `writeSnapshot ON CONFLICT` warnings observed during pseudo-query tests — pre-existing, swallowed by indexer, flagged for follow-up outside this wave

## Follow-up notes
Snapshot writer occasionally logs `SQLiteError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` from `src/services/pseudo-snapshot.ts:57`. Non-blocking but worth investigating after unification ships.
