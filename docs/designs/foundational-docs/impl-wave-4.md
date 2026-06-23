# Wave 4 Implementation — PseudoDbV6Shim

## Task completed
- **pseudo-db-shim** — rewrote `getPseudoDb(project)` in `src/services/pseudo-db.ts` to return a new `PseudoDbV6Shim` class backed by `initPseudoDbV6` + `pseudo-query.ts`.

## What changed
- Added `import * as pseudoQuery from './pseudo-query.js';`
- Removed the old V2 `const instances = new Map<string, PseudoDbService>();` memoization map.
- Added `shimInstances` map + 4 warn-once flags + `class PseudoDbV6Shim`.
- Rewrote `getPseudoDb(project)` to return a per-project memoized shim.
- V2 `PseudoDbService` class (lines ~283-1119) LEFT UNTOUCHED — Wave 6 retires it.

## Shim method surface (1-to-1 with V2)

**Read paths (delegate to pseudo-query.ts):** listFiles, getFile, getFileByStem, search, getCallGraph, getFilesByDirectory, getImpactAnalysis, getStats, getCoverage (with directory override), getSourceLink, getFunctionsForSource.

**Read paths (signature-preserving adapters, direct V6 SQL):** getReferences (remaps fields), getExports (joins file_path + method_steps), getOrphanFunctions (direct join), getMethodLocation (queries by filePath+name), getFileState (wraps getFile + degraded fields).

**Degraded to no-op/empty (per degradation ledger):**
- `upsertStructural`, `upsertProse`, `deleteStructural`, `checkpointWal` → warn-once + return (Wave 5 reroutes the MCP tool callers to the V6 indexer directly).
- `getStaleFunctions` → returns `[]` (V6 has no `methods.date`; feature retired).
- `getFileState.sourceHash`, `scannedAt`, `proseUpdatedAt` → `null` (not tracked by V6 schema).

**Lifecycle:** `close()` removes self from `shimInstances` map and fires `handle.dispose()` fire-and-forget (V2's sync `close()` signature preserved).

## Verification
- `tsc --noEmit`: 0 new errors. Clean build.
- `bun test` scoped backend: 498/546 pass.
  - Wave-affected test suites: **37/37 pass** (pseudo-query.test.ts, pseudo-resolver.test.ts, pseudo-unification.test.ts).
  - **25 failures in `pseudo-db.test.ts` are V2-era expected** — they test write round-trips (upsertStructural → getFile) that the shim now no-ops. Blueprint Wave 3 Step C noted these as a follow-up; not a wave blocker.
  - 1 pre-existing `pseudo-integration.multiplatform.test.ts` snapshot-write failure, verified on HEAD before this wave.
- `const instances = new Map` fully removed from pseudo-db.ts (only `shimInstances` remains).

## Known follow-ups (deferred out of wave)
- V2-era pseudo-db.test.ts suite will be retired in Wave 7 (`retire-v2-tests`).
- writeSnapshot ON CONFLICT warning — unchanged, pre-existing.
