# Disposition Note: be1b0c01 — Bridge Project Mismatch

## ARM 1 — typed Finding rows

Three finding rows were created in the tracking-root `.collab/findings.db` to document the bridge
project mismatch defect. These rows do **not** exist in this worktree's `.collab/findings.db` (0 bytes
here — worktree DBs are per-worktree scratch, not synced from the tracking root).

The three rows, queried from the tracking root:

```sql
51fd5265-1de0-4e87-adc0-2715e6fe708d|8fee81ab-c4cf-4d14-adda-4a3efd693e38|The Header's session-select handler (App.tsx:1390-1395) does not call useUIStore's setActiveProject, so BridgeDashboard.tsx:139's activeProjectPref ?? currentSession?.project prefers the stale pinned project after a top-nav project switch, and every Bridge mission surface (MissionStrip, MissionDetailPanel, useMissions) renders the wrong project's missions with no visual indication of the mismatch.|["ui/src/App.tsx","ui/src/components/supervisor/bridge/BridgeDashboard.tsx","ui/src/stores/uiStore.ts"]|ui/src/components/supervisor/bridge/rail/__tests__/__quarantine__/missionRailProjectMismatch.repro.test.tsx|9bc600f5-e658-4ac0-88cd-8acdb5e06237|2026-08-12T02:51:28.378Z
3304934e-655b-4f4f-9517-8b5393fe7dd9|1a1006b7-7e3c-478a-bc13-7f2c28b20c04|The Header's session-select handler does not call setActiveProject.|["ui/src/App.tsx","ui/src/components/supervisor/bridge/BridgeDashboard.tsx","ui/src/stores/uiStore.ts"]|ui/src/components/supervisor/bridge/rail/__tests__/__quarantine__/missionRailProjectMismatch.repro.test.tsx|9bc600f5-e658-4ac0-88cd-8acdb5e06237|2026-08-12T03:00:10.330Z
ad6b70b4-6adf-4d99-80e3-c138431d7fbd|41b84f16-28c7-431f-81bc-671d9def0cf3|The Header's session-select handler (App.tsx:1390-1395) does not call useUIStore's setActiveProject, so BridgeDashboard.tsx:139's activeProjectPref ?? currentSession?.project keeps preferring a stale pinned project after a top-nav project switch, and every Bridge mission surface (MissionStrip, MissionDetailPanel) renders the wrong project's missions with no visual indication of the mismatch.|["ui/src/App.tsx","ui/src/components/supervisor/bridge/BridgeDashboard.tsx","ui/src/stores/uiStore.ts"]|ui/src/components/supervisor/bridge/rail/__tests__/__quarantine__/missionRailProjectMismatch.repro.test.tsx|9bc600f5-e658-4ac0-88cd-8acdb5e06237|2026-08-12T03:04:03.719Z
```

**Finding store location and write path:**

- **Store path**: `.collab/findings.db` (opened at `src/services/finding-store.ts:66` via `openDb(join(project, '.collab', 'findings.db'))`)
- **Write path**: `file_finding` MCP verb → `src/mcp/workgraph-tools.ts` `fileFindingLeaf` → `src/services/finding-store.ts` `recordFinding`
- **Why separate from collab.db**: The finding rows live in `.collab/findings.db`, not `.collab/collab.db`. Verified in this worktree: `sqlite3 .collab/collab.db ".tables"` lists no `finding` table. The path split is why the rows previously read as absent when a query targeted the wrong DB (collab.db instead of findings.db).

## ARM 2 — fixed at HEAD

The defect has been fixed at HEAD. The fix adds the missing `setActiveProject` call to reconcile both
session and activeProject state when the user switches projects via the Header dropdown.

**Fix location — `ui/src/App.tsx:1392-1398`** (`handleSessionSelect`):

```typescript
// Handle session selection from Header dropdown
const handleSessionSelect = useCallback(
  (session: Session) => {
    reconcileScopeOnSessionSelect(session, { setCurrentSession, setActiveProject });
  },
  [setCurrentSession, setActiveProject]
);
```

**Fix implementation — `ui/src/lib/sessionScope.ts:3-11`** (`reconcileScopeOnSessionSelect`):

```typescript
export function reconcileScopeOnSessionSelect(
  session: Session,
  { setCurrentSession, setActiveProject }: {
    setCurrentSession: (session: Session) => void;
    setActiveProject: (project: string | null) => void;
  }
): void {
  setCurrentSession(session);
  setActiveProject(session.project ?? null);
}
```

The fix ensures both `setCurrentSession(session)` and `setActiveProject(session.project ?? null)` are
called. This resolves the stale `activeProjectPref` preference in `BridgeDashboard.tsx:139`, which
computes its project scope as `activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? ''`.

**Spec reference**: `ui/src/components/supervisor/bridge/rail/__tests__/missionRailProjectMismatch.test.tsx`
— the un-quarantined test spec (the three finding rows point to its quarantined sibling
`__quarantine__/missionRailProjectMismatch.repro.test.tsx`, which no longer exists in this tree).

**Test result**: Running the spec locally:

```
 ✓ src/components/supervisor/bridge/rail/__tests__/missionRailProjectMismatch.test.tsx  (3 tests) 77ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

All three tests pass:
1. "follows the current session's project after a reconciled Header switch" — verifies both currentSession and activeProject are updated
2. "after reconciliation, fetches and loads the switched project's mission data" — verifies Bridge fetches from the correct project
3. "a pin-only activeProject update (no session change) still scopes Bridge to the pinned project" — verifies the pin mechanism still works independently

## ARM 3 — live check

A live running app was reachable at `http://localhost:9002/api/supervisor/bridge-snapshot?project=/Users/benmaderazo/Code/claude-mermaid-collab`
at UTC 2026-08-12T05:17:46Z. The response top-level keys were:

```json
{
  "projects": [...],
  "missions": [...],
  "openEscalations": [...],
  "todos": [...],
  "coverage": {...},
  "summaries": [...]
}
```

**DOM selectors from the spec** (`missionRailProjectMismatch.test.tsx`):

1. **`[data-testid="bridge-rail"]`** — defined at `ui/src/components/supervisor/bridge/rail/BridgeRail.tsx:161`
   - The `<aside>` root container that holds the mission rail UI
   - Test assertion (line 197): `expect(screen.getByTestId('bridge-rail')).toBeInTheDocument();`

2. **`[data-testid="mission-status-pill"]`** — defined at `ui/src/components/supervisor/bridge/rail/missionShared.tsx:87`
   - The `StatusPill` component that renders mission status with color coding and tooltip
   - Test assertions document expected behavior for switched-project vs. stale-pinned-project cases:
     - Line 141–167: After session switch via `reconcileScopeOnSessionSelect`, Bridge fetches from the **switched project** (not stale)
     - Line 169–207: Bridge loads mission data from the switched project and renders it
     - Line 209–226: If only activeProject changes (pin without session change), Bridge renders the pinned project despite currentSession being on a different project

Both DOM selectors resolve through the test's mock `useMissions` hook, which returns different mission data based on the active project.

## Provenance

The ARM 3 observations came from two distinct sources and must not be conflated:
- **Live running app**: The curl response to `http://localhost:9002/api/supervisor/bridge-snapshot?project=/Users/benmaderazo/Code/claude-mermaid-collab` (top-level JSON shape and timestamp).
- **jsdom via @testing-library/react**: The vitest run of `missionRailProjectMismatch.test.tsx` (DOM selectors, component renders, and test assertions).
