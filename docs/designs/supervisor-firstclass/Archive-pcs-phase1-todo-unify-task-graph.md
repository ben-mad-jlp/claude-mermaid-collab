# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 3
- **Total waves:** 2
- **Max parallelism:** 2

## Execution Waves

**Wave 1:** todo-store
**Wave 2:** session-todos-mcp, roadmap-migration

## Task Graph (YAML)

```yaml
tasks:
  - id: todo-store
    files: [src/services/todo-store.ts]
    tests: [src/services/__tests__/todo-store.test.ts]
    description: "Extend TodoStatus (+planned,ready,dropped); add columns sessionName, blueprintId, acceptanceStatus, claimedBy, claimToken, claimedAt, claimLeaseMs, retryCount with addColumnIfMissing migration for existing DBs; update Todo/TodoRow/CreateTodoInput/UpdateTodoPatch/rowToTodo/createTodo/updateTodo; add claimTodo (atomic CAS), releaseExpiredClaims (lease), listReadyTodos (deps-all-done), computeWaves (Kahn, port from roadmap-store). Tests first."
    parallel: true
    depends-on: []
  - id: session-todos-mcp
    files: [src/mcp/tools/session-todos.ts]
    tests: []
    description: "Expose dependsOn, parentId, sessionName, and the new status enum values on addSessionTodo + updateSessionTodo schemas/handlers (all optional; no change for existing callers)."
    parallel: false
    depends-on: [todo-store]
  - id: roadmap-migration
    files: [src/services/roadmap-migration.ts]
    tests: [src/services/__tests__/roadmap-migration.test.ts]
    description: "NEW idempotent per-project backfill migrateRoadmapToTodos: read roadmap_item rows, upsert todos with same id + 1:1 status map + sessionName/blueprintId/parentId/dependsOn, ownerSession='__roadmap__'; roadmap_item_todo join → parentId; _migrations marker for idempotency; does NOT delete roadmap.db; wire into startup per project. Tests: mapping, idempotency, join→parentId, absent-db."
    parallel: false
    depends-on: [todo-store]
```

## Dependency Visualization

```mermaid
graph TD
    todo-store["todo-store<br/>"Extend TodoStatus (+planned,r..."]
    session-todos-mcp["session-todos-mcp<br/>"Expose dependsOn, parentId, s..."]
    roadmap-migration["roadmap-migration<br/>"NEW idempotent per-project ba..."]

     --> todo-store
    todo-store --> session-todos-mcp
    todo-store --> roadmap-migration

    style todo-store fill:#c8e6c9
    style session-todos-mcp fill:#bbdefb
    style roadmap-migration fill:#bbdefb
```

## Tasks by Wave

### Wave 1

- **todo-store**: "Extend TodoStatus (+planned,ready,dropped); add columns sessionName, blueprintId, acceptanceStatus, claimedBy, claimToken, claimedAt, claimLeaseMs, retryCount with addColumnIfMissing migration for existing DBs; update Todo/TodoRow/CreateTodoInput/UpdateTodoPatch/rowToTodo/createTodo/updateTodo; add claimTodo (atomic CAS), releaseExpiredClaims (lease), listReadyTodos (deps-all-done), computeWaves (Kahn, port from roadmap-store). Tests first."

### Wave 2

- **session-todos-mcp**: "Expose dependsOn, parentId, sessionName, and the new status enum values on addSessionTodo + updateSessionTodo schemas/handlers (all optional; no change for existing callers)."
- **roadmap-migration**: "NEW idempotent per-project backfill migrateRoadmapToTodos: read roadmap_item rows, upsert todos with same id + 1:1 status map + sessionName/blueprintId/parentId/dependsOn, ownerSession='__roadmap__'; roadmap_item_todo join → parentId; _migrations marker for idempotency; does NOT delete roadmap.db; wire into startup per project. Tests: mapping, idempotency, join→parentId, absent-db."
