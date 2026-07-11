# Wave 1 Implementation (todos upgrade Phase 0)

## Tasks
- **todo-store** ✅ — Created `src/services/todo-store.ts`: per-project `bun:sqlite` store (`<project>/.collab/todos.db`), `Todo` type + `TodoStatus`, schema + indexes (owner/assignee/status), DB handle cache, per-project `withLock`. CRUD + `listTodos` (filters: session=owner OR assignee, ownerSession, assigneeSession, status, includeCompleted; excludes done by default), `createTodo` (uuid id, ord=maxOrd+10), `updateTodo` (status↔completed/completedAt sync; `completed:true`⇒done), `assignTodo`, `removeTodo`, `clearCompleted`, `reorder` (×10, in a transaction). `dependsOn`/`link` JSON columns; `asanaGid` reserved. `_closeProject` test helper. Test `src/services/__tests__/todo-store.test.ts` (10, `bun test`). Added it to `vitest.config.ts` exclude (bun:sqlite ⇒ bun test, not vitest Node).
- **todo-ui-types** ✅ — `ui/src/types/sessionTodo.ts`: upgraded `SessionTodo` (string id, ownerSession/assigneeSession, title, status enum, priority, dueDate, description, parentId, dependsOn, link, completedAt, asanaGid). Kept `text?` deprecated alias + `completed` for back-compat so components compile until `todo-ui-views` updates them.

## Verification
- `bun test todo-store`: **10/10 pass**.
- tsc: `todo-store.ts` clean.
- Note: the UI type change intentionally creates downstream type errors in todo components (`.text`, numeric `.id`) — **expected**, fixed by `todo-ui-views` (Wave 3). Blast radius documented in research (SessionTodosSection, TodosTreeSection, api.ts, sessionStore.ts, SessionTodosSection.test.tsx).

## Wave TSC
clean for the files completed this wave (todo-store.ts)
