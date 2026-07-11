# Blueprint: [Token burn #1] Don't re-run blueprint/implement on a review retry — keep attempt-1 worktree, surgically revise

## Problem Statement (from query + code facts)
A leaf that needs a 2nd attempt currently re-runs blueprint+implement from scratch. Measurement (2026-06-25) showed ~1.36M cache_read across 2 attempts (7 nodes) vs ~0.36M for clean 1-attempt (3 nodes) — 4x driven by attempts × steps.

Blueprint is the dominant cost: opus + high-effort, ~$0.55 / 210k cacheRead.

FM2/90ad6dc1 raised REVISE_REUSE_CAP 1→3 so the in-place revise keeps the near-correct worktree on review FAIL instead of immediately cutting a fresh pipeline. The remaining mandate: **extend/verify the revise loop NEVER re-runs the blueprint node on a review retry**.

Acceptance:
- A leaf that fails review once and passes on revise spends ONE blueprint, not two.
- Per-leaf cache_read for the 2-attempt (review-retry) case drops toward the 1-attempt baseline.
- Measurement via the ledger cache columns (cacheReadTokens / cacheCreationTokens on worker-ledger rows, surfaced by getLeafRun / ledger-stats via #blueprint rows for attempts).

## Root Cause Location
File: [src/services/leaf-executor.ts](/src/services/leaf-executor.ts)

The ATTEMPT loop + revise decision in `runLeaf`:

- `export const ATTEMPT_CAP = 2;` (238)
- `for (state.attempt = 0; state.attempt < ATTEMPT_CAP; ) { state.attempt += 1; ... }` (1557)
- Inside: `const wt = await deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true }); const cwd = wt.path;` (1561) — fresh worktree every outer iteration.
- Blueprint is executed at the top of every attempt iteration (1581 primary, plus 1593 in-place retry on `!bp.ok`).
- The **only** `continue` that can advance the outer loop to iteration 2 (and thus a 2nd blueprint) is at 1599: guarded by `if (!bp.ok) { ... if (isLastAttempt) return ...; continue; // fresh attempt — never implement against a missing blueprint }`
- REVIEW + P6 SURGICAL REUSE (1679 comment block):
  ```ts
  let reviewVerdict: 'pass' | 'fail';
  let reuses = 0;
  let prevFindings = '';
  for (;;) {
    ...
    const review = await runNode('review', buildSpec('review', cwd, blueprintBody));
    ...
    if (reviewVerdict === 'pass') break;
    ...
    const isRepeat = findings !== '' && findings === prevFindings;
    if (reuses >= REVISE_REUSE_CAP || isRepeat) break; // !!!
    reuses += 1;
    ...
    const fix = await runNode('implement', buildSpec('implement', cwd, blueprintBody, findings));
  }
  ```
- After the inner loop (1720):
  ```ts
  if (reviewVerdict === 'pass') { ... merge ... return finishWith(...) }
  // old (pre-fix): if (isLastAttempt) return ...; /* implicit fallthrough to end of for body */
  // new (desired): early terminal return, no re-entry to attempt loop
  return parkBlocked('review-revise-exhausted', reviewVerdict);
  ```
- The `return parkBlocked('attempt-cap-exhausted');` (1772) after the for is now unreachable for review paths.

REVISE_REUSE_CAP definition and contract (250):
```ts
/** P6 surgical reuse: max in-place re-implement passes per leaf run on a missing-logic
 *  review FAIL (a NEW finding). ... Exhaustion or a repeat finding stops revising and
 *  terminates the leaf run (block) on the attempt-1 worktree — never a second blueprint. */
export const REVISE_REUSE_CAP = 3;
```

Current module docstring (13) already states the target invariant:
- ATTEMPT_CAP — blueprint-failure retries only; review paths never consume a second attempt.
- fresh worktree + blueprint per initial dispatch ... review-driven revise retries keep the single worktree after the one blueprint and do not re-run blueprint or the initial implement.

## Waves / Other Paths (for completeness)
- `runWaves` (1199) is invoked after the single blueprint (1667), before the shared leaf REVIEW + revise loop. Per-file fix uses 'fix' nodes, not blueprint. On any park inside waves we return early (1 bp total).
- `runReviewPipeline` / `runVerifyPipeline` hard-set `state.attempt = 1` and do a single `ensure(fresh:true)` with no loop (1385, 1442).
- Resume/reattach (1564): `const reattach = state.attempt === 1 && ...`; only reuses durable plan text on attempt 1; never re-runs the node for a review-retry scenario.
- `planResume` (919) decides modes; 'reattach-blueprint' is the only reuse of prior bp and is attempt-1 only.

## Why 2 Blueprints Happened Before (the token burn)
Old control flow after revise inner loop on FAIL:
```ts
if (reviewVerdict === 'pass') { ... }
if (isLastAttempt) return parkBlocked('attempt-cap-exhausted', reviewVerdict);
// fall off for body → loop condition true (attempt < 2) → iteration 2
//   → ensure({fresh:true}) → runNode('blueprint')  ← 2nd expensive opus node
```
Even with REVISE_REUSE_CAP=3, once inner loop bailed (cap or `isRepeat`), a non-last attempt would re-enter and pay the blueprint again. The "(ii) fail→fail across 2 attempts" and "FM2 repeated still bails to fresh" tests codified this.

## Required Change Shape (precise, surgical)

Target file: `src/services/leaf-executor.ts` (primary and only source change for the decision).

1. **ATTEMPT loop guard (top of runLeaf, ~1555 comment + 1557 for)**:
   - Keep the loop and ATTEMPT_CAP=2 (needed for legitimate blueprint-node-failure recovery: the `continue` at ~1599).
   - Update/keep the comment: "Fresh worktree + blueprint each iteration **only for blueprint-node failure (continue below). Review FAIL never re-enters here.**"
   - No other `continue` or fallthrough may exist after the review phase.

2. **Blueprint sites (unchanged except comments)**:
   - Primary `bp = await runNode('blueprint', buildSpec('blueprint', cwd))` at ~1581 (inside the else of reattach).
   - In-place retry on `!bp.ok` at ~1593 (same cwd, same attempt — this is NOT the review-retry burn).
   - The `if (!bp.ok) { if (isLastAttempt) ...; continue; }` at ~1597-1599 remains the **sole** path that can produce attempts>1 and a 2nd blueprint row.

3. **Revise loop + post-loop decision (the "reuse cap / fresh-worktree decision") ~1686-1768**:
   - Inner loop must remain exactly as-is for surgical in-place remediation:
     - Runs on the **same `cwd`** (the attempt-1 worktree).
     - Only ever spawns 'review' then 'implement' (with findings) on FAIL.
     - Breaks on `reuses >= REVISE_REUSE_CAP || isRepeat`.
   - After the `for(;;)` (post-1719):
     ```ts
     if (reviewVerdict === 'pass') {
       ... mergeToEpic + complete + return finishWith(...)
     }
     // MUST be an unconditional early return for every review-driven non-pass exit.
     // This is the critical "fresh-worktree decision" site.
     return parkBlocked('review-revise-exhausted', reviewVerdict);
     // No `if (isLastAttempt)`, no fallthrough, no `continue`.
     ```
   - Remove or leave-dead any logic that previously advanced the outer attempt counter or let execution reach the end of the for-body on review FAIL.
   - The `return parkBlocked('attempt-cap-exhausted');` (1772) after the for-loop becomes truly unreachable for review paths (can stay for totality or be removed; blueprint failure path never falls through to it either because of its own returns).

4. **REVISE_REUSE_CAP jsdoc (~250)**:
   - Already states the contract ("terminates the leaf run (block) on the attempt-1 worktree — never a second blueprint"). Keep / make consistent.

5. **Module docstring (~1-29)**:
   - Already claims the invariant. Ensure it does not regress (e.g., the three ceilings list).

6. **No other mutations in this file**:
   - `blueprintPath`, `buildNodePrompt`, `buildSpec`, `parseVerdict`, `parkBlocked`, `finishWith`, `runNode`, `checkBudget`, `mergeToEpic` etc. are used as-is.
   - Waves fallthrough to the shared review+revise (correct: 1 bp).
   - The in-place blueprint retry on !ok is intentional and same-attempt.

## Test File Impact (behavioral assertions must match new contract)
File: `src/services/__tests__/leaf-executor.test.ts`

- "(ii) fail→fail across 2 attempts" (290): currently asserts `reason: 'attempt-cap-exhausted'`, `attempts: 2`, `nodesSpent: 10`, `ensureCalls.length: 2`. With the fix this scripted repeat-finding case terminates after the revise loop on the first (only) worktree: `attempts: 1`, `ensureCalls.length: 1`, `reason: 'review-revise-exhausted'`, lower nodesSpent (blueprint + impl + review + up to REVISE_REUSE_CAP*(impl+review) but still 1 bp).
- "FM2: a REPEATED review finding still bails to a fresh attempt (stuck guard intact)" (447): rename or rewrite expectation. The stuck guard (`isRepeat`) remains (breaks revise loop to avoid infinite spend), but consequence changes from "fresh attempt (new bp)" to "block on attempt-1 tree". Update the comment and `expect(spies.ensureCalls.length).toBeGreaterThan(1)` → `=== 1`.
- "FM2: fixes in place across multiple distinct..." (420) should continue to pass (1 attempt, 1 ensure) — this is the happy revise path.
- Any test that supplies `reviewVerdicts` that produce FAILs and then asserts `attempts===2` or inspects for second blueprint must be updated.
- Blueprint-failure recovery tests (using `blueprintFails` seam) must keep expecting >1 attempt / 2 blueprints — they are the only legitimate 2-bp case.

Other files that may reference the old numbers (for docs/measurement examples) but are secondary:
- `src/services/__tests__/ledger-stats.test.ts` (the "A 2-attempt run: 2 blueprints" test constructs synthetic rows; it documents the counting rule `attempts = count of blueprint rows` and can stay as a "what a true 2-bp bp-fail run looks like" example, or be annotated).

## Ledger / Measurement (no schema change required)
- `src/services/worker-ledger.ts`: `cacheReadTokens`, `cacheCreationTokens` (32, 37) and the insert already exist (migration 143-146). The node rows for 'blueprint' (opus) will carry the high cache_read cost.
- `src/services/ledger-stats.ts`: `attempts` is defined as "count of `nodeKind==='blueprint'` rows" (17). After the fix, review-retry leaves will have attempts===1 even when they required multiple review/implement cycles.
- `getLeafRun` will surface the drop naturally.

Run `npm run test:ci -- src/services/__tests__/leaf-executor.test.ts` (and ledger-stats) post-change to confirm.

## Invariant to Enforce (for the implementer to verify)
- In any execution of `runLeaf`:
  - Number of times `runNode('blueprint', ...)` is called <= 2.
  - 2 is possible **only** via the bp-fail `continue` path (two failed blueprint nodes inside one or two iterations, for recovery).
  - Any path that reaches the review node (floor) or falls out of `runWaves` (waves) does so after exactly one blueprint node for that leaf dispatch, on the first worktree cut in the attempt loop (or the single ensure in review/verify pipelines).
  - `state.attempt` observed at terminal for review-driven outcomes is always 1 (except the bp-fail recovery which is a different failure mode).
- The revise loop body only ever emits 'review' and 'implement' (or waves equivalents) nodes.

## Non-Changes (out of scope for this leaf)
- Do not alter NODE_BUDGET, WAVES budgets, or per-node budgets.
- Do not change the inner surgical loop limit (REVISE_REUSE_CAP stays 3; it already bounds spend).
- Do not touch resume re-attach logic (it correctly reuses only on attempt===1 for a prior bp success).
- Do not change worktree-manager or ensure semantics.
- The 'attempt-cap-exhausted' reason remains possible only for the bp-fail double-failure on last attempt.

## Size Manifest (will be appended verbatim by the blueprint node)

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/leaf-executor.ts", "src/services/__tests__/leaf-executor.test.ts"],
  "tasks": [
    { "id": "tighten-attempt-loop", "files": ["src/services/leaf-executor.ts"], "description": "Ensure outer for-loop + fresh ensure + blueprint spawn only re-entered via bp-fail continue; review paths always return inside first iteration." },
    { "id": "revise-exit-is-return", "files": ["src/services/leaf-executor.ts"], "description": "After revise for(;;) on FAIL (cap or isRepeat), unconditionally return parkBlocked('review-revise-exhausted') with no fallthrough or isLastAttempt fresh logic." },
    { "id": "sync-comments-and-docs", "files": ["src/services/leaf-executor.ts"], "description": "Align ATTEMPT loop header, revise comments, REVISE_REUSE_CAP jsdoc, module docstring with 'one blueprint for review retries' contract." },
    { "id": "update-review-fail-tests", "files": ["src/services/__tests__/leaf-executor.test.ts"], "description": "Fix assertions in repeated-finding / 2-attempt review cases to expect attempts=1, ensureCalls=1, review-revise-exhausted (stuck guard still prevents unbounded revise, but no new blueprint)." }
  ] }
```