# Wave 1+2 Implementation — PCS Phase 2c (live coordinator wiring)

## Tasks
- **coordinator-live** (`src/services/coordinator-live.ts`, NEW): `makeCoordinatorDeps()` wires the real todo-store fns + `launchWorker(project, todo)` (launchAndBind w/ DEFAULT_WORKER_TOOLS, session `worker-<id8>`, on started → `updateTodo {sessionName}`). `startCoordinator(project, intervalMs=30000)` / `stopCoordinator` / `isCoordinatorRunning` over a module timer Map (setInterval→runTick, per-tick catch, unref, idempotent, explicit-start only). +5 light bun tests (deps shape, start/stop/idempotency with a 1h interval so no live tick).
- **coordinator-mcp** (`src/mcp/setup.ts`): added MCP tools `complete_todo` (→ handleWorkerComplete(makeCoordinatorDeps()…) + session_todos_updated broadcast), `start_coordinator` (→ startCoordinator), `stop_coordinator` (→ stopCoordinator), with dispatch cases matching the file's pattern.

## Verification
- tsc clean (exit 0); `bun test coordinator-live.test.ts` → 5 pass. (The live tmux spawn path is integration-only — NOT exercised by tests.)

## Explicit-start safety
The coordinator does NOT auto-start at boot — it must be started via the `start_coordinator` MCP tool, so a server restart never silently begins claiming + spawning workers.

## Deferred (later)
Event-wake (poll-only for now; todo-store has no in-process emitter), agent profiles (default tools), parallel spawning (sequential; ~spawn latency per ready todo), the mechanical acceptance gate (worker self-reports accepted/rejected via its own review), choosing the worker's invokeSkill, and LIVE end-to-end verification (spawn→bind→work→complete) which needs a running app.

## Wave TSC
clean.
