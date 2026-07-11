# Research: Session-Todos — current implementation & change surface for title + description

**IMPORTANT BRANCH FINDING (read first).** There are two divergent realities:

- **Current branch `feat/native-app-foundation` (where this research ran):** todos are stored as **per-session JSON** (`session-todos.json`). The model has only `text` (no title/description). This is the "1.x" implementation described below as *Current*.
- **Branch `feat/todos-upgrade-phase0` (NOT merged here):** already replaced that with a **per-project `bun:sqlite` `todos.db`** whose schema **already contains `title` AND `description` columns**, plus a JSON→SQLite migration, UUID ids, status enum, owner/assignee, etc. (commits `73b72b1` Phase 0, `a28462b` Phase 1). The roadmap doc lists Phase 0 + 1 as "done".

So the SQLite store the task brief expected **exists on a different branch**, not on the current one. **`title`/`description` are already designed AND built on `feat/todos-upgrade-phase0`.** The real planning decision is *which branch the title/description UI lands on*, and whether to merge phase0 first. The remaining work (blank description on add, view/edit description in preview pane, remove inline editing) is **NOT** built on either branch — only the data fields exist on phase0.

---

## 1. Data model / store

### Current branch (`feat/native-app-foundation`) — JSON, no title/description
- File: `src/mcp/tools/session-todos.ts`
- Store = per-session JSON at `<project>/.collab/sessions/<session>/session-todos.json` (`getSessionTodosPath`, line 177). Shape `{ todos: SessionTodo[], nextId: number }`.
- Type (`session-todos.ts:33-46`):
```ts
interface SessionTodo {
  id: number;          // per-file nextId, NOT globally unique
  text: string;        // the only content field
  completed: boolean;
  order: number;       // ×10 gaps
  createdAt: string;
  updatedAt: string;
  link?: { blueprintId: string; taskId?: string };
}
```
- No SQLite, no schema-version mechanism. Read/write via `readSessionTodosFile`/`writeSessionTodosFile` (181, 198) with a per-(project,session) in-memory `withLock` mutex (16).
- `addSessionTodo` (228) takes `text` (trimmed, non-empty), assigns `id=nextId`, `order=maxOrder+10`.
- `updateSessionTodo` (256) patches any of `{ text, completed, order, link }`.

### Branch `feat/todos-upgrade-phase0` — SQLite, HAS title + description (the intended target)
- File: `src/services/todo-store.ts` (bun:sqlite). DB at `<project>/.collab/todos.db`, `PRAGMA journal_mode = WAL`, per-project `withLock`.
- DDL (already includes title + description):
```sql
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,            -- UUID
  ownerSession TEXT NOT NULL,
  assigneeSession TEXT,
  title TEXT NOT NULL,            -- replaces `text`
  description TEXT,               -- ALREADY EXISTS (nullable)
  status TEXT NOT NULL DEFAULT 'todo',  -- backlog|todo|in_progress|blocked|done
  priority INTEGER, dueDate TEXT,
  parentId TEXT, dependsOn TEXT NOT NULL DEFAULT '[]',
  ord REAL NOT NULL, link TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  completedAt TEXT, asanaGid TEXT
);
-- indexes on ownerSession, assigneeSession, status
```
- `Todo` interface has `title: string`, `description: string | null`, `completed` derived from `status==='done'`, `order` (from `ord`), `dependsOn: string[]`, `link: TodoLink|null`, `asanaGid`.
- **Schema versioning:** none — uses `CREATE TABLE IF NOT EXISTS` + idempotent file-based one-time migration. There is no PRAGMA user_version mechanism. Adding a column to an existing `todos.db` would need an explicit `ALTER TABLE ... ADD COLUMN` guarded by a column-existence check (but title/description already exist, so no new column needed there).
- **Migration:** `src/services/todo-migration.ts` `migrateProject(project)` — walks `.collab/sessions/*/session-todos.json`, for each legacy todo calls `createTodo` with `ownerSession=assigneeSession=session`, `title = old.text`, `status = completed?'done':'todo'`, writes a `session-todos.migrated.json` sidecar (legacy-id→uuid map) and renames source to `.migrated`. Idempotent via marker/sidecar existence checks.

---

## 2. MCP tools (current branch)
All in `src/mcp/setup.ts`; declared 1834-1873, dispatched 3231-3325. Imports from `./tools/session-todos.js` (50-67).

| Tool | Params | Behaviour |
|---|---|---|
| `list_session_todos` | project, session, includeCompleted? (def true) | sorted by order asc (3239) |
| `add_session_todo` | project, session, **text** (req), link? | append; broadcasts `session_todos_updated` (3251-3252) |
| `update_session_todo` | project, session, id, text?, completed?, order?, link?(null clears) | partial update (3267) |
| `toggle_session_todo` | project, session, id, completed? | flip or set (3280) |
| `remove_session_todo` | project, session, id | delete (3292) |
| `clear_completed_session_todos` | project, session | bulk delete completed (3300) |
| `reorder_session_todos` | project, session, orderedIds[] (full permutation) | reassign order 10,20,… (3312) |
| `complete_linked_todos` | project, session, blueprintId, taskId? | mark linked done (3322) |

Every mutation calls `getWebSocketHandler()?.broadcast({ type:'session_todos_updated', project, session })`.

**Phase0 branch** already extends `add`/`update` schemas with `title` (alias of text), `description`, `assigneeSession`, `status`, `priority`, `dueDate`; `id` becomes `string`. `text` kept as back-compat alias that maps to `title`.

---

## 3. REST API (current branch)
`src/routes/api.ts` 2517-2683. `SessionTodoLink` imported (31).
- `GET /api/session-todos?project&session&includeCompleted` → `{ todos }` (2521)
- `POST /api/session-todos` body `{project,session,text,link?}` → `{ todo }` 201; validates non-empty text (2541)
- `POST /api/session-todos/clear-completed` body `{project,session}` → `{ removedCount }` (2572)
- `POST /api/session-todos/reorder` body `{project,session,orderedIds[]}` → `{ todos }` (2597)
- `PATCH /api/session-todos/:id` (regex `/^\/api\/session-todos\/(\d+)$/`) body `{project,session,text?,completed?,order?,link?}` → `{ todo }`; 404 if "Todo not found" (2624)
- `DELETE /api/session-todos/:id?project&session` → `{ todo }` (2660)

All mutating routes call `wsHandler.broadcast({type:'session_todos_updated',project,session})`. NOTE the `:id` regex is `\d+` (numeric) — would need to become non-numeric if UUID ids arrive.

---

## 4. WebSocket broadcast
- Event type declared `src/websocket/handler.ts:54`: `{ type: 'session_todos_updated'; project: string; session: string }` — **payload-less** (no todo data).
- UI handler `ui/src/App.tsx:882-898`: on `session_todos_updated`, if `project===currentSession.project && session===currentSession.name`, re-fetch via `api.getSessionTodos(...)` and `setSessionTodos`. (Phase1 branch enriches this payload with owner/assignee and broadens the guard via `ui/src/lib/todoEvents.ts shouldRefetchTodos`.)

---

## 5. UI — left column
- **Active component:** `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` (imported by `ArtifactTree.tsx:19`).
- **Legacy/likely-unused:** `ui/src/components/layout/SessionTodosSection.tsx` (older flat-sidebar version, same logic + drag-reorder). Confirm it is dead before deleting; both have near-identical `TodoRow`.
- **Store:** `ui/src/stores/sessionStore.ts` holds `sessionTodos`, `sessionTodosShowCompleted`, `sessionTodosFetchSeq`; setters `setSessionTodos`(525), `upsertSessionTodo`(529), `removeSessionTodoLocal`(541), `setSessionTodosList`(546), `setSessionTodosShowCompleted`(550). Initial fetch on session select (250-256, seq-guarded).
- **API client:** `ui/src/lib/api.ts` methods 629-712 (`getSessionTodos`, `addSessionTodo`, `patchSessionTodo`, `removeSessionTodo`, `reorderSessionTodos`, `clearCompletedSessionTodos`).
- **Display:** a row = checkbox + `#{id}` + the `text` span + optional link chip + delete button. Only `text` is shown.

### INLINE EDITING (the part to REMOVE)
In `TodosTreeSection.tsx` `TodoRow`:
- State: `const [editing, setEditing] = useState(false)`; `const [draftText, setDraftText] = useState(todo.text)` (42-43).
- `commitEdit` (59-78): trims `draftText`, optimistic `upsertSessionTodo`, `api.patchSessionTodo(..., { text })`, rollback on error.
- Render: when `editing`, an `<input>` (108-124) with `onBlur={commitEdit}`, Enter commits, Escape cancels; otherwise a `<span onClick={() => setEditing(true)}>` (126-133) makes the text click-to-edit.
- (The legacy `SessionTodosSection.tsx` has the same `editing`/`draftText`/`commitEdit` at lines 39-75 / 111-140.)

### Other handlers (keep)
- `handleToggle` (45-57): optimistic toggle + `api.patchSessionTodo(...,{completed})`.
- `handleDelete` (80-89): optimistic `removeSessionTodoLocal` + `api.removeSessionTodo`.
- `handleAddTodo` (220-236): `api.addSessionTodo(project, name, trimmed)`, then `upsertSessionTodo`.
- Add input (292-310): text box, Enter → `handleAddTodo`.
- `handleClearCompleted` (238-253), show-completed toggle (274-281).
- Link chip (135-144): click → `selectDocument(blueprintId)` opens the blueprint doc in the pane.
- The legacy `SessionTodosSection.tsx` also implements full drag-reorder (handleDragStart/Over/Drop/End 253-327) and calls `api.reorderSessionTodos`. The active tree version currently has NO drag-reorder.

---

## 6. UI — preview pane (where a todo-detail view would hook in)
- **Router:** `ui/src/components/layout/editor/PaneContent.tsx` — `switch (tab.kind)` dispatching a `TabDescriptor` to a viewer. Cases: `artifact` (sub-switch on `artifactType`: diagram/document/design/spreadsheet/snippet/image), `embed`, `task-graph`, `task-details`, `blueprint`, `code-file`, default `NotFound`. Documents render via `DocumentView` (142-148).
- **Tab model:** `ui/src/stores/tabsStore.ts` — `TabKind` (5-11) and `TabArtifactType` (13-19) unions, `TabDescriptor` (21-32: id, kind, artifactType?, artifactId, filePath?, name, isPreview, isPinned, order, openedAt). Open actions: `openPreview` / `openPermanent` (tabsStore, used in ArtifactTree 167-168).
- **How a row opens the pane:** `ArtifactTree.handleNodeClick` (606-633) builds a `TabDescriptor` via `toTabDescriptor(node)` (47) and calls `openPreview(d)` (631). (In vsCodeMode it instead `window.parent.postMessage({type:'openArtifact',...})`.)
- **Conclusion:** to make a todo open a description view in the preview pane, add a new `TabKind` (e.g. `'todo-detail'`) + a `PaneContent` case rendering a new `TodoDetailView`, and have the todo row call `openPreview({ kind:'todo-detail', artifactId: String(todo.id), ... })`. `task-details` is the closest existing precedent.

---

## 7. Existing design docs (build on these, don't contradict)
- **`design-todos-upgrade`** (Phase 0): defines the upgraded model. `title` = current `text`; `description?: string` (markdown → Asana notes). Decided per-PROJECT `bun:sqlite` store. Flags the id number→UUID migration touching MCP `id:number`, REST `\d+` regex, UI `#{id}`.
- **`design-todos-phase1-2`**: Phase 1 cross-session assignment (live-update fix, assignee picker, manager dashboard) — DONE on phase0 branch. Phase 2 Asana sync — designed, not built.
- **`roadmap`** (Track 2): Phase 0 store + Phase 1 marked **done** on `feat/todos-upgrade-phase0` (commits `73b72b1`, `a28462b`). Phase 2 designed only. "Branches not pushed." Confirms the SQLite store w/ title+description is real on that branch, NOT on the current native-app branch.

The design already mandates `title` + `description` as first-class fields — so adding them is *executing the existing design*, not new design. The design did NOT specify a preview-pane description editor or removing inline edit; those are net-new UI decisions consistent with the design's "richer viewing" direction.

---

## Change surface — add `title` + `description`, blank description on add, view/edit in preview pane, remove left-column inline edit

**Strategic note:** the cheapest path is to **merge / cherry-pick `feat/todos-upgrade-phase0`** (which already gives the SQLite store + `title` + `description` fields end-to-end) and then build only the *UI behaviour* (preview-pane detail view + inline-edit removal) on top. Building title/description from scratch on the JSON store would duplicate work already done and then collide on merge.

If proceeding ON the current JSON branch (no phase0 merge), files to change:
1. `src/mcp/tools/session-todos.ts` — add `title`/`description` to `SessionTodo`, `addSessionTodo` (default `description: ''`), `updateSessionTodo`, and schemas. Decide `text`→`title` relationship (alias vs rename).
2. `src/mcp/setup.ts` — extend add/update arg destructuring + schemas (1840-1873, 3243-3270).
3. `src/routes/api.ts` — POST/PATCH bodies accept `title`/`description` (2541-2657).
4. `src/websocket/handler.ts` — (only if enriching payload; not required for title/desc).
5. `ui/src/types/sessionTodo.ts` + `ui/src/types/index.ts` — add `title`/`description`.
6. `ui/src/lib/api.ts` — add fields to `addSessionTodo`/`patchSessionTodo` signatures (645-680).
7. `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` — REMOVE inline edit (`editing`/`draftText`/`commitEdit`/the `<input>` + click-to-edit span, 42-78,108-133); make the title span click → open todo-detail in preview pane instead.
8. `ui/src/components/layout/SessionTodosSection.tsx` — same inline-edit removal IF still mounted (else delete file). Verify usage first.
9. `ui/src/stores/tabsStore.ts` — add `'todo-detail'` to `TabKind`.
10. `ui/src/components/layout/editor/PaneContent.tsx` — add `case 'todo-detail'` rendering a new detail view.
11. **NEW** `ui/src/components/todos/TodoDetailView.tsx` (or editors/) — title + description view/editor; saves via `api.patchSessionTodo`.
12. `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — wire the todo row click to `openPreview({kind:'todo-detail',...})` (or add an open handler in TodosTreeSection directly).
13. Tests: `src/mcp/tools/__tests__/session-todos.test.ts`, `ui/src/components/layout/__tests__/SessionTodosSection.test.tsx`, `Sidebar.test.tsx`, `ArtifactTree.*.test.tsx`.

### Trickiest parts
1. **Branch divergence is the #1 risk.** `feat/todos-upgrade-phase0` already implemented `title`+`description` (+ UUID ids, status enum, per-project SQLite, assignee, migration). Building the same on the current JSON branch wastes effort and guarantees a painful merge. **Decide branch strategy first** (merge phase0 here, or build on phase0). If merging phase0: `id` becomes a **UUID string** — this ripples through the REST `:id` regex (`\d+`), MCP `id:number`, UI `todo.id:number` and `#{id}` display, and all tests.
2. **Schema migration of existing rows.** On phase0, title/description columns already exist (no ALTER needed). On the JSON store, "migration" is trivial (add a field with a default). The real migration risk is the JSON→SQLite `migrateProject` step (`todo-migration.ts`) — it only maps `text`→`title` and leaves `description` null; that is already correct for "blank description on add". There is **no schema-version / user_version mechanism**; future column adds need a guarded `ALTER TABLE`.
3. **MCP backward-compat.** Phase0 keeps `text` as an alias for `title` in add/update so existing callers (and the UI's `todo.text`) keep working. Preserve this: `add_session_todo({text})` must still create a todo (title := text), and `list` results should keep a `text` shim until all UI reads `title`.
4. **Preview-pane integration.** `PaneContent` keys off artifacts that live in `sessionStore` arrays (diagrams/documents/…); todos live in a separate `sessionTodos` slice, so the new `todo-detail` case must look up by id in `sessionTodos`, not the artifact arrays. `TabDescriptor.artifactId` is a `string` while todo ids are currently `number` — coerce (another reason UUID/string ids are cleaner). The link chip already demonstrates the pane-open pattern (`selectDocument`).
5. **Two left-column components.** Confirm whether `SessionTodosSection.tsx` is still mounted anywhere before editing/deleting; only `TodosTreeSection.tsx` is wired through `ArtifactTree`.
