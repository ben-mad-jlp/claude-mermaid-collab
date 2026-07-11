# Wave 3 Implementation (todos upgrade Phase 0)

## Task
- **todo-ui-views** ✅ — wired the UI to the upgraded model + modest viewing upgrade.
  - `ui/src/lib/api.ts`: `addSessionTodo` text→title + opts ({status,assigneeSession,priority,dueDate,description,link}); `patchSessionTodo` id string + new fields; `removeSessionTodo` id string; `reorderSessionTodos` string[]; `getSessionTodos` gains status/assignee filter params.
  - `ui/src/stores/sessionStore.ts`: `removeSessionTodoLocal(id)` number→string (rest of slice already type-clean on the new `SessionTodo`).
  - `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx`: replaced the binary checkbox with a **status-cycle control** (backlog→todo→in_progress→blocked→done, colored), `.text`→`.title`, `#{id}`→`id.slice(0,6)`, inline assignee/priority/dueDate badges, and a **filter row** (status `<select>` + "Assigned to me"). done = `status==='done' || completed`. Diagram `Implementing/Go/Wave 3/todo-ui-views/TodosTreeSection.tsx`.
  - **Removed dead code:** `ui/src/components/layout/SessionTodosSection.tsx` + its test — confirmed unused (only its own test imported it; the active component is TodosTreeSection). It was obsoleted by the model change; deleting cleared 12 tsc errors. (git-tracked, recoverable.)

## Verification
- tsc: all touched UI files clean (api.ts, sessionStore.ts, TodosTreeSection.tsx, sessionTodo.ts). SessionTodosSection errors gone (deleted).
- Tests: SessionTodosSection.test removed with its component. (No dedicated TodosTreeSection test exists; live render is a manual check.)
- Note: full UI `tsc`/build still has PRE-EXISTING unrelated errors (Onboarding/Pseudo/agentStore) — not from this work.

## Wave TSC
clean for this wave's files
