I now have a complete picture. Here is the blueprint.

## Blueprint — Test the mission-creation ceiling rejects/throttles bulk creation

### What exists (the code under test)
`src/services/mission-store.ts` ships the enforcement (added in commit `c5ede23f`):
- `assertMissionCreationAllowed(project, now = nowMs())` (line 983) — the guard called at the start of both creation paths (`src/mcp/mission-tools.ts:59`, `src/mcp/tools/mission-forge.ts:116`). It throws on **two** independent conditions:
  - **(a) count ceiling** — `>= MAX_MISSIONS_PER_PROJECT` (`=25`, line 957) non-terminal missions (`listMissions(...).filter(m => !isMissionTerminal(m.mission))`, line 986).
  - **(b) burst/rate ceiling** — `>= MAX_MISSIONS_PER_WINDOW` (`=5`, line 962) creation calls within `MISSION_CREATE_RATE_WINDOW_MS` (`=10*60_000`, line 961), tracked in the in-memory `missionCreateTimestamps` map. `now` is injectable for determinism.
- `isMissionTerminal(m)` (line 42) — terminal = `abandonedAt != null || status === 'converged'`; terminal missions are excluded from the count.
- Bypass env `MERMAID_SKIP_MISSION_CEILING=1` (line 984) → early return, no enforcement.
- `_resetMissionCreateThrottle(project?)` (line 1010) — test seam clearing the rolling window log.

There is currently **no test** covering this guard. The leaf adds one.

### Change shape
Edit **only** `src/services/__tests__/mission-store.test.ts` (Bun test file — uses `bun:test`, per line 1–2).

1. **Extend the import** from `'../mission-store'` (lines 9–15) to add:
   `assertMissionCreationAllowed, MAX_MISSIONS_PER_PROJECT, MAX_MISSIONS_PER_WINDOW, MISSION_CREATE_RATE_WINDOW_MS, _resetMissionCreateThrottle, setMissionAbandoned, upsertMission` (some already imported — add only the missing ones).

2. **Add a `describe('mission-store: creation ceiling', …)` block** with its own `beforeEach` calling `_resetMissionCreateThrottle()` and `delete process.env.MERMAID_SKIP_MISSION_CEILING`, plus an `afterEach` that also deletes the bypass env. Use a local helper:
   ```ts
   async function mintMissions(n: number): Promise<string[]> {
     const ids: string[] = [];
     for (let i = 0; i < n; i++) {
       const id = await makeMissionNode(`[MISSION] ceiling ${i}`);
       upsertMission(project, id);
       ids.push(id);
     }
     return ids;
   }
   ```

3. **Five tests** (all deterministic — inject a fixed `now`, no wall-clock):

   - `count ceiling: at MAX_MISSIONS_PER_PROJECT non-terminal missions creation is rejected` — `await mintMissions(MAX_MISSIONS_PER_PROJECT)`; `expect(() => assertMissionCreationAllowed(project, 1000)).toThrow(/non-terminal missions/)`.
   - `count ceiling: below the ceiling creation is allowed` — `await mintMissions(MAX_MISSIONS_PER_PROJECT - 1)`; `expect(() => assertMissionCreationAllowed(project, 1000)).not.toThrow()`.
   - `terminal (abandoned) missions do not count against the ceiling` — `const ids = await mintMissions(MAX_MISSIONS_PER_PROJECT)`; abandon every id via `setMissionAbandoned(project, id, 1)`; `expect(() => assertMissionCreationAllowed(project, 1000)).not.toThrow()`.
   - `burst ceiling: MAX_MISSIONS_PER_WINDOW in-window creations pass, the next throttles` — with fixed `const now = 1_000_000`: loop `MAX_MISSIONS_PER_WINDOW` times calling `assertMissionCreationAllowed(project, now)` (each must not throw); the next `assertMissionCreationAllowed(project, now)` `.toThrow(/per window/)`. Also assert a call at `now + MISSION_CREATE_RATE_WINDOW_MS` does **not** throw (window rolled off). No missions minted, so the count branch stays clear.
   - `MERMAID_SKIP_MISSION_CEILING=1 bypasses both ceilings` — `await mintMissions(MAX_MISSIONS_PER_PROJECT)`; set `process.env.MERMAID_SKIP_MISSION_CEILING = '1'`; `expect(() => assertMissionCreationAllowed(project, 1000)).not.toThrow()` even over the count ceiling.

### Acceptance criteria (positive, citable)
- The import block near `src/services/__tests__/mission-store.test.ts:9` names `assertMissionCreationAllowed`, `MAX_MISSIONS_PER_PROJECT`, `MAX_MISSIONS_PER_WINDOW`, `MISSION_CREATE_RATE_WINDOW_MS`, `_resetMissionCreateThrottle`, and `setMissionAbandoned` from `'../mission-store'`.
- A `describe('mission-store: creation ceiling', …)` block exists with a `beforeEach` that calls `_resetMissionCreateThrottle()` and clears `MERMAID_SKIP_MISSION_CEILING`.
- Test `count ceiling: at MAX_MISSIONS_PER_PROJECT non-terminal missions creation is rejected` asserts `assertMissionCreationAllowed` throws matching `/non-terminal missions/`.
- Test `terminal (abandoned) missions do not count against the ceiling` abandons all minted missions via `setMissionAbandoned` and asserts `assertMissionCreationAllowed` does not throw.
- Test `burst ceiling: MAX_MISSIONS_PER_WINDOW in-window creations pass, the next throttles` asserts the `MAX_MISSIONS_PER_WINDOW+1`-th same-`now` call throws matching `/per window/`, and a call at `now + MISSION_CREATE_RATE_WINDOW_MS` does not throw.
- Test `MERMAID_SKIP_MISSION_CEILING=1 bypasses both ceilings` sets the env to `'1'` and asserts no throw over the count ceiling.
- `npm run test:ci -- src/services/__tests__/mission-store.test.ts` (bun lane) passes with the new tests green.

### Out of scope
No changes to `mission-store.ts` enforcement logic or the MCP creation wrappers — this leaf only adds tests. No new exported symbols.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false, "filesToCreate": [], "filesToEdit": ["src/services/__tests__/mission-store.test.ts"],
  "tasks": [ { "id": "add-ceiling-tests", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "Add a 'mission-store: creation ceiling' describe block exercising the count ceiling, terminal-exclusion, burst-window throttle, and env bypass of assertMissionCreationAllowed." } ],
  "leafKind": "test",
  "requirements": [
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "count ceiling: at MAX_MISSIONS_PER_PROJECT non-terminal missions creation is rejected", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "terminal (abandoned) missions do not count against the ceiling", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "burst ceiling: MAX_MISSIONS_PER_WINDOW in-window creations pass, the next throttles", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "MERMAID_SKIP_MISSION_CEILING=1 bypasses both ceilings", "mechanical": true },
    { "kind": "symbol-present", "file": "src/services/mission-store.ts", "symbol": "assertMissionCreationAllowed", "description": "The guard under test must remain exported for the test to import and call." }
  ],
  "outOfScope": ["No changes to mission-store.ts enforcement logic or MCP creation wrappers (mission-tools.ts / mission-forge.ts)", "No new exported production symbols"] }
```