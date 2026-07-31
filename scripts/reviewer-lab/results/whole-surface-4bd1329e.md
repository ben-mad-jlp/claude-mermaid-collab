# Whole-surface branch-vs-master failing-test NAME sets + tsc record

Base: master tip `8c231403` (== `git log master..HEAD` shows exactly one FI-merge commit, `869be039`).
Command: `bun run scripts/test-backend.ts` (branch tree, and a disposable `git worktree add --detach /tmp/master-whole-surface master` with `node_modules` and `desktop/node_modules` symlinked from this tree — no reinstall).

## Branch failing tests
- WorktreeManager — per-project worktree mutex (6bc2dc36) > serialises concurrent mutating calls (git spawns never overlap)
- handleOrchestratorRoutes — node-profiles > GET returns a row per node kind with defaults + choice lists
- POST /api/supervisor/approve-push > injects a stamped approval/proceed message and returns ok
- findLandedAtDivergence — live-store sweep > 5 fixture shapes created for real → zero divergence
- gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > Class (b): baseline-present failure (not net-new) → PASSED (inherited)
- runLandedEpicSweep: approval gate > an unapproved queued mission is never promoted and stays inactive
- runSweepMeasurement > composes promotion, landed-at divergence, GC, and queue-starvation over a seeded fixture, and is idempotent on replay

## Master failing tests
- WorktreeManager — per-project worktree mutex (6bc2dc36) > serialises concurrent mutating calls (git spawns never overlap)
- handleOrchestratorRoutes — node-profiles > GET returns a row per node kind with defaults + choice lists
- POST /api/supervisor/approve-push > injects a stamped approval/proceed message and returns ok
- findLandedAtDivergence — live-store sweep > 5 fixture shapes created for real → zero divergence
- gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared > Class (b): baseline-present failure (not net-new) → PASSED (inherited)
- runLandedEpicSweep: approval gate > an unapproved queued mission is never promoted and stays inactive
- runSweepMeasurement > composes promotion, landed-at divergence, GC, and queue-starvation over a seeded fixture, and is idempotent on replay

All 7 branch failing-test names are present in the master set at the same base — this is
pre-existing test-debt (matches memory: `backend_preexisting_failures`, 11 red files tracked
as test-debt), not a regression introduced by this branch. Set difference:

branch \ master = ∅

## tsc

`npx tsc --noEmit -p tsconfig.json` on the branch tree:

tsc --noEmit exit 0
