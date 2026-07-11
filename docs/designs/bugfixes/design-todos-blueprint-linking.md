# Design: Link Session Todos to Blueprints / Go Sessions

## Goal
Let a session todo optionally reference a blueprint (and optionally a task in
its graph), and wire a few vibe skills to use that link. **Link only** — todos
and the task graph remain separate stores; we just cross-reference. No merge,
no auto-seeding.

## 1. Data model

`SessionTodo` (src/mcp/tools/session-todos.ts + ui/src/types/sessionTodo.ts)
gains one optional field:

```ts
interface SessionTodo {
  id: number;
  text: string;
  completed: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  link?: {
    blueprintId: string;   // document id of the blueprint (the "Go session")
    taskId?: string;       // optional task id within that blueprint's graph
  };
}
```

- Stored as-is in `.collab/sessions/<session>/session-todos.json` (additive; old
  files without `link` stay valid).
- Backward compatible: `link` absent = a plain manual todo (today's behavior).

## 2. Backend / MCP

- `addSessionTodoSchema` + `updateSessionTodoSchema`: add optional `link`
  (`{ blueprintId: string; taskId?: string }`). `add` accepts it at creation;
  `update` can set/clear it.
- `listSessionTodos` already returns the whole record → `link` flows through.
- New helper (server side): `completeTodosForTask(project, session, blueprintId, taskId)`
  — marks completed every todo whose `link.blueprintId === blueprintId` and
  (`link.taskId` unset OR `=== taskId`). Used by vibe-go. Exposed either as a
  small MCP tool (`complete_linked_todos`) or folded into `update_task_status`.
  **Decision needed:** standalone tool vs. piggyback on update_task_status (lean
  standalone tool — keeps task-graph code unaware of todos).

## 3. UI

- `TodoRow` (both SessionTodosSection.tsx and sidebar-tree/TodosTreeSection.tsx):
  when `todo.link` is present, render a small muted chip after the text, e.g.
  `↳ {blueprint-slug}` (and `· {taskId}` if set). Clicking it selects/opens the
  blueprint document (setCurrentSession already drives navigation; reuse the
  doc-open path).
- Keep the `#{todo.id}` prefix already added.

## 4. Skill wiring

### /vibe-go — complete linked todos as tasks finish
After each `update_task_status(... status: 'completed')` for a task, call
`complete_linked_todos(blueprintId, taskId)` so the human-facing todo flips to
done in lockstep. (blueprintId = the blueprint doc id vibe-go is executing.)

### /vibe-review — file todos ONLY for shelved/deferred items
In the review outcome handling:
- Case B "minor bugs" → for any the user chooses **"Add as todo"** / accepts as
  deferred: create a session todo with `link.blueprintId` = the blueprint, text
  = the bug/gap description.
- Completeness gaps the user defers (not fixed this pass) → same.
- Do NOT create todos for items that get fixed in the fix wave. Only shelved work
  becomes a todo, so the todo list = "what we consciously punted."

### /vibe-checkpoint — record open todos
When writing the checkpoint, append a short "Open todos" list (incomplete ones,
with `#id` and link slug if any) into the vibeinstructions so they survive /clear.
Read via `list_session_todos`. Do not duplicate completed todos.

### /vibe-blueprint — unchanged
No auto-seeding of todos from the task list. (Per decision.)

## 5. Non-goals
- No merge of todos and task-graph tasks.
- No per-task vs per-blueprint attach-target distinction in UI beyond the single
  optional `taskId`.
- No backfill of existing todos.

## Open decisions
1. `complete_linked_todos` as a standalone MCP tool (recommended) vs folding into
   `update_task_status`.
2. Link chip click target: open the blueprint doc only, or also scroll/focus the
   task in the task-graph diagram (start with: open the doc).
