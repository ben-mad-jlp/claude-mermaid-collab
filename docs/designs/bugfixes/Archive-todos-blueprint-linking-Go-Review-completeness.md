# Completeness Review — Link Session Todos to Blueprints / Go Sessions

**Result: Everything complete. 0 gaps found.** All 9 tasks across 3 waves implemented with real (non-stub) code; both test files pass.

## Per-task verification

### Wave 1
- **todos-backend** (`src/mcp/tools/session-todos.ts`): `SessionTodoLink` (43-46) + `link?` on `SessionTodo` (40); `addSessionTodo` 4th param `link?` (232, set 247); `updateSessionTodo` `updates.link?: SessionTodoLink | null` with null=clear/object=set (260, 276-280); `completeTodosForTask` (378-399) matches blueprintId + optional taskId, skips completed, writes only on change; `addSessionTodoSchema` (82-90) + `updateSessionTodoSchema` (104-112) extended; `completeLinkedTodosSchema` exported (117-126). ✓
- **ui-todo-type** (`ui/src/types/sessionTodo.ts`): `SessionTodoLink` + `link?` (1-11), re-exported via `@/types`. ✓
- **skill-vibe-checkpoint** (`skills/vibe-checkpoint/SKILL.md`): step calls `list_session_todos` includeCompleted:false (40), appends open todos with `↳ {blueprintId} · {taskId}` (46). ✓

### Wave 2
- **mcp-wiring** (`src/mcp/setup.ts`): imports `completeTodosForTask`/`completeLinkedTodosSchema`/`SessionTodoLink` (73,81); `add_session_todo` threads link (3708-3715); `update_session_todo` threads link (3721-3731); `complete_linked_todos` tool declared (1940-1942) + handler calls `completeTodosForTask` and broadcasts `session_todos_updated` (3781-3789). ✓
- **api-routes** (`src/routes/api.ts`): POST `/api/session-todos` reads+passes `link` (2542-2556); PATCH `/api/session-todos/:id` passes `link` (2626-2643). ✓
- **ui-api-store** (`ui/src/lib/api.ts`): `addSessionTodo` optional `link` param + conditional body (102,645-649); `patchSessionTodo` updates type accepts `link?: SessionTodoLink | null` (103,665). Store needed no change (components call api directly; `upsertSessionTodo` stores full returned todo). ✓

### Wave 3
- **ui-todo-rows**: chip rendered in `SessionTodosSection.tsx` (142-149) and `sidebar-tree/TodosTreeSection.tsx` (135-142); clickable via `selectDocument(todo.link.blueprintId)` with `e.stopPropagation()`; `shortSlug` helper; `#id` prefix retained. ✓
- **skill-vibe-go** (`skills/vibe-go/SKILL.md`): step 4.7 calls `complete_linked_todos { blueprintId, taskId }` per completed task (349-354). ✓
- **skill-vibe-review** (`skills/vibe-review/SKILL.md`): "Add as todo" passes `link.blueprintId` (475); deferred completeness gaps filed as linked todos, shelved-only (456-459). ✓

## Design-goal check
- Link-only model (no graph mutation): satisfied.
- 4 skill wirings (vibe-go complete, vibe-review add+deferred, vibe-checkpoint snapshot): all present.
- Standalone `complete_linked_todos` MCP tool: present (decl + handler + broadcast).
- Chip opens blueprint doc: clickable, calls `selectDocument(blueprintId)` in both row variants.

## Tests
- `src/mcp/tools/__tests__/session-todos.test.ts`: **45 passed** (incl. link persistence, set/clear, completeTodosForTask matrix).
- `ui/src/components/layout/__tests__/SessionTodosSection.test.tsx`: **13 passed** (incl. 3 chip tests: renders with link / absent without / click→selectDocument). Run via `cd ui && bun run test:ci` (UI uses bun + vitest 0.34, not the root backend vitest).
- No `Not implemented`/stub markers in any changed source file.
