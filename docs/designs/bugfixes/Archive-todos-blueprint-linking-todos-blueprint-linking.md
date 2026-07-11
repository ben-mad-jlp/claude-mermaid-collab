# Blueprint: Link Session Todos to Blueprints / Go Sessions

## Source Artifacts
- `design-todos-blueprint-linking` — the design (link-only model + skill wiring)

Decisions baked in: (1) `complete_linked_todos` is a **standalone MCP tool**; (2) link chip **opens the blueprint doc only**.

## 1. Structure Summary

### Files
**Backend (src):**
- [ ] `src/mcp/tools/session-todos.ts` — add `SessionTodoLink` + `link?` on `SessionTodo`; thread `link` through `addSessionTodo`/`updateSessionTodo`; add `completeTodosForTask`; extend `addSessionTodoSchema`/`updateSessionTodoSchema`; add `completeLinkedTodosSchema`.
- [ ] `src/mcp/setup.ts` — thread `link` in `add_session_todo`/`update_session_todo` cases; register new `complete_linked_todos` tool (decl + case).
- [ ] `src/routes/api.ts` — accept optional `link` on POST `/api/session-todos` and PATCH `/api/session-todos/:id`.

**UI (ui/src):**
- [ ] `ui/src/types/sessionTodo.ts` — add `link?` to `SessionTodo` (re-exported via `@/types`).
- [ ] `ui/src/lib/api.ts` — `addSessionTodo` gains optional `link`; `patchSessionTodo` updates accept `link`.
- [ ] `ui/src/stores/sessionStore.ts` — todo actions pass `link` through (verify `addSessionTodo`/`upsertSessionTodo` signatures).
- [ ] `ui/src/components/layout/SessionTodosSection.tsx` — render link chip after text (keeps `#{id}`).
- [ ] `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` — same link chip.

**Skills (docs):**
- [ ] `skills/vibe-go/SKILL.md` — after marking a task `completed`, call `complete_linked_todos`.
- [ ] `skills/vibe-review/SKILL.md` — "Add as todo" + deferred completeness gaps create todos with `link.blueprintId`.
- [ ] `skills/vibe-checkpoint/SKILL.md` — include open todos (via `list_session_todos`) in the Currently Doing snapshot.

### Type Definitions
```ts
// session-todos.ts (+ mirrored in ui/src/types/sessionTodo.ts)
export interface SessionTodoLink {
  blueprintId: string;   // document id of the blueprint ("Go session")
  taskId?: string;       // optional task id within that blueprint's graph
}
export interface SessionTodo {
  id: number; text: string; completed: boolean; order: number;
  createdAt: string; updatedAt: string;
  link?: SessionTodoLink;   // NEW, optional → fully backward compatible
}
```

### Component Interactions
```
/vibe-go  --update_task_status(completed)--> then --complete_linked_todos(blueprintId, taskId)-->
   session-todos.ts completeTodosForTask  → flips matching todos.completed = true → ws broadcast
/vibe-review (shelved item) --add_session_todo(text, link={blueprintId})--> linked todo appears
UI TodoRow: todo.link present → muted chip "↳ {blueprintId}" (+ "· {taskId}") → click selects blueprint doc
```

---

## 2. Function Blueprints

### `completeTodosForTask(project, session, blueprintId, taskId?): Promise<SessionTodo[]>`
New, in `session-todos.ts`.

**Pseudocode:**
1. `withLock(project, session, …)`:
2. read file; `now = nowIso()`.
3. For each todo where `todo.link?.blueprintId === blueprintId` AND (`taskId` undefined OR `todo.link.taskId === undefined` OR `todo.link.taskId === taskId`) AND `!todo.completed`: set `completed = true`, `updatedAt = now`; collect it.
4. If any changed, `writeSessionTodosFile`.
5. Return the array of changed todos.

**Error handling:** none beyond file read/write (read tolerates missing file → empty).
**Edge cases:** no matches → return `[]`, no write. `taskId` omitted → completes all todos linked to that blueprint (task-level + blueprint-level).
**Test strategy:** todos linked to (bp, t1)/(bp, t2)/(bp, no task)/(other bp); call with taskId=t1 → only t1 + the no-task ones complete; call with no taskId → all of bp complete; other bp untouched; already-completed not re-touched.

### `addSessionTodo(project, session, text, link?)` — extend
Add optional 4th param `link?: SessionTodoLink`; set `todo.link = link` when provided. All existing callers (no link) unchanged.

### `updateSessionTodo(project, session, id, updates)` — extend
`updates` gains `link?: SessionTodoLink | null`. `undefined` = leave; object = set; `null` = clear (`delete todo.link`).

**Test strategy:** add with link persists+returns it; update sets/clears link.

### `complete_linked_todos` MCP tool (setup.ts)
Args `{ project, session, blueprintId, taskId? }` → `completeTodosForTask(...)`; broadcast `session_todos_updated`; return changed todos. `completeLinkedTodosSchema` requires `project, session, blueprintId`.

### UI link chip (both TodoRow variants)
After the text span, when `todo.link`:
```tsx
<span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 ..." title={`Linked to ${todo.link.blueprintId}${todo.link.taskId ? ` · ${todo.link.taskId}` : ''}`}
  onClick={(e) => { e.stopPropagation(); onOpenBlueprint?.(todo.link!.blueprintId); }}>
  ↳ {shortSlug(todo.link.blueprintId)}{todo.link.taskId ? ` · ${todo.link.taskId}` : ''}
</span>
```
Open path: reuse existing doc-open/selection (set current doc by id). If a handler isn't readily available, render the chip non-clickable (title only) — clicking is a nice-to-have, not required for v1.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: todos-backend
    files: [src/mcp/tools/session-todos.ts]
    tests: [src/mcp/tools/__tests__/session-todos.test.ts]
    description: "Add SessionTodoLink + link? on SessionTodo; thread link through addSessionTodo/updateSessionTodo; add completeTodosForTask; extend add/update schemas; add completeLinkedTodosSchema."
    parallel: true
    depends-on: []
  - id: ui-todo-type
    files: [ui/src/types/sessionTodo.ts]
    tests: []
    description: "Add SessionTodoLink + optional link field to the UI SessionTodo type (re-exported via @/types)."
    parallel: true
    depends-on: []
  - id: skill-vibe-checkpoint
    files: [skills/vibe-checkpoint/SKILL.md]
    tests: []
    description: "Add a step: read list_session_todos and include open (incomplete) todos (#id + link slug) in the Currently Doing snapshot."
    parallel: true
    depends-on: []
  - id: mcp-wiring
    files: [src/mcp/setup.ts]
    tests: []
    description: "Thread optional link in add_session_todo/update_session_todo cases; register complete_linked_todos tool (declaration + handler case calling completeTodosForTask + ws broadcast)."
    parallel: false
    depends-on: [todos-backend]
  - id: api-routes
    files: [src/routes/api.ts]
    tests: []
    description: "Accept optional link on POST /api/session-todos and PATCH /api/session-todos/:id; pass through to add/updateSessionTodo."
    parallel: false
    depends-on: [todos-backend]
  - id: ui-api-store
    files: [ui/src/lib/api.ts, ui/src/stores/sessionStore.ts]
    tests: []
    description: "addSessionTodo gains optional link; patchSessionTodo updates accept link; store todo actions pass link through."
    parallel: false
    depends-on: [ui-todo-type]
  - id: ui-todo-rows
    files: [ui/src/components/layout/SessionTodosSection.tsx, ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx]
    tests: [ui/src/components/layout/__tests__/SessionTodosSection.test.tsx]
    description: "Render muted link chip on linked todo rows (keeps #id prefix); chip opens the blueprint doc if a handler is available, else title-only. Add a test for chip render."
    parallel: false
    depends-on: [ui-todo-type, ui-api-store]
  - id: skill-vibe-go
    files: [skills/vibe-go/SKILL.md]
    tests: []
    description: "After update_task_status status:completed for a task, call complete_linked_todos(blueprintId, taskId) so linked todos flip to done."
    parallel: false
    depends-on: [mcp-wiring]
  - id: skill-vibe-review
    files: [skills/vibe-review/SKILL.md]
    tests: []
    description: "In Case B 'Add as todo' and for deferred completeness gaps, create session todos with link.blueprintId set to the blueprint being reviewed (only shelved/deferred items, not fixed ones)."
    parallel: false
    depends-on: [mcp-wiring]
```

### Execution Waves
**Wave 1 (parallel):** todos-backend, ui-todo-type, skill-vibe-checkpoint
**Wave 2 (parallel):** mcp-wiring, api-routes, ui-api-store
**Wave 3 (parallel):** ui-todo-rows, skill-vibe-go, skill-vibe-review

### Summary
- Total tasks: **9**
- Total waves: **3**
- Max parallelism: **3**
