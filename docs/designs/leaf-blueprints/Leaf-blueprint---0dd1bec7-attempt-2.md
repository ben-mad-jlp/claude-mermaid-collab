# Blueprint — DF4: Bridge dogfood-health panel

## Goal
Surface the (currently silent) dogfood backlog in the Bridge: a small read-only panel
showing **friction_trends.recurring** (top recurring reasons + counts, grouped by layer),
the **unlanded-epic count** (a clear call-to-action when over a threshold), and the
**stale-worktree count**. Modeled on `ExecutorStatsPanel` (slow bounded poll + `ws` nudge,
self-contained `fetch`, ONE-card chrome — no new store wiring, no new ws event).

## Reality grounding (what already exists)

- **friction_trends data** — `src/services/friction-trends.ts` exports
  `frictionTrends(project, opts)` returning `FrictionTrends` whose `.recurring` is
  `Array<{ layer: FrictionLayer; retryReason: string; count: number }>` (most-recurring
  first) and `.byLayer` is `FrictionLayerGroup[]`. **No HTTP route exposes it yet** — it is
  only an MCP tool. → must add a route.
- **unlanded epics** — `GET /api/supervisor/unlanded-epics?project=` already exists
  (`src/routes/supervisor-routes.ts:99`), returns `{ unlandedEpics: Array<{ branch; epicId8; ahead }> }`.
  Backed by `getWorktreeManager(project).listUnlandedEpics()` (`src/agent/worktree-manager.ts:754`).
- **stale worktrees** — `WorktreeManager.listStaleWorktrees(opts)` exists
  (`src/agent/worktree-manager.ts:780`) returning
  `Array<{ path; branch; reason: 'branch-gone'|'prunable'|'stale'; ageMs }>`.
  **No HTTP route exposes it yet.** → must add a route.
- **Pattern to copy** — `ui/src/components/supervisor/bridge/ExecutorStatsPanel.tsx`:
  self-contained `fetch` with a `cancelled` flag + `refetchNonce`, a `POLL_MS = 15000`
  bounded `setInterval`, a ws `session_todos_updated` nudge bumping the nonce, ONE-card
  chrome (`m-3 mb-0 rounded-lg border …`). Mounted as a Bridge tab in
  `BridgeDashboard.tsx` (`bridgeTab` union + tab button list + render block).
- **Test pattern** — `ExecutorStatsPanel.test.tsx`: `mockFetchRouter` keyed by URL
  substring, `vi.mock('@/lib/websocket')` stub, vitest + `@testing-library/react`.

## Changes

### 1. Backend — two read-only HTTP routes (`src/routes/supervisor-routes.ts`)

Add both inside `handleSupervisorRoutes`, next to the existing `unlanded-epics` route
(after the block ending at line 109). Mirror its try/empty-on-error shape (never error the
Bridge on a non-git/transient project).

**(a) friction-trends route**
```ts
// FRICTION TRENDS — recurrence rollup over the friction store (DF4). Read-only; the
// `recurring` shortlist + per-layer counts feed the Bridge dogfood-health panel.
if (url.pathname === '/api/supervisor/friction-trends' && req.method === 'GET') {
  const project = url.searchParams.get('project');
  if (!project) return jsonError('project query param is required', 400);
  try {
    const { frictionTrends } = await import('../services/friction-trends.ts');
    const limitRaw = Number(url.searchParams.get('limit'));
    const trends = frictionTrends(project, Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {});
    return Response.json(trends);
  } catch {
    return Response.json({ total: 0, considered: 0, byLayer: [], recurring: [] });
  }
}
```

**(b) stale-worktrees route**
```ts
// STALE WORKTREES — abandoned linked worktrees (branch-gone / prunable / aged-out).
// Pure git read (DF4). Read-only; never prunes. [] off non-git / on error.
if (url.pathname === '/api/supervisor/stale-worktrees' && req.method === 'GET') {
  const project = url.searchParams.get('project');
  if (!project) return jsonError('project query param is required', 400);
  try {
    const staleWorktrees = await getWorktreeManager(project).listStaleWorktrees();
    return Response.json({ staleWorktrees });
  } catch {
    return Response.json({ staleWorktrees: [] });
  }
}
```
`getWorktreeManager` is already imported (line 35). `frictionTrends` is imported lazily
(matches the file's existing lazy-import style for service helpers).

### 2. New component — `ui/src/components/supervisor/bridge/DogfoodHealthPanel.tsx`

Read-only panel, self-contained fetch (NO store wiring), modeled on `ExecutorStatsPanel`.

- Props: `{ project?: string; serverScope?: string }` (serverScope accepted for call-site
  parity even though, like ExecutorStatsPanel's fetch, requests go to relative `/api/...`).
- Local state: `trends: FrictionTrends | null`, `unlandedCount: number | null`,
  `staleCount: number | null`, `loading`, `refetchNonce`.
- Define local interfaces mirroring the server shapes (don't import backend types):
  ```ts
  interface FrictionTrends {
    total: number; considered: number;
    byLayer: Array<{ layer: string; count: number;
      reasons: Array<{ retryReason: string; count: number; sessions: string[]; lastAt: string }> }>;
    recurring: Array<{ layer: string; retryReason: string; count: number }>;
  }
  ```
- Three `useEffect` fetches keyed on `[project, refetchNonce]`, each with a `cancelled`
  flag (copy ExecutorStatsPanel's exact shape):
  - `/api/supervisor/friction-trends?project=…` → `setTrends(d)`
  - `/api/supervisor/unlanded-epics?project=…` → `setUnlandedCount((d?.unlandedEpics ?? []).length)`
  - `/api/supervisor/stale-worktrees?project=…` → `setStaleCount((d?.staleWorktrees ?? []).length)`
  Guard with `if (!project) return;`.
- ws nudge: `getWebSocketClient().onMessage` → bump nonce on `session_todos_updated`
  (copy lines 273–279 verbatim).
- Bounded poll: `setInterval(() => setRefetchNonce(n => n+1), 15000)` (copy lines 283–286).
- `const UNLANDED_THRESHOLD = 2;` — call-to-action when `unlandedCount > UNLANDED_THRESHOLD`.

Render (ONE card, copy ExecutorStatsPanel chrome):
```tsx
<div className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40">
```
- Header row: `<span className="text-[10px] uppercase tracking-wide text-gray-400">dogfood health</span>`
  + an `aria-label="Refresh dogfood health"` ↺ button (`data-testid="dogfood-health-refresh"`,
  `onClick={() => setRefetchNonce(n => n+1)}`) and `loading…` italic while `loading && !trends`.
- **Two count tiles** (reuse a local `Tile` like ExecutorStatsPanel's, or a small inline pair):
  - `data-testid="dogfood-unlanded"` — label "Unlanded epics", value `String(unlandedCount ?? 0)`.
    When `(unlandedCount ?? 0) > UNLANDED_THRESHOLD`, render the call-to-action treatment:
    amber tile value (`text-amber-600 dark:text-amber-400`) PLUS a one-line CTA band below the
    tiles, e.g. `data-testid="dogfood-unlanded-cta"` text
    `"{n} epics stranded off master — land them (Bridge ▸ Land tab)"` in the same amber band
    style as FleetVitals' unlanded surface (`card-pulse-amber` / amber border). Amber, NOT red
    (one-red rule: red reserved for escalations).
  - `data-testid="dogfood-stale-worktrees"` — label "Stale worktrees", value `String(staleCount ?? 0)`,
    amber value when `> 0`.
- **Recurring-friction list** — `data-testid="dogfood-recurring"`:
  - Empty state: when `(trends?.recurring.length ?? 0) === 0` render an italic
    `"No recurring friction."` (gray, like ExecutorStatsPanel's empty line).
  - Else: section label `recurring friction` (uppercase `text-2xs text-gray-400`), then
    `trends.recurring.slice(0, 6).map(...)` one row each:
    `{r.retryReason}` (truncate) · muted `{r.layer}` tag · right-aligned `×{r.count}`
    (tabular-nums). Use `key={`${r.layer}:${r.retryReason}`}`.
  - Optional quiet footer line: `byLayer` summary
    `{trends.byLayer.map(l => `${l.layer} ${l.count}`).join(' · ')}` as `text-2xs text-gray-500`.
- `export default DogfoodHealthPanel;` AND a named export.

Match ExecutorStatsPanel's tailwind vocabulary (text-2xs/3xs, tabular-nums, dark: variants).

### 3. Mount in the Bridge (`ui/src/components/supervisor/bridge/BridgeDashboard.tsx`)

- Add import (next to line 47): `import { DogfoodHealthPanel } from './DogfoodHealthPanel';`
- Extend the `bridgeTab` union type (line 416) to add `| 'dogfood'`.
- Add a tab button entry in the tab list array (line 501–512), after `{ key: 'executor', label: 'Executor' }`:
  `{ key: 'dogfood', label: 'Dogfood' }`.
- Add the render block alongside the others (after the `executor` block, line 573–577):
  ```tsx
  {bridgeTab === 'dogfood' && (
    <div className="p-2">
      <DogfoodHealthPanel project={project} serverScope={serverScope} />
    </div>
  )}
  ```

### 4. Test — `ui/src/components/supervisor/bridge/DogfoodHealthPanel.test.tsx`

Mirror `ExecutorStatsPanel.test.tsx`: `vi.mock('@/lib/websocket')` stub + `mockFetchRouter`
keyed by URL substring (`'friction-trends'`, `'unlanded-epics'`, `'stale-worktrees'`).
Cover:
- (a) recurring rows render from mocked `friction-trends` payload (reason text + `×count`).
- (b) empty recurring → "No recurring friction." shown.
- (c) unlanded count over threshold → the amber CTA band (`dogfood-unlanded-cta`) appears;
  at/under threshold → it does not.
- (d) stale-worktree count tile renders the mocked length.
Set `global.fetch = mockFetchRouter({...})` in each test; `afterEach(() => vi.restoreAllMocks())`.

## Verification
- `npm run test:ci -- ui/src/components/supervisor/bridge/DogfoodHealthPanel.test.tsx`
- Backend: routes are read-only and wrapped in try/empty — no new test strictly required,
  but a sanity `curl`-equivalent is the route returning the service shape; covered by the
  service's existing `friction-trends.test.ts` for the rollup itself.
- `npx tsc --noEmit` (ui is Bun-managed — do NOT `npm install`).

## Notes / constraints
- No new ws event (reuse `session_todos_updated`, per b2fe36b1).
- One-red rule: unlanded/stale CTAs are AMBER; red stays reserved for escalations.
- Self-contained fetch (no supervisorStore additions) keeps this panel a leaf like
  ExecutorStatsPanel; the existing `unlandedEpicsByProject` store slice is left untouched
  (FleetVitals continues to use it independently).

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 4,
  "nonEnumerableFanout": false,
  "filesToCreate": [
    "ui/src/components/supervisor/bridge/DogfoodHealthPanel.tsx",
    "ui/src/components/supervisor/bridge/DogfoodHealthPanel.test.tsx"
  ],
  "filesToEdit": [
    "src/routes/supervisor-routes.ts",
    "ui/src/components/supervisor/bridge/BridgeDashboard.tsx"
  ],
  "tasks": [
    { "id": "backend-routes", "files": ["src/routes/supervisor-routes.ts"], "description": "Add read-only GET /api/supervisor/friction-trends and /api/supervisor/stale-worktrees routes" },
    { "id": "panel-component", "files": ["ui/src/components/supervisor/bridge/DogfoodHealthPanel.tsx"], "description": "New read-only DogfoodHealthPanel (recurring friction + unlanded CTA + stale count), modeled on ExecutorStatsPanel" },
    { "id": "mount-tab", "files": ["ui/src/components/supervisor/bridge/BridgeDashboard.tsx"], "description": "Add Dogfood tab to bridgeTab union, tab list, and render block" },
    { "id": "panel-test", "files": ["ui/src/components/supervisor/bridge/DogfoodHealthPanel.test.tsx"], "description": "Vitest covering recurring rows, empty state, unlanded CTA threshold, stale count" }
  ] }
```
