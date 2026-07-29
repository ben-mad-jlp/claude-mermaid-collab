<!-- blueprint-lab-emit model=sonnet effort=medium -->
## Blueprint: Show and clear the current conductor target in `ProjectSettingsModal`

### Context

`ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx` is the single per-project settings modal. It already has a `ConductorControl` (`ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx:215-232`) that toggles the autonomous-conductor `enabled` flag via `GET/POST /api/supervisor/conductor`. The same endpoint also carries a `targetMissionId` pin, already fully wired server-side and in the store:

- Backend: `GET /api/supervisor/conductor?project=` returns `{ project, enabled, targetMissionId }` (`src/routes/supervisor-routes.ts:896-905`). `POST /api/supervisor/conductor` accepts `{ project, enabled?, targetMissionId? }` and echoes back the current `{ enabled, targetMissionId }` (`src/routes/supervisor-routes.ts:906-934`).
- Store: `fetchConductorTarget`/`setConductorTarget` in `ui/src/stores/supervisorStore.ts:985-996` already exercise this same endpoint for the mission-rail Pin/Unpin control (`ui/src/components/supervisor/bridge/rail/missionShared.tsx:561-593, 813-841`).

But `ProjectSettingsModal` has no visibility into *which* mission is currently pinned, nor a way to clear it from Settings — only the rail's per-card Pin/Unpin button knows. This leaf adds a small read+clear control to the modal itself, following the exact pattern of `WatchdogControl` (`ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx:20-79`), which already does GET-seed + POST-clear via the local `apiGet`/`apiPost` helpers (`ui/src/components/supervisor/bridge/useConductorEnabled.ts:3-15`) — no `serverId` prop needed since those helpers route through `window.mc.invokeOnServer('local', ...)` / same-origin `fetch`.

### Change shape

In `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx`:

1. **New component** `ConductorTargetControl: React.FC<{ project: string }>`, placed after `ConductorControl` (after line 232). It:
   - `useState<string | null>` for `targetMissionId`, `useState<boolean>` for `busy`.
   - On mount/`project` change, `apiGet('/api/supervisor/conductor?project=' + encodeURIComponent(project))` and sets `targetMissionId` from `data?.targetMissionId ?? null` (mirrors `WatchdogControl`'s effect at lines 25-36).
   - Renders `data-testid="conductor-target-control"`:
     - If `targetMissionId` is set: a label "Pinned:" + `data-testid="conductor-target-id"` showing `targetMissionId.slice(0, 8)` (per this repo's leading-8-hex short-id convention) with `title={targetMissionId}` for the full id, plus a `data-testid="conductor-target-clear"` button.
     - Else: `data-testid="conductor-target-none"` italic text, e.g. "No target pinned — the conductor picks its own mission."
   - `clear` callback: guards on `busy`/`project`, sets `busy(true)`, calls `apiPost('/api/supervisor/conductor', { project, targetMissionId: null })`, sets `targetMissionId` from the response (`data?.targetMissionId ?? null`), `busy(false)` — mirrors `WatchdogControl.commit` (lines 38-48).

2. **Mount it** inside the existing `Section label="Autonomous conductor"` block (`ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx:306-308`), directly under `<ConductorControl project={project} />`:
   ```tsx
   <Section label="Autonomous conductor">
     <ConductorControl project={project} />
     <ConductorTargetControl project={project} />
   </Section>
   ```

No store changes, no backend changes — this is a pure UI read+clear surface reusing the already-shipped route and the modal's existing `apiGet`/`apiPost` pattern.

### Test update

`ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx`'s `mockFetch` conductor branch (lines 51-58) currently only echoes `enabled` — extend it to also carry/echo `targetMissionId` (mutable module-level `let conductorTarget: string | null = null`, reset in `afterEach`) so a new test can assert: GET seeds `conductor-target-none` when unset, seeds `conductor-target-id` text when the mock returns a `targetMissionId`, and clicking `conductor-target-clear` POSTs `{ project, targetMissionId: null }` and flips the UI back to the "none" state.

### Acceptance criteria

1. `ConductorTargetControl` component exists in `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx`, rendering `data-testid="conductor-target-control"`.
2. It fetches `GET /api/supervisor/conductor?project=` via `apiGet` and renders `data-testid="conductor-target-id"` with the pinned mission id when `targetMissionId` is non-null, else `data-testid="conductor-target-none"`.
3. A `data-testid="conductor-target-clear"` button calls `apiPost('/api/supervisor/conductor', { project, targetMissionId: null })` and updates local state from the response.
4. `<ConductorTargetControl project={project} />` is rendered inside the `Section label="Autonomous conductor"` block in `ProjectSettingsModal`, alongside `<ConductorControl project={project} />`.
5. `ProjectSettingsModal.test.tsx` has a passing test asserting the clear button POSTs `targetMissionId: null` and the UI reverts to the unpinned display.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx",
    "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"
  ],
  "tasks": [
    { "id": "add-conductor-target-control", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx"], "description": "Add ConductorTargetControl (GET-seed + POST-clear) and mount it in the Autonomous conductor section" },
    { "id": "test-conductor-target-control", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"], "description": "Extend mockFetch conductor branch with targetMissionId and add a show/clear test" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "symbol": "ConductorTargetControl", "description": "new control component showing/clearing the pinned conductor target" },
    { "kind": "named-test", "testFile": "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx", "testName": "clearing conductor-target-clear POSTs targetMissionId null and reverts to unpinned", "mechanical": false }
  ],
  "outOfScope": ["changing the mission-rail Pin/Unpin control", "backend route or store changes (already shipped)"] }
```