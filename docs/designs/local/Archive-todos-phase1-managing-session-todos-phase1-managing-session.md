# Blueprint: Todos Phase 1 — Managing Session (cross-session assignment)

## Source Artifacts
- `design-todos-phase1-2` (Phase 1 section) + diagram `todos/managing-session-flow`
- Phase 0 (shipped, branch `feat/todos-upgrade-phase0`): per-project store with `ownerSession`/`assigneeSession`/status; `assign_session_todo` tool already exists.
- Grounded refs: broadcast emit `src/mcp/setup.ts:3731` + the todo routes in `src/routes/api.ts`; WS event type `src/websocket/handler.ts:54`; refetch guard `ui/src/App.tsx:882-884`; `list_sessions` `src/mcp/setup.ts:968` → `/api/sessions` `src/routes/api.ts:201`; UI `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx`.

**Scope (Phase 1):** make cross-session assignment *live + usable*. The data model + `assignTodo`/`assign_session_todo` already exist (Phase 0). This phase = (1) the live-update gap fix, (2) assignee picker + assign UI + toast, (3) a modest manager dashboard (group-by-assignee). NO managing-session role (any session assigns to any sibling). Full Kanban + notify-session's-Claude are deferred. Asana is Phase 2.

---

## 1. Structure Summary

### Files
- [ ] `src/websocket/handler.ts` — Modify: extend the `session_todos_updated` event type with optional `ownerSession?`/`assigneeSession?`.
- [ ] `src/routes/api.ts` — Modify: (a) the `session_todos_updated` broadcasts in the todo routes carry `ownerSession`/`assigneeSession`; (b) `/api/sessions` (`:201`) accepts an optional `project` filter.
- [ ] `src/mcp/setup.ts` — Modify: (a) todo dispatch broadcasts (`:3731` etc.) carry owner/assignee; (b) `list_sessions` (`:968`) accepts an optional `project` filter.
- [ ] `ui/src/App.tsx` — Modify: broaden the todo refetch guard (`:882-884`) to also refetch when `assigneeSession === me` or `ownerSession === me`; surface a toast when a todo is newly assigned to me.
- [ ] `ui/src/lib/api.ts` — Modify: `getSessions`/list helper accepts a `project` filter param (thread to `/api/sessions`).
- [ ] `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` — Modify: an **assignee picker** (sibling sessions in the project) + assign action (`patchSessionTodo({ assigneeSession })`); show assignee on the row (badge already exists).
- [ ] `ui/src/components/todos/ManagerDashboard.tsx` — Create: a view listing the current session's *owned* todos grouped by `assigneeSession` → status (P1.3, modest; not full Kanban).
- [ ] Tests: `src/__tests__/session-todos-broadcast.test.ts` (broadcast payload shape — if unit-testable) / a UI test for the refetch-guard predicate if extractable.

### Key shapes
```ts
// handler.ts — session_todos_updated event
{ type: 'session_todos_updated'; project: string; session: string;
  ownerSession?: string; assigneeSession?: string }
```
The refetch predicate (extract as a pure helper for testability):
`shouldRefetchTodos(evt, me) = evt.project === myProject && (evt.session===me || evt.ownerSession===me || evt.assigneeSession===me)`

### Interactions
Manager assigns (patch `assigneeSession`) → store write → broadcast now carries assignee → assignee's client (guard broadened) refetches + toasts → assignee updates status → broadcast carries owner → manager's client refetches. All on the existing per-project store + global WS broadcast (clients self-filter).

---

## 2. Function Blueprints

### Broadcast payload enrichment (api.ts + setup.ts)
**Change:** every `wsHandler.broadcast({ type:'session_todos_updated', project, session })` becomes `{ ..., ownerSession, assigneeSession }` using the affected todo's fields (the result of the create/update/assign call). For deletes/clear where multiple todos are affected, include the acting `session` (current behavior) and omit owner/assignee (the broadened guard still catches the acting session). For single-todo create/update/assign, include the todo's `ownerSession` + `assigneeSession`.
**Edge:** assign changes the assignee — broadcast must carry the NEW assignee (so the new assignee refetches) AND ideally the old one (so it drops it); v1: carry new assignee + owner; the old assignee refetches on its next interaction/reconnect (acceptable).
**Test:** assert the broadcast object for an assign includes `assigneeSession`.

### `shouldRefetchTodos(evt, ctx)` (App.tsx — extract pure helper)
**Pseudocode:** return `evt.type==='session_todos_updated' && evt.project===ctx.project && (evt.session===ctx.session || evt.ownerSession===ctx.session || evt.assigneeSession===ctx.session)`.
**Wire:** replace the inline `session === currentSession.name` check at `App.tsx:882-884` with this helper. On true → existing refetch. Additionally: if `evt.assigneeSession===me` AND the todo id wasn't in the local list before → toast "New todo assigned to you".
**Test:** table of events × me → expected boolean.

### `list_sessions` / `/api/sessions` project filter
**Pseudocode:** accept optional `project`; if present, filter `sessionRegistry.list()` to entries with matching `project`. Backwards-compatible (no param = all).
**Test:** with project set, only matching sessions returned.

### Assignee picker (TodosTreeSection)
**Pseudocode:** fetch sibling sessions via `api.getSessions({ project })` (minus self); render a small dropdown on each row (or in an expanded row) → on select, `patchSessionTodo(project, session, todo.id, { assigneeSession: picked })` (optimistic upsert). Show current assignee badge (exists). "Unassign" = set null.
**Edge:** assigning to self is allowed (owner=assignee). Picker lists sessions even if offline.

### `ManagerDashboard` (P1.3)
**Pseudocode:** `listTodos`/`getSessions` for the project; show todos where `ownerSession === me`, grouped by `assigneeSession` (unassigned bucket first), each group sub-grouped/sorted by status; quick status + reassign actions reuse the row controls. Modest list view, not a drag Kanban.
**Test:** grouping logic (pure) — todos → map<assignee, todos[]>.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: broadcast-payload
    files: [src/websocket/handler.ts, src/routes/api.ts, src/mcp/setup.ts]
    tests: []
    description: "Enrich session_todos_updated event with ownerSession/assigneeSession at all emit sites (api.ts todo routes + setup.ts dispatch) + extend the WS event type"
    parallel: true
    depends-on: []
  - id: list-sessions-project-filter
    files: [src/mcp/setup.ts, src/routes/api.ts]
    tests: []
    description: "Add optional `project` filter to list_sessions MCP tool + /api/sessions (backwards-compatible)"
    parallel: true
    depends-on: []
  - id: app-refetch-guard
    files: [ui/src/App.tsx]
    tests: [ui/src/App.refetch.test.ts]
    description: "Extract shouldRefetchTodos(evt,ctx) pure helper + broaden the todo refetch guard (App.tsx:882-884) to owner/assignee===me; toast when a todo is newly assigned to me"
    parallel: false
    depends-on: [broadcast-payload]
  - id: assign-ui
    files: [ui/src/lib/api.ts, ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx]
    tests: []
    description: "getSessions(project) client filter + assignee picker on todo rows (assign via patchSessionTodo({assigneeSession})), assignee badge, unassign"
    parallel: false
    depends-on: [list-sessions-project-filter]
  - id: manager-dashboard
    files: [ui/src/components/todos/ManagerDashboard.tsx]
    tests: [ui/src/components/todos/ManagerDashboard.test.tsx]
    description: "Manager view: owned todos grouped by assigneeSession -> status (modest list, not Kanban); reuse row status/reassign controls"
    parallel: false
    depends-on: [assign-ui]
```

### Execution Waves
- **Wave 1 (parallel):** `broadcast-payload`, `list-sessions-project-filter`
- **Wave 2:** `app-refetch-guard` (←broadcast-payload), `assign-ui` (←list-sessions-project-filter)
- **Wave 3:** `manager-dashboard` (←assign-ui)

### Summary
- Total tasks: 5
- Total waves: 3
- Max parallelism: 2

### Notes / risks
- **Highest value is `broadcast-payload` + `app-refetch-guard`** (the live-update gap) — ship these first; they make cross-session assignment actually work.
- Broadcast stays global (no per-session WS routing); clients self-filter via the broadened guard.
- Reassign-away: the OLD assignee won't auto-drop the todo until reconnect/next interaction (v1 acceptable; could broadcast old+new assignee later).
- Notifying the assignee's *Claude* is out of scope (no push primitive); the worker's Claude sees assignments on next `list_session_todos`.
- ManagerDashboard mount point (where it appears in the UI shell) — pick a sensible spot (a tab/panel); keep it modest. Full cross-session Kanban deferred.
- owner=assignee remains the default for self-created todos; nothing forces assignment.
