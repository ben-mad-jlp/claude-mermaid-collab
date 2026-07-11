# Bug Review

Scope: session-todos blueprint-link feature (uncommitted diff vs HEAD 33e4209).

## Result: No introduced bugs found

All correctness-critical areas were verified against the diff and tests.

### Verified correct

- **completeTodosForTask filter** (`src/mcp/tools/session-todos.ts:422-429`): semantics are correct.
  - `if (todo.link?.blueprintId !== blueprintId) continue;` excludes other-blueprint and link-less todos (optional chaining yields `undefined !== blueprintId`).
  - `if (taskId !== undefined && todo.link.taskId !== undefined && todo.link.taskId !== taskId) continue;` — with a taskId: completes (bp,taskId) and blueprint-level (no taskId) todos, skips (bp,otherTask). With no taskId: completes all bp todos. Matches all 5 tests. No inversion.
  - Returns only newly-changed todos; writes only when `changed.length > 0`; already-completed skipped via `if (todo.completed) continue;`.

- **updateSessionTodo link tri-state** (`session-todos.ts:399-403`): `link === null` deletes, `link !== undefined` sets, key-absent leaves unchanged. Correct null vs undefined handling. Matches the three update tests.

- **addSessionTodo persistence** (`session-todos.ts:244` / `382`): `...(link ? { link } : {})` persists link only when provided; omits the key otherwise. Correct.

- **setup.ts MCP handlers**: `add_session_todo` forwards `link?: SessionTodoLink`; `update_session_todo` forwards `link?: SessionTodoLink | null` (preserving null-vs-undefined); `complete_linked_todos` validates `project/session/blueprintId` and forwards optional `taskId`. All broadcast `session_todos_updated`. Correct.

- **api.ts HTTP routes**: POST forwards `link` (undefined when absent — does NOT force `link: undefined` problematically since updateSessionTodo treats undefined as "leave"); PATCH forwards `{ text, completed, order, link }`. When client omits `link`, JSON parse yields `undefined` → left unchanged. Correct. Client `addSessionTodo` body uses `...(link ? { link } : {})`.

- **UI chip** (`SessionTodosSection.tsx` + `TodosTreeSection.tsx`): rendered under `{todo.link && (...)}`, so `todo.link!` in onClick/title cannot deref null. `e.stopPropagation()` present before `selectDocument`. No crash when link absent.

- **shortSlug regex** `/^(?:Implementing|Archive)\/(?:[^/]+\/)?(.+)$/`:
  - no-prefix input → no match → returns input unchanged. Correct.
  - `Implementing/rest` → `rest`. Correct.
  - `Archive/<slug>/rest/more` → `rest/more`. Correct.
  - `Implementing/Go/Wave 3/foo` → `Wave 3/foo` (matches test). Correct.

- **Schemas**: `addSessionTodoSchema`/`updateSessionTodoSchema` link object has `required: ['blueprintId']`; `completeLinkedTodosSchema` has `required: ['project','session','blueprintId']` with optional taskId. Correct shapes.

- **Types**: `SessionTodoLink` re-exported from `@/types` via `export * from './sessionTodo'`, so api.ts import resolves.

### Minor observation (not a bug, integration contract)

- The chip calls `selectDocument(todo.link.blueprintId)`. `selectDocument` sets `selectedDocumentId`, and `getSelectedDocument` matches `documents.find(d => d.id === selectedDocumentId)`. This requires `blueprintId` to be a document **id**. The skills (vibe-go/vibe-review) populate `blueprintId` from the blueprint doc id, so this is consistent — but if any caller ever stores a document *name* instead of its id, the chip click would select nothing (silent no-op, no crash). Worth keeping in mind; not an introduced correctness bug in this diff.
