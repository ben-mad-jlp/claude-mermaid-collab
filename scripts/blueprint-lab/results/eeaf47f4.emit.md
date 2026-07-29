<!-- blueprint-lab-emit model=sonnet effort=medium -->
## Blueprint: Make the pin's per-tick drive observable rather than inferred

### Context (grounded)

The conductor pin lives in `src/services/conductor-pass.ts`. Every 30s, `runConductorGuarded` (`src/services/orchestrator-live.ts:132-152`) iterates watched projects and calls `runConductorPass(project)` (`conductor-pass.ts:91-164`), which resolves the pin, computes a debounce fingerprint, and returns a fully-formed `ConductorPassResult` (`conductor-pass.ts:81-86`: `{ ran, reason, missionId?, modelUsed? }` — `reason` is one of `conductor-disabled | no-actionable-mission | target-not-actionable | target-cleared | building-wait | debounced | conducted | node-failed`).

Today that result is **discarded** at the call site — `orchestrator-live.ts:142`: `await withPassTimeout(conductor(project), BUILD_PASS_TIMEOUT_MS, ...)`, return value unused. The only externally visible state is the *current* pin value via `GET /api/supervisor/conductor` (`src/routes/supervisor-routes.ts:896-905`, backed by `supervisor-store.ts:483-493`) and `mission.lastConductorKey` (`mission-store.ts:253-258`), both single-value columns with no history. `docs/conductor-target-live-measurement.md` had to reconstruct "what did the conductor do on tick N" by diffing two GET polls across a real 30s interval — proof this is currently *inferred*, not observed.

### Change shape

**1. `src/services/orchestrator-live.ts`**
- Add an exported type and a capped, in-memory per-process ring buffer next to the existing module state (near `conductorTimer`/`conductorRunning`, `orchestrator-live.ts:43-44`):
  ```ts
  export interface ConductorLogEntry {
    project: string;
    at: number;
    ran: boolean;
    reason: string;
    missionId?: string;
    modelUsed?: string;
  }
  const CONDUCTOR_LOG_MAX = 50;
  const conductorLog: ConductorLogEntry[] = [];
  ```
- In `runConductorGuarded` (`orchestrator-live.ts:132-152`), capture the awaited result instead of discarding it, push a capped log entry, and broadcast a WS event — mirroring the existing `orchestrator_tick` heartbeat broadcast at `orchestrator-live.ts:165`:
  ```ts
  const result = await withPassTimeout(conductor(project), BUILD_PASS_TIMEOUT_MS, `${project}:conductor`);
  if (result && typeof result === 'object' && 'reason' in result) {
    const r = result as ConductorPassResult;
    const entry: ConductorLogEntry = { project, at: Date.now(), ran: r.ran, reason: r.reason, missionId: r.missionId, modelUsed: r.modelUsed };
    conductorLog.push(entry);
    if (conductorLog.length > CONDUCTOR_LOG_MAX) conductorLog.shift();
    try {
      getWebSocketHandler()?.broadcast({ type: 'conductor_tick', ...entry });
    } catch { /* best-effort, mirrors orchestrator_tick */ }
  }
  ```
  (`deps.conductor` is typed `Promise<unknown>` in `TickDeps`, so the `'reason' in result` guard keeps test doubles that return something else from polluting the log.)
- Add an exported reader, same style as `getOrchestratorHealth` (`orchestrator-live.ts:519-546`):
  ```ts
  export function getConductorLog(project?: string): ConductorLogEntry[] {
    const rows = project ? conductorLog.filter((e) => e.project === project) : conductorLog;
    return rows.slice().reverse(); // most-recent first
  }
  ```
- Import `type { ConductorPassResult } from './conductor-pass.js'` (the file already imports `runConductorPass` from there at line 22).

**2. `src/websocket/handler.ts`**
- Add one member to the `WSMessage` union, next to `orchestrator_tick` (`handler.ts:118`):
  ```ts
  | { type: 'conductor_tick'; project: string; at: number; ran: boolean; reason: string; missionId?: string; modelUsed?: string }
  ```

**3. `src/routes/supervisor-routes.ts`**
- Add `GET /api/supervisor/conductor/log?project=` right after the existing `GET /api/supervisor/conductor` handler (`supervisor-routes.ts:896-905`), following the same param-validation shape:
  ```ts
  if (url.pathname === '/api/supervisor/conductor/log' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ project, entries: getConductorLog(project) });
  }
  ```
- Add `getConductorLog` to the existing import of conductor helpers from `'../services/orchestrator-live.js'` (or the relevant existing import line for `conductor-pass`/`orchestrator-live` symbols in that file — check current import block and extend it).

**4. Tests — `src/services/__tests__/orchestrator-live.test.ts`**
- Extend the existing `runConductorGuarded` describe block (test at line 157, `'runConductorGuarded runs the conductor for every WATCHED project on its own loop'`) with a new case: inject a `conductor` dep that resolves `{ ran: true, reason: 'conducted', missionId: 'abc' }`, call `runConductorGuarded`, then assert `getConductorLog(project)[0]` reflects that exact `reason`/`missionId`/`ran`. Since `conductorLog` is module-level and shared across tests in the file, assert on the head entry (`[0]`, most-recent-first) rather than array length/identity.

### Non-goals
- Not persisting the log to SQLite/disk — in-memory, process-lifetime ring buffer is sufficient (mirrors `currentPhase`/`lastTickAt` in `getOrchestratorHealth`, which are also in-memory-only).
- Not touching `conductor-pass.ts`'s `ConductorPassResult` shape or `runConductorPass` itself — it already carries everything needed; the gap is purely that the caller discards it.
- Not building any UI surface for this (Phase 5 in `docs/autonomous-conductor.md:83` is separately tracked) — this leaf only makes the data observable via WS + REST.

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/orchestrator-live.ts", "src/websocket/handler.ts", "src/routes/supervisor-routes.ts", "src/services/__tests__/orchestrator-live.test.ts"],
  "tasks": [
    { "id": "conductor-log-buffer", "files": ["src/services/orchestrator-live.ts"], "description": "Capture runConductorGuarded's per-project ConductorPassResult into a capped in-memory ring buffer and broadcast a conductor_tick WS event" },
    { "id": "ws-conductor-tick-type", "files": ["src/websocket/handler.ts"], "description": "Add conductor_tick to the WSMessage union alongside orchestrator_tick" },
    { "id": "conductor-log-route", "files": ["src/routes/supervisor-routes.ts"], "description": "Add GET /api/supervisor/conductor/log?project= returning getConductorLog(project)" },
    { "id": "conductor-log-test", "files": ["src/services/__tests__/orchestrator-live.test.ts"], "description": "Assert getConductorLog(project) reflects an injected conductor dep's result after runConductorGuarded" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/orchestrator-live.ts", "symbol": "getConductorLog", "description": "Exported reader for the per-tick conductor decision log" },
    { "kind": "symbol-present", "file": "src/services/orchestrator-live.ts", "symbol": "ConductorLogEntry", "description": "Typed shape of one observable per-tick conductor record" },
    { "kind": "symbol-present", "file": "src/routes/supervisor-routes.ts", "symbol": "/api/supervisor/conductor/log", "description": "REST surface exposing the per-tick conductor log for a project" },
    { "kind": "named-test", "testFile": "src/services/__tests__/orchestrator-live.test.ts", "testName": "runConductorGuarded runs the conductor for every WATCHED project on its own loop", "mechanical": false }
  ],
  "outOfScope": ["Persisting the log to SQLite/disk", "Building a UI view over the log", "Changing ConductorPassResult's shape or runConductorPass's behavior"] }
```