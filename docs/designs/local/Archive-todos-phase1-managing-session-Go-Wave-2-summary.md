# Wave 2 Implementation (todos Phase 1)

## Tasks
- **app-refetch-guard** ✅ — the live cross-session update fix. New pure helper `ui/src/lib/todoEvents.ts` (`shouldRefetchTodos(evt, ctx)` = project match AND session/owner/assignee === me) + 5 tests. `ui/src/App.tsx` `session_todos_updated` handler: replaced the narrow `session===currentSession` guard with the helper; **refetches MY list** (`getSessionTodos(project, me)` — server filters owner-OR-assignee) rather than the event's owner session; shows an info toast when a todo is newly assigned to me (diff against prev ids).
- **assign-ui** ✅ — `ui/src/lib/api.ts`: `getSessions(project?)` appends `?project=`; `patchSessionTodo` `assigneeSession` widened to `string | null` (for unassign). `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx`: section fetches sibling sessions (`getSessions(project)`) once and passes them to rows; each row's assignee badge is now a compact `<select>` picker (assign to a sibling / "(me)" / ✕ unassign) → optimistic `upsertSessionTodo` + `patchSessionTodo({ assigneeSession })` with rollback.

## Verification
- `todoEvents.test.ts`: 5/5 pass.
- tsc: all touched UI files clean (App.tsx, todoEvents.ts, api.ts, TodosTreeSection.tsx). (Fixed one cast: `message as unknown as TodoUpdatedEvent`.)
- Diagrams skipped — the collab diagram render endpoint was erroring server-side (`DOMPurify.addHook is not a function`); non-blocking.

## Result
broadcast-payload (W1) + app-refetch-guard (W2) together close the live cross-session update gap: assigning a todo to another session now refreshes that session's UI + toasts. assign-ui makes assignment doable from the todo list.

## Wave TSC
clean for this wave's files
