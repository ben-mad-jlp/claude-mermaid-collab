# Completeness Review (todos Phase 1)

All 5 blueprint tasks are implemented and verified against the actual code. **0 true gaps.**

## Task-by-task

### 1. broadcast-payload ✅
- Event type extended: `src/websocket/handler.ts:54` — `session_todos_updated` now has optional `ownerSession?`/`assigneeSession?`.
- `src/routes/api.ts` single-todo emit sites all carry owner/assignee: create (`:2574-2580`), PATCH (`:2672-2678`), DELETE (`:2701-2707`, snapshots via `getTodo` before removal; `getTodo` imported at `:26`). Multi-todo ops carry `session` only: clear-completed (`:2600`), reorder (`:2629`) — matches spec.
- `src/mcp/setup.ts` dispatch sites: add/update/toggle/remove/**assign** all carry owner/assignee. The ASSIGN case (`:3814`) carries the new `assigneeSession` from `assignSessionTodo` result — the key case. Multi-todo ops (clear-completed `:3789`, reorder `:3801`, complete_linked_todos `:3824`) carry `session` only — matches spec.

### 2. list-sessions-project-filter ✅
- `/api/sessions` reads `?project=` and filters (`src/routes/api.ts:206-207`), backwards-compatible.
- `list_sessions` MCP tool: optional `project` param in schema (`src/mcp/setup.ts:1086`), `listSessions(project?)` appends `?project=` (`:968-971`), dispatch passes it (`:2650`).

### 3. app-refetch-guard ✅
- `ui/src/lib/todoEvents.ts` present with `shouldRefetchTodos(evt, ctx)` pure helper (project match AND session/owner/assignee === me).
- `ui/src/App.tsx:884-885` uses the helper (replacing the narrow guard); refetches MY list via `getSessionTodos(project, me, true)` (`:889`); info toast on newly-assigned todos diffed against prev ids (`:893-903`).
- Tests pass (5/5).

### 4. assign-ui ✅
- `ui/src/lib/api.ts`: `getSessions(project?)` appends `?project=` (`:141-153`); `patchSessionTodo` `assigneeSession: string | null` (`:104`, `:673`).
- `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx`: siblings fetched once (`:297-305`, graceful failure); per-row `<select>` picker (`:185-202`) calling `handleAssign` → optimistic upsert + `patchSessionTodo({ assigneeSession })` with rollback (`:73-77`); assign/unassign/(me) options.

### 5. manager-dashboard ✅
- `ui/src/components/todos/ManagerDashboard.tsx` exists — filters `ownerSession === me`, groups by assignee with per-status dot summary (read-only).
- `ui/src/lib/todoGrouping.ts`: `groupByAssignee` (unassigned bucket first, then alphabetical, ordered within) + `statusCounts`.
- Mounted via "Manager" toggle in `TodosTreeSection` (`:408-415` checkbox, `:463-466` renders `<ManagerDashboard>` instead of the flat list). Reuses already-loaded `sessionTodos` — no App.tsx surgery.
- Tests pass (2/2).

## Tests
`bun run test:ci src/lib/todoEvents.test.ts src/lib/todoGrouping.test.ts` → **7/7 pass** (5 + 2).

## Stubs
None. No TODO / 'Not implemented' / throw-stub in any new file.

## No-regression
- Phase-0 broadcasts still carry `project` + `session` (added fields are additive/optional).
- The assignee picker `<select>` is `shrink-0`, stops click propagation, and degrades gracefully if `getSessions` fails — does not break the row. Existing `orderedTodos`/`visibleTodos` filtering intact.

## Deviations confirmed (NOT gaps, all per blueprint)
- No managing-session role (any session assigns to any sibling).
- Full Kanban deferred; ManagerDashboard is a modest list-grouped toggle.
- Reassign-away old-assignee live-drop deferred (old assignee drops on next interaction/reconnect).
- Diagrams skipped (collab render endpoint erroring server-side — `DOMPurify.addHook`).
