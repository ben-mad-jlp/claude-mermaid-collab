# Blueprint — `ui/src/hooks/useStatusSync.ts` (status-sync centralization for List/Kanban/Plan)

## Scope (this leaf ONLY)

Implement **only** `ui/src/hooks/useStatusSync.ts` (+ its colocated vitest).
This is a split child of leaf `bccd8c87`. Sibling leaves own the consumer
components (`PlanPanel`, `PlanWorkspace`, `BridgeDashboard`, `ManagerDashboard`,
`useTaskGraph`) and the claim-lifecycle bug `75f7e304`. **Do not edit them.**

## Root cause (verified by reading the code)

`useStatusSync` is mounted ONCE at App root (`ui/src/App.tsx:310`,
`useStatusSync(servers.map(s => s.id))`) and is the only app-wide owner of the
`session_todos_updated` → todo-refresh signal. The four views diverge because
they get todo state from **different update paths**:

- **FleetGraph** (`bridge/fleet/`) is hosted by `BridgeDashboard.tsx`, which has
  its OWN private `client.onMessage` handler (`BridgeDashboard.tsx:168-170`)
  that calls `loadProjectTodos(serverScope, msg.project)` on **any**
  `session_todos_updated`. So the graph refreshes whenever the Bridge is mounted.
- **Plan list / Plan kanban** — `PlanPanel.tsx:123-140` and
  `PlanWorkspace.tsx:34-51` read `todosByProject[project]` reactively from
  `supervisorStore`, but only call `loadProjectTodos` in a mount/`serverId`
  effect (`PlanPanel.tsx:138`, deps `[serverId, project, loadProjectTodos]`).
  They have **no** `session_todos_updated` subscription of their own.
- **Manager/Kanban** (`todos/ManagerDashboard.tsx:22`) receives `todos` as a
  prop derived from `todosByProject` by its parent — also no WS subscription.

`todosByProject` is a single zustand slice (`supervisorStore.ts:424`,
`loadProjectTodos` at `:861` does `set(state => ({ todosByProject: {...state.todosByProject, [project]: ...} }))`,
producing fresh object + array refs). **Any** writer of that slice re-renders
**all** subscribers. So the fix is: `useStatusSync` must be the reliable,
non-clobbering, app-root writer of `todosByProject` on every
`session_todos_updated`, so List/Kanban/Plan-kanban stay in lockstep with the
graph WITHOUT each owning a private WS handler.

The current `session_todos_updated` case (`useStatusSync.ts:84-90`) already calls
`loadProjectTodos` — but has a **multi-server clobber bug**: it loops EVERY
watched server id and reloads the same `project` from each. A watched server that
does not track `project` still returns `200 { todos: [] }`, and because
`loadProjectTodos` unconditionally writes `todosByProject[project] = res.body.todos ?? []`
on any `ok` response, the last (non-owning) server's empty array **wipes** the
slice — the views render an empty/stale plan. FleetGraph survives because its
private handler reloads from the single correct `serverScope` afterward.

> NOTE — "Plan **graph**" caveat: `TaskGraphView.tsx` uses a SEPARATE hook
> `useTaskGraph` (`hooks/useTaskGraph.ts`) that fetches `/api/.../task-graph` and
> folds a `task_graph_updated` CustomEvent payload — a different data source, not
> `todosByProject`. Re-wiring that hook is **sibling-leaf scope** and is out of
> this file. This leaf fixes the `todosByProject`-backed views (Plan list, Plan
> kanban, Manager kanban) which is what shares state with the graph.

## Change shape — `useStatusSync.ts`

Edit ONLY the `case 'session_todos_updated':` block in the WS-ingest dispatcher
(`useStatusSync.ts:84-90`). Keep everything else (escalation/summary/tick ingest,
bootstrap hydrate, refs, `freshnessStore.noteWsMessage()`) unchanged.

Replace the unconditional all-servers loop with a clobber-safe refresh:

1. Extract `project` (guard non-empty string) — unchanged.
2. Compute the candidate server set: `serverIdsRef.current.length ? serverIdsRef.current : ['local']`.
3. **Prefer the server(s) that already track this project** to avoid the
   empty-response clobber: read the current store snapshot
   `const known = useSupervisorStore.getState().todosByProject;` — if
   `known[project]` is a non-empty array, only reload the watched servers (the
   owning server's reload will repopulate it; a non-owning server's empty write
   is the hazard). Concretely: keep reloading all candidate servers BUT do it so
   a later empty response cannot win. Two acceptable implementations — pick (a):

   **(a) Sequential, owner-biased (recommended, in-file only):** iterate the
   candidate ids, `await loadProjectTodos(id, project)` one at a time, and after
   each await, if `useSupervisorStore.getState().todosByProject[project]?.length`
   is now > 0, **stop** (the owning server answered; don't let a subsequent
   non-owner overwrite it). Because the loop body is async, wrap it in an
   `void (async () => { ... })()` IIFE so the `onMessage` callback stays sync.

   ```ts
   case 'session_todos_updated': {
     const project = typeof msg.project === 'string' ? msg.project : '';
     if (!project) break;
     const ids = serverIdsRef.current.length ? serverIdsRef.current : ['local'];
     void (async () => {
       for (const id of ids) {
         await useSupervisorStore.getState().loadProjectTodos(id, project);
         // Owner-bias: once a server has returned a non-empty plan, stop so a
         // later non-owning server's empty response cannot clobber the slice.
         if (useSupervisorStore.getState().todosByProject[project]?.length) break;
       }
     })();
     break;
   }
   ```

   Rationale: single-server ('local') case is unchanged behavior (one reload);
   multi-server case stops clobbering. This keeps List/Kanban/Plan-kanban
   (all reading `todosByProject[project]`) live app-wide off the SAME signal the
   graph uses — they no longer depend on the Bridge being mounted.

Do **not** introduce intervals/polling/new WS event types (preserves the
constraint documented in the file header, b2fe36b1). Do not change the store
(`supervisorStore.ts`) — `loadProjectTodos`'s `!ok` early-return already
preserves prior state; the owner-bias above neutralizes the `ok`-but-empty case
without a store edit.

## Test — `ui/src/hooks/__tests__/useStatusSync.test.ts` (NEW, vitest)

There is no existing test for this hook. Add one mirroring the project's vitest +
`@testing-library/react` `renderHook` conventions (see
`ui/src/hooks/__tests__/useTaskGraph.test.ts` for the WS/CustomEvent mocking
style, and `supervisorStore.test.ts` for store mocking).

Mock surface:
- `vi.mock('@/lib/websocket', ...)` exporting `getWebSocketClient()` returning a
  fake client with `onConnect` and `onMessage` that capture the registered
  handlers into module-level vars and return `{ unsubscribe: vi.fn() }`.
- Spy `useSupervisorStore.getState().loadProjectTodos` (and `hydrateOpenEscalations`,
  `hydrateSessionSummaries` as no-op resolved promises) and a controllable
  `todosByProject` snapshot. `useFreshnessStore`/`useDaemonPulse` can be real or
  trivially mocked.

Cases:
1. **Centralized refresh:** `renderHook(() => useStatusSync(['srvA']))`, fire the
   captured `onMessage` with `{ type: 'session_todos_updated', project: '/p' }`;
   assert `loadProjectTodos` is called with `('srvA', '/p')`. (await a microtask
   tick for the async IIFE.)
2. **Empty `serverIds` → 'local' fallback:** `useStatusSync([])` + same event →
   `loadProjectTodos('local', '/p')`.
3. **Owner-bias / no clobber:** `useStatusSync(['owner','other'])` where the
   mocked `loadProjectTodos('owner', …)` sets `todosByProject['/p']` to a
   non-empty array; assert `loadProjectTodos` is NOT subsequently called for
   `'other'` (loop short-circuits), so the empty server can't wipe the plan.
4. **Ignore unrelated/no-project messages:** event with no `project`, and an
   unrelated `type`, do not call `loadProjectTodos`.

Run with `npm run test:ci -- ui/src/hooks/__tests__/useStatusSync.test.ts`
(ui/ is Bun-managed — never `npm install`).

## Acceptance

Driving a todo `in_progress → accepted` emits `session_todos_updated`;
`useStatusSync` (App-root) reloads `todosByProject[project]` from the owning
server without clobber, so Plan list, Plan kanban, and Manager kanban re-render
in lockstep with FleetGraph. Vitest above proves the centralized,
non-clobbering refresh. (Plan-graph `useTaskGraph` rewiring and claim-lifecycle
`75f7e304` are sibling leaves.)

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 2,
  "nonEnumerableFanout": false,
  "filesToCreate": ["ui/src/hooks/__tests__/useStatusSync.test.ts"],
  "filesToEdit": ["ui/src/hooks/useStatusSync.ts"],
  "tasks": [
    { "id": "fix-session-todos-case", "files": ["ui/src/hooks/useStatusSync.ts"], "description": "Replace the all-servers loop in the session_todos_updated case with an owner-biased async refresh that stops once a server returns a non-empty plan, preventing empty-response clobber of todosByProject." },
    { "id": "add-vitest", "files": ["ui/src/hooks/__tests__/useStatusSync.test.ts"], "description": "New vitest: centralized refresh fires loadProjectTodos, 'local' fallback on empty serverIds, owner-bias short-circuit (no clobber), and ignores no-project/unrelated messages." }
  ] }
```
