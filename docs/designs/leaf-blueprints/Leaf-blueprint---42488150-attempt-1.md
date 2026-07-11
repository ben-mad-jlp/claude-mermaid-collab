# Blueprint — Blueprint node re-runs on pause/resume instead of resuming from checkpoint (1.8M-token re-burn loop)

## Problem (root cause, confirmed in code)

When a leaf pauses on the rate cap **during or after the blueprint node** and is re-claimed, the new dispatch re-executes the blueprint node from scratch instead of reusing the durable blueprint output. This is the subscription-quota sink (leaf `12fbf68f` ran blueprint twice; attempt-2 burned ~750k cache-read tokens to re-emit a blueprint that already existed).

The decision lives in `planResume()` in `src/services/leaf-executor.ts`:

```ts
// src/services/leaf-executor.ts ~924
export function planResume(resume, currentEpicSha): ResumePlan {
  if (!resume) return { mode: 'fresh', reason: 'no-resume-state' };
  if (resume.merged) return { mode: 'skip-to-gate', reason: 'work-merged' };
  if (!resume.phase || resume.phase === 'blueprint')
    return { mode: 'fresh', reason: 'killed-before-blueprint' };   // <-- BUG
  if (!resume.epicBaseSha || !currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
  if (resume.epicBaseSha !== currentEpicSha) return { mode: 'fresh', reason: 'epic-base-moved' };
  return { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
}
```

`persistResume({phase: kind})` is called at the **start** of `runNode` (leaf-executor.ts ~1017), *before* the spawn. So while the blueprint node is running (and when it rate-pauses at line ~1631, `if (bp.rateLimited) return pausedResult('blueprint', bp)`), the durable `leaf_resume.phase` is `'blueprint'`. On re-claim, `planResume` hits the `phase === 'blueprint'` branch and returns `fresh` → the blueprint node re-runs unconditionally — **even though the completed blueprint's output was already durably recorded** to `worker_ledger` (recordNode runs at the end of `runNode`, ~1051, persisting `outputText: res.text`).

The reattach machinery already exists and is correct: `restoreBlueprint: (leafId) => getLatestNodeOutput(leafId, 'blueprint')` (~1957) and the consume path at ~1619-1633 (`reattach = state.attempt === 1 && deps.resumePlan?.mode === 'reattach-blueprint'`, writes the restored plan to the fresh worktree, sets a synthetic `bp` result, **spends no node**). The *only* gap is that `planResume` refuses to choose `reattach-blueprint` when `phase === 'blueprint'`, regardless of whether a durable blueprint output actually exists.

The re-dispatch path is verified to flow through `planResume`: coordinator-live.ts ~1881 calls `runLeaf(project, todo, await makeLeafExecutorDeps(...))`, and `makeLeafExecutorDeps` (~1912-1913) computes `existingResume = getLeafResume(...)` then `resumePlan = planResume(existingResume, epicBaseSha)`. So the fix is localized to `planResume` + its single production caller.

## Fix shape

Discriminate "blueprint never produced usable output" (genuinely fresh) from "blueprint completed but the leaf paused" (reusable) by feeding `planResume` a `hasBlueprintOutput` fact derived from the durable ledger. Keep `planResume` pure (no DB) — the caller supplies the boolean.

### Change 1 — `planResume` signature + logic (`src/services/leaf-executor.ts` ~903-934)

- Add a third param `hasBlueprintOutput: boolean = false` (default false preserves all existing call sites / tests that pass two args and expect `killed-before-blueprint`).
- The `phase === 'blueprint'` (or null phase) branch returns `fresh / killed-before-blueprint` **only when `!hasBlueprintOutput`**. When a durable blueprint output exists, fall through to the epic-base guards (so a moved base still forces `fresh`), ending at `reattach-blueprint`.

New body:

```ts
export function planResume(
  resume: { phase?: string | null; merged: boolean; epicBaseSha?: string | null } | null,
  currentEpicSha: string | null,
  hasBlueprintOutput = false,
): ResumePlan {
  if (!resume) return { mode: 'fresh', reason: 'no-resume-state' };
  if (resume.merged) return { mode: 'skip-to-gate', reason: 'work-merged' };
  // Paused/killed at-or-before the blueprint node. If a COMPLETED blueprint was
  // durably recorded (the leaf rate-paused after authoring it), reuse it instead of
  // re-burning the ~opus blueprint node — the 1.8M-token re-burn loop. Only treat as
  // genuinely fresh when no usable blueprint output exists.
  if ((!resume.phase || resume.phase === 'blueprint') && !hasBlueprintOutput)
    return { mode: 'fresh', reason: 'killed-before-blueprint' };
  if (!resume.epicBaseSha || !currentEpicSha) return { mode: 'fresh', reason: 'no-epic-base' };
  if (resume.epicBaseSha !== currentEpicSha) return { mode: 'fresh', reason: 'epic-base-moved' };
  return { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
}
```

Also update the doc comment (~906-923) to note the blueprint-phase case now reattaches when a durable blueprint output exists for the unchanged base.

### Change 2 — production caller (`makeLeafExecutorDeps`, `src/services/leaf-executor.ts` ~1912-1913)

`getLatestNodeOutput` is already imported (line 37). Compute the fact and pass it:

```ts
const existingResume = getLeafResume(project, leaf.id);
// A durable blueprint output (recorded by a prior dispatch's blueprint node) means a
// blueprint-phase pause is REUSABLE, not fresh — avoid re-running the blueprint node.
const hasBlueprintOutput = !!getLatestNodeOutput(leaf.id, 'blueprint')?.trim();
const resumePlan = planResume(existingResume, epicBaseSha, hasBlueprintOutput);
```

No other caller of `planResume` exists in production; tests call it directly (the default param keeps them green). The existing `restoreBlueprint`/reattach consume path needs **no change** — once `resumePlan.mode === 'reattach-blueprint'`, the attempt-1 reattach branch (~1619-1626) already restores via `getLatestNodeOutput(leafId,'blueprint')` and spends no node.

### Why this is safe

- A blueprint that rate-paused *before* authoring anything records empty/null `outputText` → `hasBlueprintOutput` false → `fresh` (unchanged behavior).
- A blueprint that completed then paused records full text → reattach, but **still guarded by the epic-base checks** (`no-epic-base` / `epic-base-moved`), so a moved world never reuses a stale plan (Grok's #1 risk preserved).
- The fresh worktree is still created fresh (`wm.ensure({fresh:true})`); only the *plan text* is reused, never partial implementation.

## Regression test (`src/services/__tests__/leaf-executor.test.ts`)

Two additions, both in the existing `describe('planResume ...)` block (~193) — pure, no DB/git needed:

1. **The bug, as a unit test** — blueprint-phase pause WITH a durable blueprint output reattaches:
```ts
it('blueprint phase + durable blueprint output + base unchanged → reattach (no re-burn)', () => {
  expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: SHA }, SHA, true))
    .toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable' });
});
it('blueprint phase + durable output but base moved → fresh (never reuse a stale plan)', () => {
  expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: 'old' }, SHA, true).reason)
    .toBe('epic-base-moved');
});
it('blueprint phase + NO durable output → still fresh (killed-before-blueprint)', () => {
  expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: SHA }, SHA, false).reason)
    .toBe('killed-before-blueprint');
});
```
   The existing two-arg `killed-before-blueprint` assertions (~203-204) stay valid via the default param.

2. **Dispatch-path regression** — assert the resumed reattach dispatch does NOT increment blueprint `nodesSpent`. Reuse the existing `runLeaf` resume-consumption harness (`describe('runLeaf resume consumption (slice 2)')` ~1450, and the test deps factory used there + in `describe('deprecatePriorAttempts ...)` / size-gate tests). Set `deps.resumePlan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' }` and `deps.restoreBlueprint = () => '<prior blueprint md with trailing json manifest>'`, stub the invoker so the blueprint kind would throw/flag if invoked, run `runLeaf`, and assert: (a) the blueprint invoker was never called, (b) the result's `nodesSpent` reflects only implement/review (blueprint node not counted). Model it on the existing reattach-style tests already present near ~1450-1530.

## Files

- **Edit** `src/services/leaf-executor.ts` — `planResume` signature/logic + doc comment; `makeLeafExecutorDeps` caller passes `hasBlueprintOutput`.
- **Edit** `src/services/__tests__/leaf-executor.test.ts` — add planResume unit cases + a runLeaf reattach dispatch regression.

## Acceptance

- `planResume(phase:'blueprint', base unchanged, hasBlueprintOutput:true)` → `reattach-blueprint`.
- A paused+re-claimed leaf with a durable blueprint shows blueprint `nodesSpent` NOT incremented on resume (reattach spends no node).
- Existing planResume two-arg tests stay green (default param).
- `npm run test:ci -- src/services/__tests__/leaf-executor.test.ts` passes.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/leaf-executor.ts", "src/services/__tests__/leaf-executor.test.ts"],
  "tasks": [
    { "id": "planresume-reattach-on-blueprint-output", "files": ["src/services/leaf-executor.ts"], "description": "Add hasBlueprintOutput param to planResume; blueprint-phase pause reattaches when a durable blueprint output exists for the unchanged epic base; caller (makeLeafExecutorDeps) derives the fact via getLatestNodeOutput and passes it." },
    { "id": "regression-tests", "files": ["src/services/__tests__/leaf-executor.test.ts"], "description": "Unit tests for planResume blueprint-output cases + runLeaf reattach dispatch regression asserting blueprint nodesSpent not incremented on resume." }
  ] }
```
