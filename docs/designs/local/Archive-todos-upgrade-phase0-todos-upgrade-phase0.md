# Blueprint: Todos Upgrade — Phase 0 (local model + per-project store + migration + views)

## Source Artifacts
- `design-todos-upgrade` (decided: per-PROJECT bun:sqlite store; upgraded model; managing-session ready)
- Current impl (agent-mapped): `src/mcp/tools/session-todos.ts` (model+CRUD), REST `src/routes/api.ts:2519`, MCP dispatch `src/mcp/setup.ts:3707`, WS event `src/websocket/handler.ts:54`, UI `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` + `SessionTodosSection.tsx`, types `ui/src/types/sessionTodo.ts`, store `ui/src/stores/sessionStore.ts`, `ui/src/lib/api.ts`.

**Scope (Phase 0):** the upgraded local model on a per-project SQLite store + one-time migration from per-session JSON + backend API/MCP rewire + a modest UI viewing upgrade (status/assignee/priority + filters). `ownerSession`/`assigneeSession` exist now (default owner=assignee=current session); the **managing-session assignment UX is Phase 1**; **Asana is Phase 2**. Full Kanban/board views deferred.

---

## 1. Structure Summary

### Files
- [ ] `src/services/todo-store.ts` — Create: bun:sqlite per-project store + `Todo` type + CRUD + filtered queries + per-project handle/mutex. The new source of truth.
- [ ] `src/services/__tests__/todo-store.test.ts` — Test
- [ ] `src/services/todo-migration.ts` — Create: migrate `<project>/.collab/sessions/*/session-todos.json` → project store
- [ ] `src/services/__tests__/todo-migration.test.ts` — Test
- [ ] `src/mcp/tools/session-todos.ts` — Modify: tool fns delegate to todo-store; add `status`/`owner`/`assignee` fields + `assign`/`set-status` tools; keep `completed` back-compat
- [ ] `src/mcp/setup.ts:3707` — Modify: dispatch the new/updated tool schemas
- [ ] `src/routes/api.ts:2519` — Modify: session-todos routes → todo-store; `/:id` accepts string (UUID), new fields, filter query params
- [ ] `ui/src/types/sessionTodo.ts` — Modify: new `SessionTodo` shape (string id, status, owner/assignee, priority, dueDate, description, parentId, dependsOn)
- [ ] `ui/src/lib/api.ts` + `ui/src/stores/sessionStore.ts` — Modify: id:string, new fields, filter params
- [ ] `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` — Modify: render status (chip, not just checkbox) + assignee + priority/due; filters (status, assigned-to-me)

### Type (shared shape — backend `todo-store.ts` + UI `sessionTodo.ts` must match)
```ts
type TodoStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';
interface Todo {
  id: string;                 // UUID
  ownerSession: string;
  assigneeSession: string | null;
  title: string;              // was `text`
  description: string | null;
  status: TodoStatus;
  completed: boolean;         // derived: status === 'done'
  priority: 0|1|2|3|4|null;
  dueDate: string | null;     // YYYY-MM-DD
  parentId: string | null;
  dependsOn: string[];        // JSON column
  order: number;
  link: { blueprintId: string; taskId?: string } | null;  // JSON column
  createdAt: string; updatedAt: string; completedAt: string | null;
  asanaGid: string | null;    // placeholder for Phase 2 (column reserved)
}
```

### Component interactions
Backend store owns all logic; MCP tools + REST routes are thin adapters over it. Mutations still broadcast `session_todos_updated` (now also carry/refresh for both owner & assignee). UI fetches with filter params (`assignee`, `status`) and renders status/assignee.

---

## 2. Function Blueprints

### `src/services/todo-store.ts`
**Schema (bun:sqlite, one DB per project at `<project>/.collab/todos.db`):**
```sql
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY, ownerSession TEXT NOT NULL, assigneeSession TEXT,
  title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER, dueDate TEXT, parentId TEXT, dependsOn TEXT DEFAULT '[]',
  ord REAL NOT NULL, link TEXT, createdAt TEXT, updatedAt TEXT, completedAt TEXT,
  asanaGid TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(ownerSession);
CREATE INDEX IF NOT EXISTS idx_todos_assignee ON todos(assigneeSession);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
```
**Functions** (each takes `project` to resolve/cache the per-project `Database`; serialize writes per-project):
- `createTodo(project, { ownerSession, assigneeSession?, title, ... }): Todo` — `id=crypto.randomUUID()`, `ord = maxOrd+10`, status default `'todo'`, timestamps; insert; return row (deserialized).
- `listTodos(project, filter?: { session?, ownerSession?, assigneeSession?, status?, includeCompleted? }): Todo[]` — WHERE built from filter; default excludes `done` unless `includeCompleted`; ORDER BY ord. `session` filter = `ownerSession=? OR assigneeSession=?` (a session sees todos it owns or is assigned).
- `getTodo(project, id): Todo | null`
- `updateTodo(project, id, patch): Todo` — set provided fields; if `status` set, sync `completed`/`completedAt`; bump `updatedAt`. (Setting `completed:true` ⇒ status `done` for back-compat.)
- `assignTodo(project, id, assigneeSession): Todo` — convenience update.
- `removeTodo(project, id)`, `clearCompleted(project, session)`, `reorder(project, ids: string[])`.
**Helpers:** row↔Todo (de/serialize `dependsOn`/`link` JSON; `completed` derived). DB handle cache `Map<project, Database>`; per-project async mutex (reuse the `withLock` pattern from session-todos.ts).
**Error handling:** corrupt JSON columns → default ([]/null); missing DB dir → mkdir.
**Test strategy:** temp project dir; create/list(filters: by assignee, by status, includeCompleted)/update(status→completed sync)/assign/reorder/remove; `completed:true`⇒status done.

### `src/services/todo-migration.ts`
- `migrateProject(project): { migrated: number }` — for each `<project>/.collab/sessions/*/session-todos.json`: read `{ todos, nextId }`; for each old todo insert into the store with `id=randomUUID()`, `ownerSession=assigneeSession=<dirSession>`, `title=text`, `status = completed ? 'done' : 'todo'`, carry `order`/`link`/timestamps; record a legacy-id→uuid map in a sidecar (`migrated.json`) so links/`#id` references can resolve. Rename the source file to `*.migrated` so it runs once (idempotent). 
- Call from `todo-store` first-open (or server startup). 
- **Test:** seed a fake sessions/*/session-todos.json → migrate → store has rows with ownerSession set, completed→status mapped, source renamed; second run is a no-op.

### `src/routes/api.ts` (session-todos routes)
- Repoint all `/api/session-todos*` handlers to `todo-store`. `/:id` param: accept string UUID (was `\d+`). `GET` gains `assignee`/`status`/`ownerSession` query filters. `POST`/`PATCH` accept new fields. Keep broadcasting `session_todos_updated` (broadcast for both owner & assignee sessions).
- **Class: behavioral** (route logic + id type). Diagram the request→store flow.

### `src/mcp/tools/session-todos.ts` + `setup.ts`
- Tool fns delegate to todo-store. Update schemas: `id: string`; add `status`, `assigneeSession`, `priority`, `dueDate`, `description` to add/update; add `assign_session_todo` (id, assigneeSession) and rely on update for status. `complete_linked_todos` unchanged semantically (sets status done). `list_session_todos` gains `assignee`/`status` filters.
- **Class: behavioral.**

### UI (`sessionTodo.ts`, `api.ts`, `sessionStore.ts`, `TodosTreeSection.tsx`)
- Types: id `string`, add status/owner/assignee/priority/dueDate/description. api/store: thread new fields + filter params. Component: replace bare checkbox with a **status control** (cycle or dropdown: todo/in_progress/blocked/done), show assignee + priority/due badges, add a filter row (status, "assigned to me"). Keep optimistic updates. Full board/Kanban deferred.
- **Class: behavioral** (UI).

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: todo-store
    files: [src/services/todo-store.ts]
    tests: [src/services/__tests__/todo-store.test.ts]
    description: "bun:sqlite per-project todo store: Todo type, schema+indexes, CRUD, filtered list (session/owner/assignee/status/includeCompleted), assign, reorder, per-project handle cache + write mutex, status↔completed sync"
    parallel: true
    depends-on: []
  - id: todo-ui-types
    files: [ui/src/types/sessionTodo.ts]
    tests: []
    description: "Upgraded SessionTodo UI type (string id, status enum, ownerSession/assigneeSession, priority, dueDate, description, parentId, dependsOn, link) — mirrors todo-store Todo per the design"
    parallel: true
    depends-on: []
  - id: todo-migration
    files: [src/services/todo-migration.ts]
    tests: [src/services/__tests__/todo-migration.test.ts]
    description: "One-time migrate per-session session-todos.json → per-project store (uuid ids, ownerSession=session, completed→status, legacy-id map, rename source .migrated, idempotent); invoked on store first-open"
    parallel: true
    depends-on: [todo-store]
  - id: todo-api
    files: [src/routes/api.ts]
    tests: []
    description: "Repoint /api/session-todos* to todo-store; /:id accepts UUID string; add assignee/status/ownerSession query filters + new body fields; broadcast for owner & assignee"
    parallel: true
    depends-on: [todo-store]
  - id: todo-mcp
    files: [src/mcp/tools/session-todos.ts, src/mcp/setup.ts]
    tests: []
    description: "MCP tools delegate to todo-store; schemas gain id:string + status/assigneeSession/priority/dueDate/description; add assign_session_todo; list filters; keep complete_linked_todos + completed back-compat"
    parallel: true
    depends-on: [todo-store]
  - id: todo-ui-views
    files: [ui/src/lib/api.ts, ui/src/stores/sessionStore.ts, ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx]
    tests: []
    description: "UI: thread new fields + filter params; status control (todo/in_progress/blocked/done) replacing bare checkbox; assignee + priority/due badges; filter row (status, assigned-to-me). Optimistic. Board/Kanban deferred"
    parallel: false
    depends-on: [todo-ui-types, todo-api]
```

### Execution Waves
- **Wave 1 (parallel):** `todo-store`, `todo-ui-types`
- **Wave 2 (← Wave 1):** `todo-migration` (←todo-store), `todo-api` (←todo-store), `todo-mcp` (←todo-store)
- **Wave 3 (← Wave 2):** `todo-ui-views` (←todo-ui-types, todo-api)

### Summary
- Total tasks: 6
- Total waves: 3
- Max parallelism: 3 (Wave 2)

### Notes / risks
- **id number→UUID** ripples: REST `/:id` regex, MCP `id` schema, UI `todo.id` type + `#{id}` display, and `complete_linked_todos`/link resolution → keep a legacy-id map from migration.
- **Back-compat:** keep `completed` working everywhere (derived from status) so nothing breaks mid-migration.
- **Store relocation** per-session→per-project: migration must be idempotent + run before first read; old files renamed `.migrated`.
- Owner=assignee=current session initially; **managing-session assignment UX = Phase 1**, **Asana = Phase 2** (the `asanaGid` column is reserved now).
- UI is sidebar-modest in Phase 0; full board/Kanban + cross-session dashboards are later.
