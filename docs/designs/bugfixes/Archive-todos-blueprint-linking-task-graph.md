# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 9
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** todos-backend, ui-todo-type, skill-vibe-checkpoint
**Wave 2:** mcp-wiring, api-routes, ui-api-store
**Wave 3:** ui-todo-rows, skill-vibe-go, skill-vibe-review

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    todos-backend["todos-backend<br/>"Add SessionTodoLink + link? o..."]
    ui-todo-type["ui-todo-type<br/>"Add SessionTodoLink + optiona..."]
    skill-vibe-checkpoint["skill-vibe-checkpoint<br/>"Add a step: read list_session..."]
    mcp-wiring["mcp-wiring<br/>"Thread optional link in add_s..."]
    api-routes["api-routes<br/>"Accept optional link on POST ..."]
    ui-api-store["ui-api-store<br/>"addSessionTodo gains optional..."]
    ui-todo-rows["ui-todo-rows<br/>"Render muted link chip on lin..."]
    skill-vibe-go["skill-vibe-go<br/>"After update_task_status stat..."]
    skill-vibe-review["skill-vibe-review<br/>"In Case B 'Add as todo' and f..."]

     --> todos-backend
     --> ui-todo-type
     --> skill-vibe-checkpoint
    todos-backend --> mcp-wiring
    todos-backend --> api-routes
    ui-todo-type --> ui-api-store
    ui-todo-type --> ui-todo-rows
    ui-api-store --> ui-todo-rows
    mcp-wiring --> skill-vibe-go
    mcp-wiring --> skill-vibe-review

    style todos-backend fill:#c8e6c9
    style ui-todo-type fill:#c8e6c9
    style skill-vibe-checkpoint fill:#c8e6c9
    style mcp-wiring fill:#bbdefb
    style api-routes fill:#bbdefb
    style ui-api-store fill:#bbdefb
    style ui-todo-rows fill:#fff3e0
    style skill-vibe-go fill:#fff3e0
    style skill-vibe-review fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **todos-backend**: "Add SessionTodoLink + link? on SessionTodo; thread link through addSessionTodo/updateSessionTodo; add completeTodosForTask; extend add/update schemas; add completeLinkedTodosSchema."
- **ui-todo-type**: "Add SessionTodoLink + optional link field to the UI SessionTodo type (re-exported via @/types)."
- **skill-vibe-checkpoint**: "Add a step: read list_session_todos and include open (incomplete) todos (#id + link slug) in the Currently Doing snapshot."

### Wave 2

- **mcp-wiring**: "Thread optional link in add_session_todo/update_session_todo cases; register complete_linked_todos tool (declaration + handler case calling completeTodosForTask + ws broadcast)."
- **api-routes**: "Accept optional link on POST /api/session-todos and PATCH /api/session-todos/:id; pass through to add/updateSessionTodo."
- **ui-api-store**: "addSessionTodo gains optional link; patchSessionTodo updates accept link; store todo actions pass link through."

### Wave 3

- **ui-todo-rows**: "Render muted link chip on linked todo rows (keeps #id prefix); chip opens the blueprint doc if a handler is available, else title-only. Add a test for chip render."
- **skill-vibe-go**: "After update_task_status status:completed for a task, call complete_linked_todos(blueprintId, taskId) so linked todos flip to done."
- **skill-vibe-review**: "In Case B 'Add as todo' and for deferred completeness gaps, create session todos with link.blueprintId set to the blueprint being reviewed (only shelved/deferred items, not fixed ones)."
