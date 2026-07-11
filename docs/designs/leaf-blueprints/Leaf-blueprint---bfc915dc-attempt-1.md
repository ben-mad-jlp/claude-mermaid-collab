# Blueprint: [Token burn #1] Don't re-run blueprint/implement on a review retry — keep attempt-1 worktree, surgically revise

## Problem
A leaf that needs a 2nd review/revise cycle re-ran the entire pipeline including the blueprint node because the outer ATTEMPT loop in `runLeaf` did `wm.ensure(sessionKey, { fresh: true })` and executed the blueprint branch on each iteration. Blueprint (opus+high) is the single most expensive node (~210k cacheRead, ~$0.55). Measured: ~1.36M cache_read across 2 attempts (7 nodes) vs ~0.36M for 1-attempt (3 nodes) — 4x driven by attempts × steps.

FM2 (90ad6dc1) raised `REVISE_REUSE_CAP` 1→3 to keep near-correct worktree for in-place fixes. This leaf extends/locks the guarantee: the revise path NEVER re-runs blueprint (or implement-from-scratch) on review retry.

## Acceptance
- A leaf that fails review once and passes on revise spends ONE blueprint node, not two.
- Per-leaf `cacheReadTokens` (ledger) for the 2-attempt/wave case drops toward the 1-attempt baseline.
- `getLeafRun(leafId).attempts` (blueprint row count) is 1; node list contains exactly one (or at most two on a blueprint-node !ok in-place retry) `nodeKind==='blueprint'` row(s).
- Review retries are surgical: same `cwd`, only `implement` re-run with findings inlined, bounded by `REVISE_REUSE_CAP` (per-wave) + `ATTEMPT_CAP` (waves) + `NODE_BUDGET`.

## Scope / Non-Goals
- Blueprint-node failure may still short-circuit to a fresh worktree + one replacement blueprint (within `ATTEMPT_CAP`). This is orthogonal to review-retry.
- Waves (P5) and floor share the same guard; no separate code paths for blueprint re-execution on review.
- `ATTEMPT_CAP`/`REVISE_REUSE_CAP` values and the wave interpretation of `state.attempt` after blueprint success are left as-is; only the control topology changes.

## File and Symbols to Touch
Primary file: `src/services/leaf-executor.ts`

Key symbols (exact identifiers and sites):
- `runLeaf` (exported async function at module scope)
- `ATTEMPT_CAP` (const = 2)
- `REVISE_REUSE_CAP` (const = 3, already raised)
- `NODE_BUDGET` (const = 20)
- `state` (local `{ attempt: number; nodesSpent: number }`)
- `leafSessionKey(leaf)` → `sessionKey`
- `deps.wm.ensure(sessionKey, { baseBranch: epicBranch, fresh: true })` — the call that materializes the worktree
- `runNode('blueprint', buildSpec('blueprint', cwd))`
- `runNode('implement', buildSpec('implement', cwd, blueprintBody, findings))` — the only node re-spawned by revise
- `buildSpec`, `buildNodePrompt` (for review/implement with findings)
- `blueprintPath(leaf)`, `blueprintBody`, `cwd`, `rootSnap` (captured once after successful blueprint+build)
- Inner revise loop: `for (;;) { review=runNode('review'...); if (pass) break; ... if (reuses >= REVISE_REUSE_CAP || isRepeat) break; ... fix=runNode('implement', ..., findings); reuses++; }`
- Post-revise decision: `if (reviewVerdict==='pass') { merge+accept+return }`; `if (state.attempt >= ATTEMPT_CAP) return parkBlocked('attempt-cap-exhausted', ...); state.attempt += 1;`
- `persistBlueprint` call site (must be inside the successful blueprint phase only, with `attempt:1`)
- Top-of-function comment block (the three ceilings) and the "ATTEMPT loop" comment
- `planResume` / `reattach-blueprint` path (must only affect attempt==1 of the blueprint phase)

Secondary (for measurement/docs):
- `src/services/ledger-stats.ts` (R2 comment: attempts = count of `nodeKind==='blueprint'` rows; `LeafRunStats` already exposes `cacheReadTokens`/`cacheCreationTokens`)
- Tests in `src/services/__tests__/leaf-executor.test.ts` that assert `ensureCalls.length===1`, `persistCalls.length===1`, `res.attempts` semantics (wave vs blueprint), and 1-blueprint behavior on repeat-finding bail then PASS

## Exact Change Shape (Control-Flow Restructure, No New Primitives)

1. Blueprint acquisition is isolated to a single-entry phase:
   - Use a dedicated bounded loop (e.g., `for (let blueprintRound=0; blueprintRound<ATTEMPT_CAP; blueprintRound++)`) whose body performs at most one `fresh:true` `wm.ensure`, optional reattach, the `runNode('blueprint')`, and the one in-place blueprint retry on `!bp.ok`.
   - On `bp.ok`, fall through to size-gate / persist / auto-split / build (implement or waves), then `break` out of the blueprint phase loop with `cwd`, `blueprintBody`, and `rootSnap` captured.
   - On blueprint failure after the in-place retry: if `state.attempt >= ATTEMPT_CAP` parkBlocked('blueprint-node-failed'); else `continue` (another round with fresh). This is the ONLY path that may execute `wm.ensure(..., {fresh:true})` more than once.
   - After the phase loop, if `!blueprintBody.trim()` → `parkBlocked('blueprint-node-failed')`.

2. Review/revise is a subsequent loop over the SAME captured artifacts and does not touch worktree or blueprint:
   - `state.attempt = 1;`
   - `for (;;) { ... }`
   - Inside: the existing REVIEW + P6 inner revise `for(;;)` using the same `cwd` and `blueprintBody`.
   - Inner break on PASS, on `!checkBudget()`, or on `(reuses >= REVISE_REUSE_CAP || isRepeat)`.
   - Comment the inner break: `// exhausted / stuck → end wave, keep tree`
   - After inner loop: if PASS → mergeToEpic + complete + return (existing).
   - If FAIL: `if (state.attempt >= ATTEMPT_CAP) return parkBlocked('attempt-cap-exhausted', reviewVerdict); state.attempt += 1;` then loop — same `cwd`, no `ensure`, no `blueprint`, only review/implement nodes.

3. Remove or guard any fallthrough/continue from the review-fail path back into the blueprint phase:
   - The post-revise `if (isLastAttempt) ...` that previously allowed the outer ATTEMPT loop to re-enter must not exist or must be unreachable after a successful blueprint.
   - `fresh: true` must not be passed to `wm.ensure` from any review/revise code path.
   - `runNode('blueprint', ...)` must be textually inside the blueprint phase only.

4. Persist and accounting:
   - `persistBlueprint` is invoked at most once per leaf dispatch (hardcode `attempt:1` or pass a phase flag), only on the successful blueprint artifact.
   - `state.attempt` after the blueprint phase represents "review/revise waves", not blueprint count. `LeafRunResult.attempts` carries this wave count for telemetry; ledger-derived `getLeafRun().attempts` remains the authoritative blueprint count for cost analysis.

5. Comments/docs (tighten for the invariant):
   - Module header: change "fresh worktree every attempt" to "one fresh worktree per leaf dispatch (revise keeps it)".
   - Blueprint phase header: "BLUEPRINT ONCE per leaf dispatch (token-burn #1)".
   - Revise loop header: "REVIEW-REVISE waves on the SAME worktree — no second blueprint".
   - Update the `REVISE_REUSE_CAP` JSDoc to state the post-cap behavior is "end wave, keep tree; bounded by ATTEMPT_CAP waves + NODE_BUDGET".
   - `ledger-stats.ts` R2: keep "attempts = count of blueprint rows"; add a note that `LeafRunResult.attempts` may reflect waves after the single blueprint.

6. No changes to:
   - `WorktreeManager.ensure` signature or semantics.
   - `ATTEMPT_CAP`, `REVISE_REUSE_CAP`, `NODE_BUDGET` numeric values (policy only).
   - The in-place blueprint-node-failure retry (still allowed, still counts as at most +1 blueprint node for the same leaf).
   - Waves vs floor dispatch after the single blueprint.

## Data/Measurement Points (No New Columns Required)
Use existing ledger:
- `getLeafRun(leafId)` → `nodes` (filter `nodeKind==='blueprint'`), `attempts` (blueprint count), `cacheReadTokens`, `cacheCreationTokens`.
- `recordNode` already writes `cacheReadTokens`/`cacheCreationTokens` (from `res.usage`).
- A clean 1-blueprint run for a small leaf: 1 'blueprint' row + implement + review (optionally +1 implement on first revise) + review(PASS) → 3–5 nodes, single blueprint cacheRead.

Before/after comparison (same leaf): 2-attempt case cache_read should approach 1-attempt baseline (delta ≈ one less opus-high blueprint cache read).

## Risk / Edge Cases (to Preserve)
- Blueprint node itself fails (non-rate-limited): one in-place retry, then at most one fresh+replacement blueprint within cap. Still at most two blueprint rows total, and only on !ok path before any implement.
- Repeat finding (`isRepeat`): still bails the inner revise; outer wave counter advances on same tree; repeat across waves still hits `ATTEMPT_CAP` and blocks. No re-blueprint.
- Rate limit on any node: `pausedResult` short-circuits before any decision to fresh or blueprint.
- Budget: `checkBudget()` before every node that would do more work; PASS is accepted even if it landed on the budget-tripping node.
- Reattach (`resumePlan`): only on `attempt===1` of the blueprint phase; never during review-revise.
- `persistBlueprint` throws: best-effort, never breaks run (existing).

## Minimal Call-Site Summary (Symbols)
- Change shape is a loop split + break + removal of fresh path from the review-revise tail.
- In `runLeaf` body:
  - Introduce/keep the blueprintRound loop around ensure+blueprint(+1 retry)+build+break.
  - After it: the review-revise `for(;;)` using captured `cwd`/`blueprintBody`.
  - Inner revise break condition and comment updated to "keep tree".
  - No `wm.ensure` or `runNode('blueprint')` after the captured `cwd` is set for review.
- Comments and the three-ceiling header updated to reflect "one worktree; review waves only."

This produces a leaf run whose ledger shows a single blueprint node regardless of how many review→revise iterations occur (until terminal block or PASS).

```json
{ "schemaVersion": 1, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/leaf-executor.ts"],
  "tasks": [ { "id": "guard-blueprint-once", "files": ["src/services/leaf-executor.ts"], "description": "Restructure runLeaf so review/revise never re-runs blueprint or fresh worktree; cite revise loop, REVISE_REUSE_CAP break, post-phase review-revise for(;;), and blueprintRound phase with its break." } ] }
```