# Blueprint — DF5: tests for capture + detectors + triage dedup

## Leaf
- **Todo:** `b43e00d7-8b10-4eef-bd88-3a9875816ed1`
- **Title:** DF5: tests for capture + detectors + triage dedup
- **Epic:** `141e0619` (dogfood-friction broadening: DF1 capture, DF2 detectors, DF3 triage)

## Critical context — most coverage ALREADY EXISTS

The DF1–DF3 leaves added their tests **inline** with the implementation. As of this
blueprint, all four friction suites exist and **pass** (`bun run scripts/test-backend.ts friction` → 4/4):

| File | Covers | DF5 requirement |
|---|---|---|
| `src/services/__tests__/friction-store.test.ts` | operational layer accepted + filtered; `todoId` optional → stores null & round-trips; invalid-layer/empty-reason reject; watch-state KV (null/round-trip/upsert/independent keys/reopen) | DF1 operational capture + optional todoId ✅ |
| `src/services/__tests__/friction-trends.test.ts` | pure `summarizeFrictionTrends`: empty, layer grouping/ranking, recurring>1, null-session exclusion, **operational rolls up + appears in recurring** | DF1 "trends includes operational" — PURE path only ⚠️ |
| `src/services/__tests__/friction-watch.test.ts` | unlanded-epic under→over edge fires once / re-fires after dropping under / under-threshold silent; stale-wt once-per-identity / new-path / reason-change re-fire / branch-in-detail; both detectors independent; throwing detector best-effort | DF2 "threshold-cross only, not every tick" ✅ |
| `src/services/__tests__/friction-triage.test.ts` | threshold gate (</===); layer routing (domain→Bugfix inbox/bug, orchestration+operational→Collab gaps/gap); find-or-create-epic reuse; dedup via injected actioned-Map; markActioned args; cap highest-first; status planned; fail-open | DF3 one-todo-per-reason + actioned-marker + right epic ✅ |

**Therefore the DF5 leaf must NOT re-author the existing tests.** Its real, additive
job is twofold:
1. **Verify** the four suites all pass (the acceptance evidence).
2. **Fill exactly two integration-level gaps** where the *store-backed* wiring (not the
   pure/stubbed core) is currently untested. Both are small, surgical additions to
   existing files — no new files.

## Conventions to follow (from the existing suites — match exactly)
- Runner: **`bun:test`** (`import { describe, it/test, expect, beforeEach, afterEach } from 'bun:test'`).
  Files are picked up by `scripts/test-backend.ts` because they import `bun:test`; it runs
  one process **per file** (shared SQLite state → per-file isolation). No vitest.
- DB-backed tests: per-test temp project dir via `mkdtempSync(join(tmpdir(), 'friction-…-'))`;
  `afterEach` calls `_closeProject(project)` **then** `rmSync(project, { recursive: true, force: true })`.
  `_closeProject` is the exported cache-drop in `friction-store.ts:112`.
- Never assert on wall-clock; use distinct `retryReason`/path strings to disambiguate.

## Gap 1 — store-backed `frictionTrends(project)` includes operational (DF1, end-to-end)

**Why:** `friction-trends.test.ts` only tests the pure `summarizeFrictionTrends(notes[])`.
The store-backed wrapper `frictionTrends(project, opts)` (`src/services/friction-trends.ts:81`)
— which calls `listFriction(project, { layer })` then slices to the cap — has **zero**
coverage. DF1's literal requirement "friction_trends includes operational" should be
proven through the real DB path (record → list → roll up), not just the pure core.

**File to EDIT:** `src/services/__tests__/friction-trends.test.ts`

**Shape:** add imports `recordFriction, _closeProject` from `'../friction-store'` and
`frictionTrends` from `'../friction-trends'`. Add a NEW `describe('frictionTrends (store-backed)')`
block with its own `beforeEach`/`afterEach` temp-project lifecycle (mirror friction-store.test.ts
lines 8–16). The existing pure-`summarizeFrictionTrends` describe block stays untouched (it needs no DB).

Tests to add (use `await recordFriction(project, …)` then call the sync `frictionTrends(project)`):
- **operational notes surface in the store-backed rollup:** record 2× `{layer:'operational', retryReason:'stale-worktree'}` + 1× `{layer:'domain', retryReason:'cad-api-rederived'}`; assert `frictionTrends(project).byLayer` contains an `operational` group with `count===2`, and that `recurring` includes `{layer:'operational', retryReason:'stale-worktree', count:2}`.
- **layer-filter param flows to listFriction:** with the same notes, `frictionTrends(project, { layer:'operational' }).byLayer` has exactly one group (`operational`), `total===2`.
- **limit cap honored:** record 3 notes, call `frictionTrends(project, { limit:2 })`; assert `total===2` (only the newest 2 considered — listFriction is newest-first).

## Gap 2 — triage dedup through the REAL persistent marker (DF3, no-spam across passes)

**Why:** every dedup assertion in `friction-triage.test.ts` injects an in-memory
`actionedKeys` Map for `isActioned`/`markActioned`. The **real** persistence path —
`isReasonActioned`/`markReasonActioned` in `friction-store.ts:211/217`, which store the
`triage:actioned:<layer>:<reason>` marker in `friction_watch_state` inside `friction.db` —
is never exercised by the triage pass. DF3's "respects the actioned-marker (no spam)" is
strongest when proven against the durable store across two passes.

**File to EDIT:** `src/services/__tests__/friction-triage.test.ts`

**Shape:** add a NEW `describe('friction-triage: real-store dedup (integration)')` block.
Reuse `makeTodo` already in the file; add `import { _closeProject } from '../friction-store'`
and ensure `afterEach` also `_closeProject(project)` (the file's current afterEach only
`rmSync`s — add the close so the marker DB handle is dropped between tests). Build deps that
**stub only** `trends`, `listTodos`, `createTodo` (capturing created todos) and **leave
`isActioned`/`markActioned`/`threshold` defaults** so the real `friction.db` marker is used
(pass `threshold` explicitly = 3 to avoid `getConfig`; leave isActioned/markActioned undefined):

- **second pass files nothing (durable no-spam):** with one recurring reason `{domain, missing-model, count:4}`, run `runFrictionTriagePass(project, deps)` twice against the SAME temp project; assert the leaf-todo (parentId != null) count is **1** total across both passes (the real marker persists in friction.db and blocks the re-file).
- **(optional, same block) marker survives a reopen:** after pass 1, `_closeProject(project)`, run pass 2; still only 1 filed — proving the marker is on disk, not just in the cached handle.

Note: keep `createTodo`/`listTodos` stubbed (real `createTodo` would pull in `todo-store`'s
own DB + epic invariants — out of scope for a triage-dedup test). Only the actioned-marker
store is the real seam under test here.

## Acceptance / verification
- `bun run scripts/test-backend.ts friction` → **all friction files pass** (was 4/4; stays 4/4 with the two augmented files).
- New assertions specifically green: store-backed operational rollup, layer-filter, limit cap; durable two-pass triage dedup.
- No new files; no production-code changes (`friction-store.ts`/`friction-trends.ts`/`friction-watch.ts`/`friction-triage.ts` untouched). This leaf is test-only.

## Risks / notes
- `friction-trends.test.ts` currently imports no DB; adding a DB-backed describe is fine — the per-file runner isolates it. Keep the existing pure block first so a pure-only regression is still obvious.
- The triage file's current `afterEach` lacks `_closeProject`; add it so the integration tests don't leak the cached friction.db handle into the next test's fresh temp dir (cache is keyed by project path, so a new mkdtemp path is already distinct — but closing is the established convention in the other suites and avoids WAL file leaks).
- Do NOT touch the `report_dogfood` MCP tool / `friction.ts` MCP wiring — DF5 scope is the service-layer capture/detector/triage units, matching the existing four suites.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/__tests__/friction-trends.test.ts",
    "src/services/__tests__/friction-triage.test.ts"
  ],
  "tasks": [
    { "id": "trends-store-backed", "files": ["src/services/__tests__/friction-trends.test.ts"], "description": "Add DB-backed frictionTrends(project) describe: operational surfaces in rollup+recurring, layer-filter flows, limit cap honored" },
    { "id": "triage-real-store-dedup", "files": ["src/services/__tests__/friction-triage.test.ts"], "description": "Add integration describe using real isReasonActioned/markReasonActioned: two passes file exactly one todo (durable no-spam, survives reopen)" }
  ] }
```
