# Whole-suite branch-vs-master failing-test-NAME diff — leaf 322b986a

## Base commit

`git merge-base HEAD master` = `8a0f38a96ffcc01478421adf92626fb7b9c1b2e5` (identical to `master`'s
current tip — this branch is a single forward-integrate commit ahead of `master`, with no
divergent history).

Commands run:

Branch (this checkout, `HEAD` = `088f85f16bd9691960e1c014ea0fe887092eb2fb`):

```
bun run scripts/test-backend.ts
```

Master, in a disposable `/tmp` worktree checked out at `BASE`
(`git worktree add --detach /tmp/master-baseline-322b986a 8a0f38a96ffcc01478421adf92626fb7b9c1b2e5`,
with `node_modules` and `desktop/node_modules` symlinked in from this checkout):

```
bun run scripts/test-backend.ts --write-baseline=/tmp/master-baseline-322b986a.json
```

Branch, diffed against that fresh master baseline:

```
bun run scripts/test-backend.ts --baseline=/tmp/master-baseline-322b986a.json
```

(desktop typecheck gate passed on both runs: `✓ desktop typecheck passed`.)

## Branch failing test names

7 files failed, 14 failing test names total (extracted via `extractFailingTests`, same as
`--write-baseline` uses):

- `src/agent/__tests__/worktree-concurrency-lock.test.ts`
  - `WorktreeManager — per-project worktree mutex (6bc2dc36) > serialises concurrent mutating calls (git spawns never overlap)`
- `src/routes/__tests__/orchestrator-routes.test.ts`
  - `handleOrchestratorRoutes — node-profiles > GET returns a row per node kind with defaults + choice lists`
- `src/routes/__tests__/supervisor-approve-push.test.ts`
  - `POST /api/supervisor/approve-push > injects a stamped approval/proceed message and returns ok`
- `src/services/__tests__/epic-landed-at-equivalence.test.ts`
  - `findLandedAtDivergence — fixture-based bidirectional equivalence > divergent: epic has landedAt set but no done land-leaf child → flagged`
  - `findLandedAtDivergence — live-store sweep > 5 fixture shapes created for real → zero divergence`
- `src/services/__tests__/gate-runner-land-parity.test.ts`
  - `gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > impactedSuiteGatePlugin.appliesTo returns true when test lanes exist`
  - `gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > plugin with no test lanes in change-set → passed (abstain)`
  - `gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > Class (b): impactedSuiteGatePlugin runs when test lanes declared and change-set empty`
  - `gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > Class (b): net-new failing test in impacted consumer spec → REJECTED`
  - `gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > Class (b): baseline-present failure (not net-new) → PASSED (inherited)`
- `src/services/__tests__/landed-epic-sweep-same-pass-activation.test.ts`
  - `runLandedEpicSweep: same-pass mission activation > a queued approved mission is promoted and active within one sweep call`
  - `runLandedEpicSweep: two-run idempotence > second sweep pass is a no-op and the landed-at divergence check stays clean`
  - `runLandedEpicSweep: approval gate > an unapproved queued mission is never promoted and stays inactive`
- `src/services/__tests__/sweep-measurement.test.ts`
  - `runSweepMeasurement > composes promotion, landed-at divergence, GC, and queue-starvation over a seeded fixture, and is idempotent on replay`

(434/441 files passed; raw run log: `/tmp/branch-test-output-322b986a.log` / structured extraction:
`/tmp/branch-baseline-322b986a.json`.)

## Master failing test names (at BASE)

Same 7 files, same 14 failing test names, byte-for-byte identical to the branch list above
(structured extraction: `/tmp/master-baseline-322b986a.json`, raw run log:
`/tmp/master-test-output-322b986a.log`; 434/441 files passed). This is the known, pre-existing
backend test-debt set (11 red files project-wide is the historical ceiling; 7 of those live
under the bun-suite scope run here).

## Branch-introduced difference

Running `bun run scripts/test-backend.ts --baseline=/tmp/master-baseline-322b986a.json` on the
branch produced **zero** `new file(s) FAILED` and **zero** `baselined file(s) gained failing
test(s)` sections (`netNew.length === 0`, `countGrowth.length === 0`), and exited `0`.

Computed set per step 6 — union of `netNew`'s failing names with every `countGrowth[].newNames`:
`(branch failing names) − (master failing names) = ∅` (the empty set). No fix was required; no
fix commit was made.
