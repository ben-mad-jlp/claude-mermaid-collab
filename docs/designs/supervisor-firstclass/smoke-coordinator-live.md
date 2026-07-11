# PCS Phase 2c — Live Coordinator Smoke Test

**Script:** `scripts/smoke-coordinator-live.ts` — run with `bun run scripts/smoke-coordinator-live.ts`

A controlled live integration test for the coordinator path the unit tests skip: it spawns a **real `claude` tmux worker** against a throwaway temp project, then cleans up.

## What it verifies (13/13 ✅)

1. **Seed** — `ready` root todo + `blocked` dependent (depends on root).
2. **Spawn** — `startCoordinator(project, 2s)` ticks → `claimTodo` flips root → `in_progress`, `claimedBy=coordinator`; `launchWorker` launches a **real tmux `claude`** session and binds `sessionName=worker-<id8>`. Confirms the tmux session is actually live (`tmux ls`).
3. **Lifecycle** — second `startCoordinator` returns `false` (idempotent); `stopCoordinator` halts the loop before a second worker can spawn.
4. **Completion** — `handleWorkerComplete(..., 'accepted')` marks root `done` and **promotes** the dependent `blocked → ready`.
5. **Cleanup** — kills the worker tmux session, removes the temp project, leaves pre-existing sessions untouched.

## Scope / honest gaps

This proves coordinator **mechanics + the real spawn/bind path**. It does **NOT** yet prove:
- The worker autonomously *does* its todo — needs `invokeSkill` wiring in `launchWorker` (still deferred).
- The worker self-reports via the `complete_todo` MCP tool — Phase 3 *simulates* the completion call. Live MCP-driven completion requires a **server restart** (the long-running server predates the new tools).

## Run output (latest)

```
✅ ALL PASS — 13 passed, 0 failed
worker tmux: mc-pcssmoke<rand>-worker<id8>  (spawned, verified live, then killed)
```
