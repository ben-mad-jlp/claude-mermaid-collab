<!-- blueprint-lab-emit model=sonnet effort=medium -->
## Blueprint: Test the cap rejects/throttles bulk mission creation

**Target:** `assertMissionCreationAllowed` in `src/services/mission-store.ts:983-1006`, wired into `src/mcp/mission-tools.ts:59` (create_mission path) and `src/mcp/tools/mission-forge.ts:116` (forge_mission path). This guard is unit-tested nowhere today (`grep` for `assertMissionCreationAllowed` finds only the three production call sites — no test file references it).

**Where to add the test:** new describe block in `src/services/__tests__/mission-store.test.ts` (same file already imports `upsertMission`, `setMissionAbandoned`, `isMissionTerminal`, `_resetMissionDbCache` and has the `makeMissionNode`/project-tmpdir harness at lines 1-42 — reuse it). Import `assertMissionCreationAllowed`, `MAX_MISSIONS_PER_PROJECT`, `MAX_MISSIONS_PER_WINDOW`, `MISSION_CREATE_RATE_WINDOW_MS`, `_resetMissionCreateThrottle` from `../mission-store`.

**What `assertMissionCreationAllowed(project, now?)` actually does** (mission-store.ts:983):
1. Bypass: if `process.env.MERMAID_SKIP_MISSION_CEILING === '1'`, returns immediately (must NOT be set during these tests — the outer harness/CI may set it, so explicitly `delete process.env.MERMAID_SKIP_MISSION_CEILING` in `beforeEach`).
2. Count ceiling: `listMissions(project).filter(m => !isMissionTerminal(m.mission)).length >= MAX_MISSIONS_PER_PROJECT` (25) → throws.
3. Rate ceiling: filters `missionCreateTimestamps` for this project to entries within `MISSION_CREATE_RATE_WINDOW_MS` (10 min) of `now`; if `>= MAX_MISSIONS_PER_WINDOW` (5) → throws.
4. On success, pushes `now` into the per-project timestamp log (side effect — every allowed call consumes one slot of the rate window).

Both throws produce an `Error` with a message containing `assertMissionCreationAllowed:` and the bypass env var name — assert on message content via `.toThrow(/ceiling/)` or similar, not exact string.

**Required test cases** (each a `test(...)` inside a new `describe('mission-store: creation ceiling', ...)` block):

1. **Count ceiling rejects at threshold.** Create `MAX_MISSIONS_PER_PROJECT` (25) mission nodes via `makeMissionNode()` + `upsertMission(project, id)` (non-terminal by default — `upsertMission` doesn't set `abandonedAt`/converged status). Call `assertMissionCreationAllowed(project)` and assert it throws.
2. **Count ceiling allows one under threshold.** Create `MAX_MISSIONS_PER_PROJECT - 1` (24) non-terminal missions. Assert `assertMissionCreationAllowed(project)` does NOT throw.
3. **Terminal missions don't count toward the ceiling.** Create 25 mission nodes, mark all `abandoned` via `setMissionAbandoned(project, id, Date.now())` (mission-store.ts:317) so `isMissionTerminal` is true for each. Assert `assertMissionCreationAllowed(project)` does NOT throw (proves the filter in mission-store.ts:986 excludes terminal missions, not just raw count).
4. **Rate window throttles a burst independent of count.** With 0 pre-existing missions, call `assertMissionCreationAllowed(project, now)` `MAX_MISSIONS_PER_WINDOW` (5) times with the same fixed `now` (or timestamps within the 10-min window), then assert the 6th call throws.
5. **Rate window resets outside the window.** Call `assertMissionCreationAllowed(project, now)` 5 times at `now`, then call again at `now + MISSION_CREATE_RATE_WINDOW_MS + 1` — assert it does NOT throw (old timestamps aged out of the filter at mission-store.ts:991).
6. **Bypass env var short-circuits both ceilings.** Set `process.env.MERMAID_SKIP_MISSION_CEILING = '1'`, create 25+ non-terminal missions, call `assertMissionCreationAllowed(project)` repeatedly — assert no throw; restore/delete the env var in a `finally` or `afterEach`.
7. **Per-project isolation.** Push `MAX_MISSIONS_PER_WINDOW` timestamps for `project` (via 5 allowed calls), then assert `assertMissionCreationAllowed(otherProjectDir)` for a second tmpdir project does NOT throw — confirms `missionCreateTimestamps` keys by project, not global.
8. **Test-seam reset works.** After tripping the rate ceiling (5 calls), call `_resetMissionCreateThrottle(project)` (mission-store.ts:1008), then assert a 6th call at the same `now` no longer throws. Also cover `_resetMissionCreateThrottle()` with no args clearing all projects.

Use the injectable `now` parameter throughout (mission-store.ts:983 signature: `now: number = nowMs()`) rather than real timers, so rate-window tests are deterministic — pick arbitrary fixed epoch ms values, not `Date.now()`.

**Cleanup:** add `_resetMissionCreateThrottle()` to the existing `afterEach` (alongside `_closeProject`/`_resetMissionDbCache`) so the in-memory `missionCreateTimestamps` map doesn't leak state across tests in the same `bun test` process — this module-level `Map` is not otherwise reset by `_closeProject`/`_resetMissionDbCache`.

**Out of scope:** MCP-layer tests for `create_mission`/`forge_mission` actually invoking `assertMissionCreationAllowed` (mission-tools.ts:59, mission-forge.ts:116) — those are integration wiring already covered by the tool call sites; this leaf is scoped to the store-level guard function itself.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 8,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/__tests__/mission-store.test.ts"],
  "tasks": [
    { "id": "count-ceiling-rejects", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "25 non-terminal missions -> assertMissionCreationAllowed throws" },
    { "id": "count-ceiling-allows-under", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "24 non-terminal missions -> no throw" },
    { "id": "terminal-excluded-from-count", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "25 abandoned (terminal) missions -> no throw" },
    { "id": "rate-window-throttles-burst", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "6th call within window throws even at 0 mission count" },
    { "id": "rate-window-resets", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "call after window elapses does not throw" },
    { "id": "bypass-env-shortcircuits", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "MERMAID_SKIP_MISSION_CEILING=1 bypasses both ceilings" },
    { "id": "per-project-isolation", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "rate log keyed per project, not global" },
    { "id": "reset-seam-works", "files": ["src/services/__tests__/mission-store.test.ts"], "description": "_resetMissionCreateThrottle clears the throttled state" }
  ],
  "leafKind": "test",
  "requirements": [
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "count ceiling rejects at threshold", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "count ceiling allows one under threshold", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "terminal missions do not count toward the ceiling", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "rate window throttles a burst", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "rate window resets outside the window", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "bypass env var short-circuits both ceilings", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "rate throttle is isolated per project", "mechanical": true },
    { "kind": "named-test", "testFile": "src/services/__tests__/mission-store.test.ts", "testName": "_resetMissionCreateThrottle clears throttle state", "mechanical": true },
    { "kind": "symbol-present", "file": "src/services/mission-store.ts", "symbol": "assertMissionCreationAllowed", "description": "function under test, already implemented at line 983" }
  ],
  "outOfScope": ["MCP-layer integration tests exercising create_mission/forge_mission end-to-end", "changing MAX_MISSIONS_PER_PROJECT or MAX_MISSIONS_PER_WINDOW values", "UI-visible error surfacing for the ceiling"] }
```