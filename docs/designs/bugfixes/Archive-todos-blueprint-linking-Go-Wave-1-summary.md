# Wave 1 — todos↔blueprint linking

## Tasks
- **todos-backend** (`src/mcp/tools/session-todos.ts` + test): added `SessionTodoLink` + optional `link?` on `SessionTodo`; threaded `link` through `addSessionTodo` (4th param) and `updateSessionTodo` (`updates.link?: SessionTodoLink | null`, null clears); added `completeTodosForTask(project, session, blueprintId, taskId?)`; extended add/update schemas + added `completeLinkedTodosSchema`.
- **ui-todo-type** (`ui/src/types/sessionTodo.ts`): added `SessionTodoLink` + optional `link?`; auto re-exported via `@/types` barrel.
- **skill-vibe-checkpoint** (`skills/vibe-checkpoint/SKILL.md`): new step calls `list_session_todos` (includeCompleted:false), appends up to ~10 open todos as `#{id} {text}` (+ `↳ blueprintId · taskId`) to Currently Doing; steps renumbered.

## Verification
- `session-todos.test.ts`: **45 tests pass** (incl. new link persistence, set/clear, and `completeTodosForTask` matrix).
- tsc: no errors in `session-todos.ts` or `sessionTodo.ts` (backend + ui).

## Wave TSC
Clean for changed files.
