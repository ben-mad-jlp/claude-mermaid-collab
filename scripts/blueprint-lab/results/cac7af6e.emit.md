I have everything I need. The backend route `/api/supervisor/conductor` (GET/POST `{ project, enabled }`) already exists (`src/routes/supervisor-routes.ts:880-898`) backed by `getConductorEnabled`/`setConductorEnabled` (`src/services/supervisor-store.ts:465-475`). No UI consumes it yet. This leaf adds the shared hook + the toggle in the modal.

---

## Implementation Blueprint

### 1. New file — `ui/src/hooks/useConductorEnabled.ts`

A shared hook wrapping the existing `/api/supervisor/conductor` route, following the self-contained `apiGet`/`apiPost` pattern used by `ProjectSettingsModal.tsx:18-30` and `PoolSizeControl.tsx:22-34` (mc.invokeOnServer with a `fetch` fallback).

Shape:
```ts
export interface UseConductorEnabled {
  enabled: boolean;
  loaded: boolean;
  busy: boolean;
  setEnabled: (next: boolean) => void;
}
export function useConductorEnabled(project: string): UseConductorEnabled
```
Behavior:
- On mount / `project` change: `GET /api/supervisor/conductor?project=<enc>` → seed `enabled` from `data.enabled` (coerce `!!`), then set `loaded=true`. Use a `cancelled` guard exactly like `PoolSizeControl.tsx:43-56`.
- `setEnabled(next)`: guard `busy || !project`; set `busy=true`; optimistic `setEnabled(next)`; `POST /api/supervisor/conductor { project, enabled: next }`; reconcile from `data.enabled` if boolean; `finally busy=false`.
- Default export the hook too (matches `useIsDesktop.ts:33`).

### 2. Edit — `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx`

- **Import** the hook: `import { useConductorEnabled } from '@/hooks/useConductorEnabled';`
- **Add a `ConductorControl` component** (mirrors `InjectionFlags` style, `ProjectSettingsModal.tsx:167-225`): consumes `useConductorEnabled(project)` and renders a checkbox label with `data-testid="conductor-toggle"`, `checked={enabled}`, `disabled={busy || !loaded}`, `onChange={(e) => setEnabled(e.target.checked)}`, plus a hint span ("Let the autonomous conductor drive missions to done for this project."). Opacity dim while `!loaded`.
- **Add a new `<Section label="Autonomous conductor">`** in the modal body (`ProjectSettingsModal.tsx:281-306`), placed after the Concurrency section, rendering `<ConductorControl project={project} />`.

### 3. Edit — `ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx`

- Extend `mockFetch` with a mutable `conductorState` (default `{ enabled: false }`): GET `/api/supervisor/conductor` returns `{ project, enabled }`; POST mutates + echoes `{ ok: true, project, enabled }` (mirrors the `injection-flags` handler at `ProjectSettingsModal.test.tsx:42-49`).
- Add test **`toggling conductor-toggle POSTs and reflects the new value`**: render open, find `conductor-toggle` (initially unchecked), `fireEvent.click`, `waitFor` checked=true, assert a POST to `/api/supervisor/conductor` with `enabled === true` fired.

### 4. New file — `ui/src/hooks/__tests__/useConductorEnabled.test.ts`

- Test **`useConductorEnabled seeds from GET and POSTs on setEnabled`**: mock `global.fetch`, `renderHook(() => useConductorEnabled('/abs/p'))`, `waitFor(() => result.current.loaded)`, assert `enabled===false`; `act(() => result.current.setEnabled(true))`; `waitFor` `enabled===true`; assert a POST with `enabled:true` fired.

### Notes
- Backend route + store already exist — **no `src/` changes**; this is a pure UI wiring leaf.
- Existing modal tests keep passing: the current `mockFetch` default returns `{}` for the conductor GET, so `enabled` reads `false` and the toggle mounts cleanly.
- `@/hooks/*` alias is the established import path (`useIsDesktop`, `useSettings`, etc.).

### Acceptance criteria (positive, citable)
1. `ui/src/hooks/useConductorEnabled.ts` exports a `useConductorEnabled(project)` hook that GETs `/api/supervisor/conductor?project=` to seed state and POSTs `{ project, enabled }` on `setEnabled`.
2. `ProjectSettingsModal.tsx` renders a `ConductorControl` inside a new `<Section label="Autonomous conductor">`, with a checkbox carrying `data-testid="conductor-toggle"` wired to the hook.
3. `ProjectSettingsModal.test.tsx` contains a test asserting clicking `conductor-toggle` fires a POST to `/api/supervisor/conductor` with `enabled === true` and reflects the checked state.
4. `ui/src/hooks/__tests__/useConductorEnabled.test.ts` contains a test asserting the hook seeds `enabled` from GET and POSTs `enabled:true` on `setEnabled(true)`.

```json
{ "schemaVersion": 2, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/hooks/useConductorEnabled.ts", "ui/src/hooks/__tests__/useConductorEnabled.test.ts"],
  "filesToEdit": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"],
  "tasks": [
    { "id": "hook", "files": ["ui/src/hooks/useConductorEnabled.ts"], "description": "Add shared useConductorEnabled hook over /api/supervisor/conductor GET/POST" },
    { "id": "modal-toggle", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx"], "description": "Add ConductorControl + Autonomous conductor Section using the hook" },
    { "id": "modal-test", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"], "description": "Mock conductor route + test conductor-toggle POST round-trip" },
    { "id": "hook-test", "files": ["ui/src/hooks/__tests__/useConductorEnabled.test.ts"], "description": "Test hook GET-seed + POST-on-setEnabled" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "ui/src/hooks/useConductorEnabled.ts", "symbol": "useConductorEnabled", "description": "Shared hook wrapping the conductor GET/POST route" },
    { "kind": "symbol-present", "file": "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "symbol": "ConductorControl", "description": "Toggle control rendering data-testid=conductor-toggle in a new Section" },
    { "kind": "named-test", "testFile": "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx", "testName": "toggling conductor-toggle POSTs and reflects the new value", "mechanical": true },
    { "kind": "named-test", "testFile": "ui/src/hooks/__tests__/useConductorEnabled.test.ts", "testName": "useConductorEnabled seeds from GET and POSTs on setEnabled", "mechanical": true }
  ],
  "outOfScope": ["Any src/ backend changes — the /api/supervisor/conductor route and get/setConductorEnabled already exist", "Surfacing the conductor toggle anywhere outside ProjectSettingsModal (e.g. CommandBar or MissionDetailPanel)"] }
```