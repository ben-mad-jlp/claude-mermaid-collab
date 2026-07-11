# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 6
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** todo-store, todo-ui-types
**Wave 2:** todo-migration, todo-api, todo-mcp
**Wave 3:** todo-ui-views

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    todo-store["todo-store<br/>"bun:sqlite per-project todo s..."]
    todo-ui-types["todo-ui-types<br/>"Upgraded SessionTodo UI type ..."]
    todo-migration["todo-migration<br/>"One-time migrate per-session ..."]
    todo-api["todo-api<br/>"Repoint /api/session-todos* t..."]
    todo-mcp["todo-mcp<br/>"MCP tools delegate to todo-st..."]
    todo-ui-views["todo-ui-views<br/>"UI: thread new fields + filte..."]

     --> todo-store
     --> todo-ui-types
    todo-store --> todo-migration
    todo-store --> todo-api
    todo-store --> todo-mcp
    todo-ui-types --> todo-ui-views
    todo-api --> todo-ui-views

    style todo-store fill:#c8e6c9
    style todo-ui-types fill:#c8e6c9
    style todo-migration fill:#bbdefb
    style todo-api fill:#bbdefb
    style todo-mcp fill:#bbdefb
    style todo-ui-views fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **todo-store**: "bun:sqlite per-project todo store: Todo type, schema+indexes, CRUD, filtered list (session/owner/assignee/status/includeCompleted), assign, reorder, per-project handle cache + write mutex, status↔completed sync"
- **todo-ui-types**: "Upgraded SessionTodo UI type (string id, status enum, ownerSession/assigneeSession, priority, dueDate, description, parentId, dependsOn, link) — mirrors todo-store Todo per the design"

### Wave 2

- **todo-migration**: "One-time migrate per-session session-todos.json → per-project store (uuid ids, ownerSession=session, completed→status, legacy-id map, rename source .migrated, idempotent); invoked on store first-open"
- **todo-api**: "Repoint /api/session-todos* to todo-store; /:id accepts UUID string; add assignee/status/ownerSession query filters + new body fields; broadcast for owner & assignee"
- **todo-mcp**: "MCP tools delegate to todo-store; schemas gain id:string + status/assigneeSession/priority/dueDate/description; add assign_session_todo; list filters; keep complete_linked_todos + completed back-compat"

### Wave 3

- **todo-ui-views**: "UI: thread new fields + filter params; status control (todo/in_progress/blocked/done) replacing bare checkbox; assignee + priority/due badges; filter row (status, assigned-to-me). Optimistic. Board/Kanban deferred"
