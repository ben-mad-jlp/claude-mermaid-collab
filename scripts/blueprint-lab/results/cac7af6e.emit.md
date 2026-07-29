<!-- blueprint-lab-emit model=sonnet effort=medium -->
## Blueprint: Conductor toggle in ProjectSettingsModal + shared `useConductorEnabled` hook

### Context found

- Backend is already fully wired: `getConductorEnabled`/`setConductorEnabled` in `src/services/supervisor-store.ts:465-475`, and the REST route `GET/POST /api/supervisor/conductor` in `src/routes/supervisor-routes.ts:880-898` (body `{ project, enabled }`, response `{ project, enabled }` for GET, `{ ok, project, enabled }` for POST). Default is OFF (unset ⇒ `false`).
- **No UI consumer exists yet** — `useConductorEnabled` does not exist anywhere in the repo, and no component currently calls `/api/supervisor/conductor`.
- `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx` is the single home for per-project daemon settings; each concern is its own small `React.FC<{project: string}>` control rendered inside a `<Section label="...">` wrapper (see `WatchdogControl`, `ContextRecycleControl`, `InjectionFlags` at lines 33-225, mounted at lines 295-305). The file already has local `apiGet`/`apiPost` helpers (lines 18-30) that go through `window.mc.invokeOnServer` when present, else plain `fetch` — the new control must use the same dual path for desktop-bridge compatibility.
- Hooks live in `ui/src/hooks/*.ts` (e.g. `useFleetStatus.ts`, `useSettings.ts`). `useFleetStatus.ts:47-90` is the closest precedent for a small per-project polling/mutation hook using the `window.mc.invokeOnServer` / `fetch` fallback pattern.
- `ProjectSettingsModal.test.tsx` mocks fetch per-URL substring (`mockFetch`, lines 31-51) and is the pattern to extend for the new control's route (`/api/supervisor/conductor`).

### Change shape

**1. New file `ui/src/hooks/useConductorEnabled.ts`**

Export a hook with this shape (mirroring `useFleetStatus`'s dual-path fetch, but GET+POST like `ProjectSettingsModal`'s local helpers):

```ts
export interface UseConductorEnabledReturn {
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  setEnabled: (next: boolean) => void;
}

export function useConductorEnabled(project: string | undefined): UseConductorEnabledReturn
```

- Internal `apiGet`/`apiPost` helpers identical in shape to `ProjectSettingsModal.tsx:18-30` (through `window.mc.invokeOnServer` else `fetch`), duplicated locally in the hook (do not import from the component file — hooks must not depend on component-local helpers).
- On mount / `project` change: `GET /api/supervisor/conductor?project=<encoded>`, seed `enabled` from `data.enabled` (`!!data.enabled`), set `loading=false`.
- `setEnabled(next)`: optimistically set state, set `busy=true`, `POST /api/supervisor/conductor` with `{ project, enabled: next }`, reconcile from the response's `enabled` field, `busy=false`.
- Guard: no-op if `project` is falsy (mirrors `useFleetStatus`'s `if (!project)` early return).
- Cancellation flag (`cancelled`) on unmount, same pattern as `useFleetStatus`.

**2. Edit `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx`**

- Add import: `import { useConductorEnabled } from '@/hooks/useConductorEnabled';` (check the alias used elsewhere in this file — `DaemonNodesMatrix`/`DaemonProviderControl` use `@/components/...`, so `@/hooks/useConductorEnabled` matches the existing alias convention).
- Add a new control component in the same file, following the `WatchdogControl`/`ContextRecycleControl` shape:

```tsx
const ConductorToggle: React.FC<{ project: string }> = ({ project }) => {
  const { enabled, busy, setEnabled } = useConductorEnabled(project);
  return (
    <label className="flex items-center gap-2 text-3xs text-gray-700 dark:text-gray-200 cursor-pointer">
      <input
        type="checkbox"
        data-testid="conductor-enabled-toggle"
        checked={enabled}
        disabled={busy}
        onChange={(e) => setEnabled(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
      />
      <span className="font-medium">Autonomous conductor</span>
      <span className="text-gray-400 dark:text-gray-500">Run the conductor pass for this project.</span>
    </label>
  );
};
```

- Mount it in a new `<Section label="Conductor">` block inside the modal body (`ProjectSettingsModal.tsx:281-306`), e.g. right after the "Node models & provider" section and before "Watchdog":

```tsx
<Section label="Conductor">
  <ConductorToggle project={project} />
</Section>
```

**3. Edit `ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx`**

- Add a `/api/supervisor/conductor` branch to `mockFetch` (mirrors the `injection-flags` GET/POST branch at lines 42-49): GET returns `{ project: '/abs/p', enabled: false }`; POST reads `{ enabled }` from the body, updates a module-level `conductorState`, returns `{ ok: true, project: '/abs/p', enabled: conductorState }`.
- Add one test: renders `conductor-enabled-toggle`, clicking it flips `checked` to `true` and asserts a POST to `/api/supervisor/conductor` fired with `enabled: true` (same assertion shape as the existing digest-flag test at lines 75-97).

### Out of scope
- No changes to `src/routes/supervisor-routes.ts` or `src/services/supervisor-store.ts` — both already implement the full contract.
- No other consumer of `useConductorEnabled` is wired in this leaf (e.g. `BridgeDashboard.tsx` badges) — the hook is built shared/reusable but only the modal consumes it here.

```json
{ "schemaVersion": 2, "estimatedFiles": 3, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/hooks/useConductorEnabled.ts"],
  "filesToEdit": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"],
  "tasks": [
    { "id": "hook", "files": ["ui/src/hooks/useConductorEnabled.ts"], "description": "Add useConductorEnabled hook wrapping GET/POST /api/supervisor/conductor" },
    { "id": "modal-toggle", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx"], "description": "Add ConductorToggle control + Conductor Section using the new hook" },
    { "id": "test", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"], "description": "Mock /api/supervisor/conductor and assert toggle POSTs enabled:true" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "ui/src/hooks/useConductorEnabled.ts", "symbol": "useConductorEnabled", "description": "shared hook must exist and be exported" },
    { "kind": "symbol-present", "file": "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "symbol": "ConductorToggle", "description": "modal must render a conductor toggle control wired to the hook" },
    { "kind": "named-test", "testFile": "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx", "testName": "toggling conductor-enabled-toggle POSTs and reflects the new value", "mechanical": true }
  ],
  "outOfScope": ["no backend changes (route + store already implemented)", "no other UI surface wired to useConductorEnabled in this leaf"] }
```