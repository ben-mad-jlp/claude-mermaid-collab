# Wave 2 — todos↔blueprint linking

## Tasks
- **mcp-wiring** (`src/mcp/setup.ts`): imported `completeTodosForTask`/`completeLinkedTodosSchema`/`SessionTodoLink`; threaded `link` through `add_session_todo` + `update_session_todo` cases; registered `complete_linked_todos` tool (declaration + handler case → `completeTodosForTask` + `session_todos_updated` broadcast).
- **api-routes** (`src/routes/api.ts`): imported `SessionTodoLink`; POST `/api/session-todos` passes `link` to `addSessionTodo`; PATCH `/api/session-todos/:id` includes `link` in `updateSessionTodo` updates.
- **ui-api-store** (`ui/src/lib/api.ts`): `addSessionTodo` gains optional `link` (conditional POST body); `patchSessionTodo` updates type accepts `link?: SessionTodoLink | null`. Store needed **no change** — components call the api directly and `upsertSessionTodo` stores the full returned todo (link included).

## Verification
- tsc clean: no errors in `setup.ts`, `api.ts` (backend) or `lib/api.ts` (ui).

## Wave TSC
Clean for changed files.
