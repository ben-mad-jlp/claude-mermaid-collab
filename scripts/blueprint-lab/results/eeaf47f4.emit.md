I have a complete picture. Here is the implementation blueprint.

## Blueprint: Make the pin's per-tick drive observable rather than inferred

### Problem (grounded)
The conductor-target-pin feature drives one mission per tick via `runConductorPass` (`src/services/conductor-pass.ts:91`), which returns a rich `ConductorPassResult` (`src/services/conductor-pass.ts:81-86`) naming the exact branch taken each tick (`conductor-disabled | no-actionable-mission | target-not-actionable | target-cleared | building-wait | debounced | conducted | node-failed`) plus `missionId` and `modelUsed`. But that result is **discarded** by the only caller (`runConductorGuarded` at `src/services/orchestrator-live.ts:132-152`) — nothing persists or exposes it. The live-measurement doc (`docs/conductor-target-live-measurement.md:41-42`) had to **infer** per-tick pin behavior from `updatedAt`/`lastNudgeAt` drift and the static `targetMissionId` GET, because the pin's actual per-tick drive (which branch fired, against which mission, when) is not observable. The `GET /api/supervisor/conductor` endpoint (`src/routes/supervisor-routes.ts:897-905`) only returns `enabled` + `targetMissionId` — the *configured* pin, never the *last realized drive*.

### Change shape

**1. `src/services/conductor-pass.ts` — record + expose the last pass observation**

- Add optional `fingerprint?: string` to the `ConductorPassResult` interface (`:81-86`) so the debounce key that gated a tick is itself observable.
- In the two branches that compute `fp`, attach it to the returned result: the debounced return (`:141`) → `{ ran: false, reason: 'debounced', missionId, fingerprint: fp }`; the final return (`:163`) → add `fingerprint: fp`.
- Add a new exported interface `ConductorPassObservation extends ConductorPassResult { at: number }` (wall-clock ms of the pass).
- Add a module-level `const lastConductorPassByProject = new Map<string, ConductorPassObservation>()`.
- Add `export function getLastConductorPass(project: string): ConductorPassObservation | undefined { return lastConductorPassByProject.get(project); }`.
- Add `export function recordConductorPass(project: string, obs: ConductorPassObservation): void { lastConductorPassByProject.set(project, obs); }` (exported so the test can assert/reset behavior directly).
- Refactor so **every** return path is recorded: rename the current body of `runConductorPass` to an internal `async function computeConductorPass(project, deps): Promise<ConductorPassResult>` (identical body, all existing early returns untouched), and make `runConductorPass` a thin wrapper that calls it, records `recordConductorPass(project, { ...result, at: Date.now() })`, and returns `result`. Signature and every returned `ConductorPassResult` stay identical, so existing callers/tests are unaffected.

**2. `src/routes/supervisor-routes.ts` — surface it on the GET endpoint**

- Add `import { getLastConductorPass } from '../services/conductor-pass.ts';` (match the `.ts`-extension import style used at `:35`).
- In the `GET /api/supervisor/conductor` response object (`:900-904`), add a `lastPass: getLastConductorPass(project) ?? null` field alongside `enabled` and `targetMissionId`. A reader can now see, directly, the last tick's `reason`, `missionId`, `fingerprint`, and `at` — the realized per-tick drive, not inferred drift.

**3. `src/services/__tests__/conductor-pass.test.ts` — named test**

- Import `getLastConductorPass` from `../conductor-pass` (`:11`).
- Add test `records the last pass observation (reason + missionId + timestamp) for each branch`: (a) run with the toggle disabled → assert `getLastConductorPass(project)` returns `{ reason: 'conductor-disabled', at: <number> }`; (b) enable + forge an approved active mission with a discover gap, run → assert the recorded observation has `reason: 'conducted'`, `missionId === forged.missionId`, and a positive `at`; (c) run again immediately (same fingerprint) → assert the recorded observation now reads `reason: 'debounced'` and carries a non-empty `fingerprint`. This proves the drive is observable across distinct branches. Mirrors the existing `okInvoke`/`forgeApprovedActive` harness at `:20-30,50-60`.

### Acceptance criteria (positive, citable)
1. `ConductorPassResult` in `src/services/conductor-pass.ts` carries a `fingerprint?: string` field, and the debounced + final returns populate it with the computed `fp`.
2. `src/services/conductor-pass.ts` exports `getLastConductorPass(project)` returning a `ConductorPassObservation` with an `at` timestamp, and `runConductorPass` records an observation on **every** return path (via the wrapper over `computeConductorPass`).
3. `GET /api/supervisor/conductor` in `src/routes/supervisor-routes.ts` returns a `lastPass` field sourced from `getLastConductorPass(project)`.
4. `src/services/__tests__/conductor-pass.test.ts` contains a passing test asserting `getLastConductorPass` reflects `reason`/`missionId`/`at` across the disabled, conducted, and debounced branches.

### Out of scope
- Persisting the observation to SQLite (in-memory latest-per-project is sufficient for observability; survives no restart by design).
- A ring/history of past passes — only the *latest* pass per project is exposed.
- Any change to conductor scheduling, debounce, or landing logic — this is purely additive observability.
- A dedicated MCP tool or UI surface for `lastPass` (REST GET is the observability seam this leaf adds).

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["src/services/conductor-pass.ts", "src/routes/supervisor-routes.ts", "src/services/__tests__/conductor-pass.test.ts"],
  "tasks": [
    { "id": "record-last-pass", "files": ["src/services/conductor-pass.ts"], "description": "Add fingerprint to ConductorPassResult, ConductorPassObservation + per-project map, getLastConductorPass/recordConductorPass, and wrap runConductorPass to record every branch" },
    { "id": "expose-on-get", "files": ["src/routes/supervisor-routes.ts"], "description": "Add lastPass field (getLastConductorPass) to GET /api/supervisor/conductor response" },
    { "id": "test-observability", "files": ["src/services/__tests__/conductor-pass.test.ts"], "description": "Assert getLastConductorPass reflects reason/missionId/at across disabled, conducted, debounced branches" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/conductor-pass.ts", "symbol": "getLastConductorPass", "description": "Exposes the latest realized per-tick conductor drive per project" },
    { "kind": "symbol-present", "file": "src/services/conductor-pass.ts", "symbol": "ConductorPassObservation", "description": "Observation type = ConductorPassResult + at timestamp" },
    { "kind": "symbol-present", "file": "src/routes/supervisor-routes.ts", "symbol": "getLastConductorPass", "description": "GET /api/supervisor/conductor surfaces lastPass so drive is observed, not inferred" },
    { "kind": "named-test", "testFile": "src/services/__tests__/conductor-pass.test.ts", "testName": "records the last pass observation (reason + missionId + timestamp) for each branch", "mechanical": true }
  ],
  "outOfScope": [
    "Persisting the observation to SQLite (in-memory latest-per-project only)",
    "A history/ring of past passes (only latest per project)",
    "Changes to conductor scheduling, debounce, or landing logic",
    "A dedicated MCP tool or UI surface for lastPass"
  ] }
```