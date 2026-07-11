# Wave 2 Implementation (todos upgrade Phase 0)

## Tasks
- **todo-migration** ✅ — `src/services/todo-migration.ts`: `migrateProject(project)` enumerates `.collab/sessions/*/session-todos.json`, sorts by order, `createTodo`s each into the store (ownerSession=assigneeSession=session, completed→status, link carried), writes a legacy-id→uuid sidecar (`session-todos.migrated.json`), renames source `.json.migrated`. Idempotent. Test (3, bun test) + vitest exclude.
- **todo-api** ✅ — `src/routes/api.ts` session-todos routes repointed to `todo-store`: GET adds owner/assignee/status filters; POST accepts title/text + status/assignee/priority/dueDate/description (ownerSession=session); PATCH & DELETE `/:id` regex `(\d+)`→`([^/]+)` (string id, no parseInt); clear-completed uses `{removed}`; reorder takes string[] (no session arg). Broadcast unchanged. Diagram `Implementing/Go/Wave 2/todo-api/api.ts`.
- **todo-mcp** ✅ — `src/mcp/tools/session-todos.ts`: all tool fns delegate to `todo-store` (kept export names; re-exports `Todo as SessionTodo`, `TodoLink as SessionTodoLink`); schemas id number→string, new fields, new `assignSessionTodoSchema`/`assignSessionTodo`. `src/mcp/setup.ts`: dispatch updated (string ids, new fields, new `assign_session_todo` case + tool registration). Diagram `Implementing/Go/Wave 2/todo-mcp/session-todos.ts`.

## Verification
- bun tests: **13/13** (todo-store 10, todo-migration 3).
- tsc on touched files: clean, EXCEPT one **pre-existing unrelated** error `api.ts:692` (`pair_mode_changed` WS-type union mismatch — different code region, outside the edited imports + session-todos routes).

## Wave TSC
clean for this wave's changes (pre-existing api.ts:692 pair_mode_changed noted, not introduced here)
