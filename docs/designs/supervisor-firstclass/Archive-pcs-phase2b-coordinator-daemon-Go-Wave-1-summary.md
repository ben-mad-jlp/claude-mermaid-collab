# Wave 1 Implementation — PCS Phase 2b (coordinator daemon core)

## Task
- **coordinator-daemon** (`src/services/coordinator-daemon.ts`, NEW): `CoordinatorDeps` (DI seam: listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, launchWorker), `COORDINATOR_ID`, `DEFAULT_LEASE_MS`. `runTick(deps, project, now?, leaseMs?)` → reclaim expired leases, then claim each ready todo + launchWorker; per-todo try/catch so one bad todo can't abort the tick; failed/false launch leaves the todo leased → reclaimed+retried by a future tick. `handleWorkerComplete(deps, project, todoId, acceptance)` → routes to completeTodo (done + unblock). Pure orchestration — only imports the `Todo` type. +9 bun tests (claim+spawn, claim-null race skip, launch-false, launch-throw isolation, released surfaced, handleWorkerComplete forwards).

## Verification
- tsc clean (exit 0); `bun test coordinator-daemon.test.ts` → 9 pass.

## Deferred to Phase 2c (integration)
Real `launchWorker` via launchAndBind + chosen agent profile; the tick scheduler (interval / event-wake); worker-completion reporting (worker calls completeTodo via MCP after its mechanical acceptance gate runs tsc+tests); wiring CoordinatorDeps from the real todo-store fns + registering the per-project daemon.

## Wave TSC
clean.
