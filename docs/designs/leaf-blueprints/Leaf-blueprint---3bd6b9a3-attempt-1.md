# Blueprint — `ui/src/stores/supervisorStore.ts`: a single canonical todo-status update source

Leaf `3bd6b9a3` (split child of `bccd8c87`). **Implement ONLY** `ui/src/stores/supervisorStore.ts`
(+ its colocated vitest `ui/src/stores/supervisorStore.test.ts`). Do **not** touch the view
components or backend — those are sibling split children.

## Context / root cause (read first)

The parent symptom: while the daemon drives an epic, the **FleetGraph** (Bridge) repaints
todo status colors live, but the **List**, **Kanban**, and **Plan graph** (all in
`PlanWorkspace → PlanPanel`) stay stale.

Both surfaces ultimately read the SAME store slice `todosByProject[project]`:
- Bridge FleetGraph: `BridgeDashboard.tsx:247-250` — `useMemo(() => (todosByProject[project] ?? []).filter(...), [todosByProject, project])`.
- Plan views: `PlanPanel.tsx:123-127` — `const todos = todosByProject[project] ?? []` (no memo key on an update token; derivations `waveMap`/`tree`/`byIdAll` memo on `[todos]`).
- The live refresh fires through `useStatusSync.ts:87-92` (app-wide) and `BridgeDashboard.tsx:168-171` (Bridge-local), both calling `loadProjectTodos(serverId, project)` on the `session_todos_updated` WS event.

The store **write itself is referentially correct** (`loadProjectTodos` builds a fresh
`{ ...state.todosByProject, [project]: [...] }` with a brand-new array), so Zustand DOES
notify subscribers. The fragility the four views suffer from is **each view inventing its own
read + memo-key discipline**: there is no single exported selector and no monotonic update
token they can all key derivations on, so a view that memoizes on a value other than the array
ref (or reads `todosByProject` without the same filter) silently goes stale. The fix is to give
the store **ONE canonical read path + ONE monotonic update token** that every view (in the
sibling leaves) subscribes to — making the update source literally identical across all four.

**Out of scope for this file (do NOT attempt here):**
- Refactoring `PlanPanel.tsx` / `PlanKanban.tsx` / `BlueprintGraph`/`FleetGraph` to consume the
  new selector — those are sibling split children of `bccd8c87`.
- The claim-lifecycle contradiction `75f7e304` (a leaf reads both `in-flight` AND `ready`). That
  is a **backend** bug in `src/services/*` (`claimability.ts` / `coordinator-*`), not this UI
  store. Leave it to its own leaf; note it in the PR description as a dependency.

## Change shape (this file only)

All edits are in `ui/src/stores/supervisorStore.ts`.

### 1. Stable empty-todos constant (avoid a fresh `[]` per read)
Near the top-level module constants (by `PROJECTS_KEY` etc., ~line 278), add:

```ts
import type { SessionTodo } from '@/types/sessionTodo'; // already imported (line 2)

/** Stable empty reference for projects with no loaded todos — so `selectProjectTodos`
 *  returns a referentially-stable value (a fresh `[]` per render would defeat memo
 *  equality and force needless re-derivation in every subscribing view). */
const EMPTY_TODOS: readonly SessionTodo[] = Object.freeze([]);
```
(Mirrors `EMPTY_DRAFT`/`EMPTY_STATE` in `composerDraftStore.ts` / `tabsStore.ts`.)

### 2. Monotonic `todosEpoch` token on the state
In `interface SupervisorState` (near `todosByProject`, ~line 424) add:

```ts
  /** Monotonic generation counter bumped on EVERY `todosByProject` write (mirrors
   *  `hydrateEpoch` for escalations). The single update token all four todo-status
   *  surfaces (List / Kanban / Plan-graph / FleetGraph) key their memoized
   *  derivations + subscriptions on, so a live `session_todos_updated`-driven
   *  reload repaints every view in lockstep. */
  todosEpoch: number;
```

In the `create<SupervisorState>(...)` initializer (by `todosByProject:` ~line 606) add:
```ts
  todosEpoch: 0,
```

### 3. Bump `todosEpoch` on the canonical write
`loadProjectTodos` (lines 861-878) is the **sole writer** of `todosByProject`. In its first
`set((state) => { ... })` (lines 865-869) add the bump alongside the existing write:

```ts
    set((state) => {
      const todosByProject = { ...state.todosByProject, [project]: res.body?.todos ?? [] };
      localStorage.setItem(TODOS_KEY, JSON.stringify(todosByProject));
      return { todosByProject, todosEpoch: state.todosEpoch + 1 };
    });
```
(The unlanded-epics follow-up `set` lower in the same fn does NOT touch todos — leave it.)

### 4. Canonical exported selector
At module scope **after** the `useSupervisorStore` definition (end of file, after line 1197),
export a curried selector so every view reads through ONE function (the "same update source"):

```ts
/** THE canonical read for a project's work-graph todos. Every todo-status surface
 *  (List / Kanban / Plan-graph / FleetGraph) MUST select through this — one update
 *  source keeps all four in lockstep with the live `session_todos_updated` reload.
 *  Returns the stable EMPTY reference (not a fresh `[]`) when nothing is loaded. */
export const selectProjectTodos =
  (project: string) =>
  (s: SupervisorState): readonly SessionTodo[] =>
    s.todosByProject[project] ?? EMPTY_TODOS;

/** Selector for the monotonic todo update token — subscribe to this to re-run a
 *  derivation on any todo change without diffing the array. */
export const selectTodosEpoch = (s: SupervisorState): number => s.todosEpoch;
```

> Note: `SupervisorState` is currently a non-exported `interface` (line 421). Either add
> `export` to it so the selector return-type annotations are usable by sibling-leaf imports,
> OR keep the selectors' parameter typed and rely on inference. **Prefer adding `export` to
> `interface SupervisorState`** (zero behavior change; sibling leaves consuming `selectProjectTodos`
> need the type). This is the only signature-visibility change.

## Tests — `ui/src/stores/supervisorStore.test.ts`

Append a new `describe` block (keep the existing `setSupervisedLocal` suite). Reset state in
`beforeEach` via `useSupervisorStore.setState({ todosByProject: {}, todosEpoch: 0 })`. Assert:

1. `selectProjectTodos('/repo')(state)` returns the **same** `EMPTY_TODOS` ref on two calls for
   an unloaded project (referential stability — `toBe`, not just `toEqual`).
2. After `setState({ todosByProject: { '/repo': [todo] } })`, `selectProjectTodos('/repo')`
   returns that array and `selectProjectTodos('/other')` still returns the stable empty ref.
3. **The reactivity contract**: stub `invoke` (or set state directly to simulate the write) and
   drive `loadProjectTodos` → assert `selectTodosEpoch` **strictly increased** and
   `selectProjectTodos(project)` reflects the new todos. Use the existing `vi` import; mock
   `window.mc`/`fetch` the way the WS/escalation suites do, or call `setState` to emulate the
   resolved write and assert the epoch+selector together. The load-bearing assertion is
   "one write ⇒ epoch advances ⇒ selector returns fresh data" — that is the single update source
   the four views subscribe to.

Use a minimal `SessionTodo` factory (cast a partial: `{ id, title, status } as SessionTodo`),
matching how the file already builds `Escalation`/`SupervisedSession` fixtures.

## Verify
`cd ui && bun run test:ci -- src/stores/supervisorStore.test.ts` (ui/ is **Bun-managed — never
npm install**). Also `bunx tsc --noEmit` style check is implied by the repo's UI typecheck.

```json
{ "schemaVersion": 1, "estimatedFiles": 2, "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": ["ui/src/stores/supervisorStore.ts", "ui/src/stores/supervisorStore.test.ts"],
  "tasks": [
    { "id": "empty-const", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Add frozen EMPTY_TODOS stable-empty constant" },
    { "id": "epoch-state", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Add todosEpoch field to SupervisorState + initializer (0)" },
    { "id": "epoch-bump", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Bump todosEpoch in loadProjectTodos' todos write" },
    { "id": "selectors", "files": ["ui/src/stores/supervisorStore.ts"], "description": "Export selectProjectTodos + selectTodosEpoch; export SupervisorState interface" },
    { "id": "vitest", "files": ["ui/src/stores/supervisorStore.test.ts"], "description": "Vitest: selector stability + epoch-advances-on-write reactivity contract" }
  ] }
```
