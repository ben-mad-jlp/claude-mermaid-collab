I now have a complete picture. Here is the implementation blueprint.

## Blueprint: Show and clear the current conductor target in ProjectSettingsModal

### Context (what already exists)
- `ProjectSettingsModal.tsx` is the single home for per-project daemon settings. It already renders an **Autonomous conductor** `Section` (`ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx:306-308`) containing `ConductorControl` — a checkbox that fetches/toggles the conductor `enabled` flag.
- The conductor REST route already surfaces the pin: **GET** `/api/supervisor/conductor?project=` returns `{ project, enabled, targetMissionId }` (`src/routes/supervisor-routes.ts:900-904`), and **POST** accepts `{ project, targetMissionId: string | null }` (unpin with `null`) and echoes back the fresh `{ enabled, targetMissionId }` (`src/routes/supervisor-routes.ts:927-934`).
- The pin is *set* today only from the mission rail (`MissionCard`/`MissionDetail` in `missionShared.tsx`, `data-testid="mission-pin-conductor-btn"`). The modal has no way to see or clear it. This leaf adds a **read + clear** control, mirroring the existing `WatchdogControl` "clear → default" pattern (`ProjectSettingsModal.tsx:67-76`).
- The modal talks to routes through `apiGet`/`apiPost` from `./useConductorEnabled` (target `'local'`), not the store's serverId-scoped actions — the new control uses the same helpers.

### Change 1 — add `ConductorTargetControl` component
In `ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx`, add a new component immediately after `ConductorControl` (after line 232), modeled on `WatchdogControl`:

```tsx
// ── Conductor target-mission pin (read + clear) ──────────────────────────────
const ConductorTargetControl: React.FC<{ project: string }> = ({ project }) => {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const data = await apiGet(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`);
      if (!cancelled) setTarget((data?.targetMissionId as string | null | undefined) ?? null);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const clear = useCallback(() => {
    if (busy || !project || !target) return;
    setBusy(true);
    void (async () => {
      const data = await apiPost('/api/supervisor/conductor', { project, targetMissionId: null });
      setTarget((data?.targetMissionId as string | null | undefined) ?? null);
      setBusy(false);
    })();
  }, [busy, project, target]);

  return (
    <div data-testid="conductor-target-control" className={`flex items-center gap-2 text-3xs ${busy ? 'opacity-60' : ''}`}>
      <span className="text-gray-500 dark:text-gray-400">Pinned target:</span>
      {target ? (
        <span data-testid="conductor-target-current" className="font-mono text-gray-700 dark:text-gray-200" title={target}>
          {target.slice(0, 8)}
        </span>
      ) : (
        <span data-testid="conductor-target-current" className="italic text-gray-400 dark:text-gray-500">
          auto (no pin — the conductor picks its own target)
        </span>
      )}
      <button
        type="button"
        data-testid="conductor-target-clear"
        onClick={clear}
        disabled={busy || !target}
        className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
        title="Clear the pin — the conductor picks its own target mission again"
      >
        Clear
      </button>
    </div>
  );
};
```

Notes:
- `useCallback`/`useEffect`/`useState` are already imported (`ProjectSettingsModal.tsx:13`); `apiGet`/`apiPost` already imported (`:17`).
- Short-id display uses **leading** 8 hex (`target.slice(0, 8)`), per the repo's short-id convention.
- Clear button is disabled when there is no pin (`!target`), exactly like `WatchdogControl`'s clear disables on `value === null`.

### Change 2 — render it inside the Autonomous conductor section
In the same file, extend the existing `Section label="Autonomous conductor"` (`ProjectSettingsModal.tsx:306-308`) so it renders both controls:

```tsx
          <Section label="Autonomous conductor">
            <ConductorControl project={project} />
            <ConductorTargetControl project={project} />
          </Section>
```

(`Section` already stacks children with `flex flex-col gap-2` — `:236`.)

### Change 3 — extend the test mock + add a clear test
In `ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx`:

1. Add mutable target state next to `conductorEnabled` (`:30`):
   `let conductorTarget: string | null = null;`
2. Update the `/api/supervisor/conductor` mock branch (`:51-58`) so GET returns `targetMissionId: conductorTarget`, and POST updates `conductorTarget` when `targetMissionId` is present (still handling `enabled`), echoing `{ ok, project, enabled, targetMissionId }`.
3. Reset `conductorTarget = null;` in `afterEach` (`:62-66`).
4. Add a test `clears the pinned conductor target and POSTs targetMissionId null`: seed `conductorTarget = 'abcd1234-....'`, render the modal, assert `conductor-target-current` shows `abcd1234`, click `conductor-target-clear`, then assert a POST to `/api/supervisor/conductor` fired with `JSON.parse(init.body).targetMissionId === null`, and the display falls back to the "auto" text.

### Acceptance criteria (positive, citable)
1. `ConductorTargetControl` is defined in `ProjectSettingsModal.tsx` (a component that GETs `/api/supervisor/conductor` and reads `targetMissionId`).
2. `ConductorTargetControl` renders a `data-testid="conductor-target-current"` element and a `data-testid="conductor-target-clear"` button inside it.
3. The clear button's `onClick` POSTs `{ project, targetMissionId: null }` to `/api/supervisor/conductor` and re-seeds local state from the response.
4. The **Autonomous conductor** `Section` in `ProjectSettingsModal` renders `<ConductorTargetControl project={project} />` alongside `<ConductorControl />`.
5. A new named test in `ProjectSettingsModal.test.tsx` seeds a target, clicks `conductor-target-clear`, and asserts a POST with `targetMissionId === null` fired.

Run: `npm run test:ci -- ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx`.

```json
{ "schemaVersion": 2, "estimatedFiles": 2, "estimatedTasks": 3,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx",
    "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"
  ],
  "tasks": [
    { "id": "add-conductor-target-control", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx"], "description": "Add ConductorTargetControl component that GETs targetMissionId and clears it via POST targetMissionId:null" },
    { "id": "render-in-conductor-section", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx"], "description": "Render ConductorTargetControl inside the Autonomous conductor Section next to ConductorControl" },
    { "id": "test-show-and-clear", "files": ["ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx"], "description": "Extend conductor mock with targetMissionId and add a clear-target test asserting POST targetMissionId null" }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "ui/src/components/supervisor/bridge/ProjectSettingsModal.tsx", "symbol": "ConductorTargetControl", "description": "The read+clear control for the conductor target pin" },
    { "kind": "named-test", "testFile": "ui/src/components/supervisor/bridge/ProjectSettingsModal.test.tsx", "testName": "clears the pinned conductor target and POSTs targetMissionId null", "mechanical": true }
  ],
  "outOfScope": [
    "Setting/pinning a target from the modal (pin lives in the mission rail; this leaf only shows + clears)",
    "Changing the conductor REST routes or store actions (GET already returns targetMissionId; POST already accepts targetMissionId:null)",
    "Resolving the target mission id to a human title (short-id display only)"
  ] }
```