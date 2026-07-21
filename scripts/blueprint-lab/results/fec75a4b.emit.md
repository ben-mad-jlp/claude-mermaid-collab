I have everything I need. Here's the blueprint.

## Blueprint — Harden `scripts/live-conductor-pin-evidence.ts` so step (f) never SKIPs

### Root cause
The only assertion that can be skipped is the lazy self-clear check in **step (f)** (`scripts/live-conductor-pin-evidence.ts:187-223`). Today it *searches* for a pre-existing `converged`/`abandoned` mission via `GET /api/supervisor/missions` and, finding none (the normal case for a fresh evidence run), pushes a `SKIPPED` note (`:203`) and logs `⏭️ skipped` (`:204`) — so the `target-cleared` sub-assertion never records a `check(...)`.

### The available HTTP lever (in-scope)
A mission can be driven **terminal over HTTP alone**, no MCP:
- `PATCH /api/supervisor/missions` accepts `abandonedAt` and forwards it to `update_mission` (`src/routes/supervisor-routes.ts:266-279`).
- `deriveMissionStatus` returns `'abandoned'` first-match-wins whenever `abandonedAt != null` — ahead of even `unapproved` (`src/services/mission-store.ts:729`), so a freshly-created mission with `abandonedAt` set is terminal regardless of approval.
- The conductor pass treats a pin at an `abandoned` mission as terminal: it clears the pin and records `lastPass = { missionId: null, reason: 'target-cleared', tickAt }` (`src/services/conductor-pass.ts:126-130`), exactly what the poll predicate at `:216` waits for.

This keeps the script HTTP-only (its stated contract, header comment `:9-12` and `:194-196`) while removing the SKIP.

### Change shape (single file: `scripts/live-conductor-pin-evidence.ts`)

1. **Add an HTTP helper** near the other request helpers (after `post`, ~`:85`):
   ```ts
   async function abandonMissionOverHttp(todoId: string, abandonedAt: number) {
     const res = await fetch(`${BASE_URL}/api/supervisor/missions`, {
       method: 'PATCH',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ project, todoId, abandonedAt }),
     });
     return { status: res.status, body: await res.json().catch(() => null) };
   }
   ```

2. **Replace the discover-or-skip block** (`:194-223`, from the `// Lazy self-clear needs...` comment through the closing `}` of the `else`) with an **unconditional force-terminal path**:
   - Create a dedicated throwaway mission via the existing `createAndApproveMission('Live conductor-pin evidence terminal mission')` (`:127-137`); capture its id as `forcedTerminalId`.
   - Call `abandonMissionOverHttp(forcedTerminalId, Date.now())`; assert with a new `check('mission forced terminal via HTTP abandon', patch.status === 200 && patch.body?.mission?.status === 'abandoned', ...)` — the PATCH response returns the derived `mission` (`src/routes/supervisor-routes.ts:276`).
   - `POST /api/supervisor/conductor` with `targetMissionId: forcedTerminalId`, reusing the existing pin assertion pattern (`:151-152`).
   - Reuse the existing `pollUntil(...)` for `lastPass.reason === 'target-cleared' && targetMissionId === null` (`:210-217`) and keep the terminal `check('lazy self-clear observed ...', satisfiedAt !== null, ...)` (`:218-222`) — now reached on every run, not gated behind an `if`.
   - Delete the `notes.push('... SKIPPED ...')` (`:203`) and the `⏭️ skipped` log (`:204`); the `if (!terminalMission)` branch is gone.

3. **Update the step header + rationale comments** (`:187`, `:194-196`) to describe forcing a terminal mission via the `PATCH … abandonedAt` HTTP route rather than passively discovering one; keep the "no MCP transport" note (PATCH is a first-class HTTP route, so the HTTP-only contract holds).

4. Add `forcedTerminalId` to the `EvidenceBlob` write (`:229-232`) as an optional field so the artifact records which mission was abandoned (positive, citable evidence-schema addition alongside `missionA`/`missionB` at `interface EvidenceBlob` `:48-59`).

### Out of scope
- No change to routes, conductor-pass, or mission-store — all levers already exist.
- Do not add MCP calls; the harness stays HTTP-only.
- `missionA`/`missionB` pin/poll logic (steps c–e) is unchanged.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false, "filesToCreate": [], "filesToEdit": ["scripts/live-conductor-pin-evidence.ts"],
  "tasks": [
    { "id": "force-terminal-http", "files": ["scripts/live-conductor-pin-evidence.ts"], "description": "Replace step (f) discover-or-skip with an unconditional force-terminal path that PATCHes abandonedAt over HTTP, pins the abandoned mission, and asserts target-cleared" }
  ],
  "leafKind": "test",
  "requirements": [
    { "kind": "symbol-present", "file": "scripts/live-conductor-pin-evidence.ts", "symbol": "abandonMissionOverHttp", "description": "New HTTP helper that PATCHes /api/supervisor/missions with abandonedAt to force a mission terminal without MCP" },
    { "kind": "symbol-present", "file": "scripts/live-conductor-pin-evidence.ts", "symbol": "forcedTerminalId", "description": "Id of the throwaway mission the harness abandons to drive the lazy self-clear assertion unconditionally" },
    { "kind": "threshold", "source": "grep-count", "metric": "abandonedAt-in-harness", "comparison": "gte", "value": 1, "mechanical": true },
    { "kind": "threshold", "source": "grep-count", "metric": "skip-emoji-count", "comparison": "eq", "value": 0, "mechanical": true }
  ],
  "outOfScope": [
    "No changes to src/routes, conductor-pass, or mission-store — the PATCH abandonedAt lever already exists",
    "No MCP transport added; harness stays HTTP-only",
    "steps (a)-(e) pin/poll logic unchanged"
  ] }
```