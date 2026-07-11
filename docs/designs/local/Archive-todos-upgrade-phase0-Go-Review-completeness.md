# Completeness Review (todos Phase 0)

Verdict: **Substantially complete — 1 real gap** (the migration is defined/tested but never invoked at runtime). All other tasks/files/functions present, real, non-stub. 13/13 store+migration tests pass.

## Tasks (6/6 implemented)
- todo-store ✅ — `src/services/todo-store.ts` real
- todo-ui-types ✅ — `ui/src/types/sessionTodo.ts` upgraded
- todo-migration ✅ (code) — `src/services/todo-migration.ts` real, idempotent — **but not wired (gap below)**
- todo-api ✅ — `src/routes/api.ts` repointed to todo-store
- todo-mcp ✅ — `src/mcp/tools/session-todos.ts` + `src/mcp/setup.ts`
- todo-ui-views ✅ — `ui/src/lib/api.ts`, `sessionStore.ts`, `TodosTreeSection.tsx`

## Files verified (exist + real)
- todo-store.ts: schema+3 indexes (DDL lines 93-115), CRUD, `listTodos` filters (session=owner OR assignee, ownerSession, assigneeSession, status, includeCompleted; excludes done by default — line 194), `withLock` per-project mutex (141-147), status↔completed sync in updateTodo (228-231), DB handle cache (117).
- todo-migration.ts: `migrateProject` idempotent (skips on `.migrated`/sidecar — line 46), ownerSession=assigneeSession=session, completed→status, legacy-id→uuid sidecar.
- api.ts: imports from `'../services/todo-store'` (line 32, NOT old session-todos), `/:id` regex `([^/]+)` string (2635/2679), GET filters owner/assignee/status (2519-2532), POST/PATCH new fields.
- session-todos.ts: all fns delegate to todo-store (import line 21); `assignSessionTodo` (325) + `assignSessionTodoSchema` (185) present, non-stub.
- setup.ts: `assign_session_todo` registered (1947-1949) AND dispatched (`case 'assign_session_todo'` 3802, calls assignSessionTodo 3810); imports assignSessionTodo (74) + schema (83).
- TodosTreeSection.tsx: status-cycle control (75-132), `.title` (70/72/98), assignee/priority/due badges (166-179), filter row — status select + assigned-to-me (249/273-277/342-347), optimistic update (77-84) via `patchSessionTodo({status})`.
- sessionTodo.ts: field-for-field match with todo-store `Todo` (ownerSession, assigneeSession, status enum, priority, dueDate, description, parentId, dependsOn, link, completedAt, asanaGid).

## Functions present + non-stub
todo-store: createTodo, listTodos, getTodo, updateTodo, assignTodo, removeTodo, clearCompleted, reorder — all real.
migration: migrateProject — real.
mcp: assignSessionTodo — real.

## Tests
`bun test todo-store.test.ts todo-migration.test.ts` → **13 pass / 0 fail** (matches expected 13).

## Stubs
None. No TODO / 'Not implemented' / throw-stub in todo-store.ts or todo-migration.ts.

## GAP (1)
### G1 — migration defined but never invoked at runtime (real gap)
- **Specified:** Blueprint §2 (todo-migration): "Call from `todo-store` first-open (or server startup)"; task graph description: "invoked on store first-open"; risk note: "migration must be idempotent + run before first read".
- **Missing:** `migrateProject` is only referenced by its own test. `grep -rn migrateProject src/` shows zero call sites outside the test. `openDb` (todo-store.ts:119-129) does NOT call it; no server-startup call exists.
- **Impact:** Legacy per-session `session-todos.json` files will never be imported into the new per-project store. Existing todos silently disappear from the UI until a migration is triggered.
- **Location:** should be wired in `src/services/todo-store.ts:openDb` (e.g. once-per-project guard around `migrateProject(project)` after `db.exec(DDL)`), or at server startup. Currently absent.

## Noted deviations (NOT gaps — per blueprint)
- owner=assignee initially (managing-session UX = Phase 1) — OK.
- Asana = Phase 2, `asanaGid` column reserved only — OK.
- Full Kanban/board deferred — OK.
- Dead `SessionTodosSection.tsx` + test deleted — confirmed removed.
