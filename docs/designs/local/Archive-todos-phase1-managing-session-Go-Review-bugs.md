# Bug Review (todos Phase 1)

Scope: introduced-bug review (correctness only) of the uncommitted `feat/todos-upgrade-phase0` changes. Ran the new unit tests (7/7 pass) and `tsc --noEmit` (no errors in any changed file; all reported errors are pre-existing in unrelated files: editors, onboarding, SplitPane, etc.).

## Findings

### 1. Minor — Assignee `<select>` misrepresents an out-of-list assignee
`ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx:185-202`
The `<select value={todo.assigneeSession ?? ''}>` only renders options for `""` (placeholder) + entries in `siblings`. If a todo is assigned to a session that is NOT in `siblings` (archived/removed session, or `siblings` not yet loaded / fetch failed), there is no matching `<option>`, so the browser falls back to displaying the first option ("✕ unassign"). The styling still shows the purple "assigned" pill (driven by `todo.assigneeSession` truthiness), but the dropdown text claims it can be unassigned to a value that does not represent the real assignee. It does not corrupt data (onChange only fires on user action), purely a display inconsistency.
Fix: when `todo.assigneeSession` is truthy and not in `siblings`, render an extra `<option value={todo.assigneeSession}>→ {todo.assigneeSession}</option>` so the current value is always representable.

### 2. Minor — Toast can double-fire under rapid concurrent events (no data corruption)
`ui/src/App.tsx:879-909`
Each `session_todos_updated` event captures its own `prevIds` from the store snapshot, then fires an independent `getSessionTodos` fetch. Two events arriving close together run two in-flight fetches; both call `setSessionTodos` (last-write-wins, consistent because each fetch returns the full list) but both may compute a non-empty `newlyAssigned` for the same todo and each show a toast. Result: duplicate "New todo assigned to you" toasts. Not a correctness/data bug; cosmetic.
Fix (optional): coalesce in-flight refetches (a ref guard / latest-event-wins) or dedupe toasts by todo id.

## Verified correct (specifically scrutinized, no bug)

- **`prevIds` snapshot timing (App.tsx:888)**: Captured before the async fetch resolves — correct for the "newly assigned" diff. The whole point is to compare the list as it was BEFORE this event's refetch against the list after.
- **Self-assignment toast guard (App.tsx:893-894)**: Assigning an existing todo to myself does not toast, because the todo's id is already in `prevIds` (`!prevIds.has(t.id)` is false). Toast only fires for ids newly appearing in my list with `assigneeSession === me`. Correct.
- **Refetches MY list, not `evt.session` (App.tsx:889)**: Uses `me = currentSession.name` and relies on the server's owner-OR-assignee filter. Correct for cross-session assignment.
- **`.catch` on the refetch (App.tsx:905)**: Error is logged, not swallowed silently into a broken state. Fine.
- **Broadcast payloads (api.ts:2578-2580, 2675-2677, 2705-2706; setup.ts)**: `assigneeSession: todo.assigneeSession ?? undefined` is correct — DB stores `string | null`, the WS type is `string?` (optional), and `shouldRefetchTodos` compares with `===`, where `undefined` correctly never matches a real session name. Using `?? undefined` (vs leaving `null`) keeps it consistent with the optional type.
- **DELETE snapshot via `getTodo` (api.ts:2698)**: `getTodo` is imported from `../services/todo-store` (api.ts:26), is synchronous, keyed by (project, id), returns `Todo | null`. Null case handled with `deletedTodo?.ownerSession` / `?? undefined`. Correct.
- **setup.ts remove broadcast (`result?.ownerSession`)**: `removeSessionTodo` returns `Todo | null`; optional chaining used. Other paths return non-null `Todo`. Correct.
- **`shouldRefetchTodos`**: Matches its tests; project gate first, then session/owner/assignee OR. Correct.
- **`groupByAssignee` map-init `(map.get(key) ?? map.set(key,[]).get(key)!)`**: Works — `map.set` returns the Map, `.get(key)!` returns the just-inserted array. Unassigned-first + alpha sort + per-group order sort all correct and test-covered.
- **`statusCounts`**: Defaults missing status via `t.status ?? (t.completed ? 'done' : 'todo')`. Correct; test-covered. Empty list returns `{}` (no crash). `ManagerDashboard` `Object.entries(counts)` on `{}` renders nothing — fine.
- **`ManagerDashboard` empty/odd data**: `owned.length === 0` early-returns. `STATUS_DOT[t.status ?? ...]` always resolves to a known key. No crash path found.
- **TodosTreeSection assignee onChange rollback (lines 72-83)**: Optimistic upsert, awaits patch, re-upserts server result; on error rolls back to the original `todo`. `e.target.value === ''` → `null` (unassign). `onClick stopPropagation` (line 188) prevents the row's edit-on-click. Correct.
- **siblings useEffect (lines 297-305)**: `cancelled` flag guards the async setState; cleanup sets it; dep `currentSession?.project` is appropriate. No leak.
- **list_sessions project filter**: Backwards compatible — no param → all sessions (`projectFilter` null → returns `all`). MCP `listSessions(project?)` builds `?project=` only when provided; `getSessions(project?)` in api.ts likewise. Correct.

## Known design gap (NOT a new bug — flagged per the brief)

Reassign-AWAY: when a todo moves from old assignee → new assignee, the broadcast carries only the NEW `assigneeSession` (plus owner). The OLD assignee's session matches none of session/owner/new-assignee in `shouldRefetchTodos`, so it does NOT refetch and the stale todo lingers in the old assignee's list until another event or manual refresh. This is consistent with the documented design (broadcast carries current owner/assignee only), not an implementation defect.
