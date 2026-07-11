# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 5
- **Total waves:** 3
- **Max parallelism:** 2

## Execution Waves

**Wave 1:** broadcast-payload, list-sessions-project-filter
**Wave 2:** app-refetch-guard, assign-ui
**Wave 3:** manager-dashboard

## Task Graph (YAML)

```yaml
tasks:
  - id: broadcast-payload
    files: [src/websocket/handler.ts, src/routes/api.ts, src/mcp/setup.ts]
    tests: []
    description: "Enrich session_todos_updated event with ownerSession/assigneeSession at all emit sites (api.ts todo routes + setup.ts dispatch) + extend the WS event type"
    parallel: true
    depends-on: []
  - id: list-sessions-project-filter
    files: [src/mcp/setup.ts, src/routes/api.ts]
    tests: []
    description: "Add optional `project` filter to list_sessions MCP tool + /api/sessions (backwards-compatible)"
    parallel: true
    depends-on: []
  - id: app-refetch-guard
    files: [ui/src/App.tsx]
    tests: [ui/src/App.refetch.test.ts]
    description: "Extract shouldRefetchTodos(evt,ctx) pure helper + broaden the todo refetch guard (App.tsx:882-884) to owner/assignee===me; toast when a todo is newly assigned to me"
    parallel: false
    depends-on: [broadcast-payload]
  - id: assign-ui
    files: [ui/src/lib/api.ts, ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx]
    tests: []
    description: "getSessions(project) client filter + assignee picker on todo rows (assign via patchSessionTodo({assigneeSession})), assignee badge, unassign"
    parallel: false
    depends-on: [list-sessions-project-filter]
  - id: manager-dashboard
    files: [ui/src/components/todos/ManagerDashboard.tsx]
    tests: [ui/src/components/todos/ManagerDashboard.test.tsx]
    description: "Manager view: owned todos grouped by assigneeSession -> status (modest list, not Kanban); reuse row status/reassign controls"
    parallel: false
    depends-on: [assign-ui]
```

## Dependency Visualization

```mermaid
graph TD
    broadcast-payload["broadcast-payload<br/>"Enrich session_todos_updated ..."]
    list-sessions-project-filter["list-sessions-project-filter<br/>"Add optional `project` filter..."]
    app-refetch-guard["app-refetch-guard<br/>"Extract shouldRefetchTodos(ev..."]
    assign-ui["assign-ui<br/>"getSessions(project) client f..."]
    manager-dashboard["manager-dashboard<br/>"Manager view: owned todos gro..."]

     --> broadcast-payload
     --> list-sessions-project-filter
    broadcast-payload --> app-refetch-guard
    list-sessions-project-filter --> assign-ui
    assign-ui --> manager-dashboard

    style broadcast-payload fill:#c8e6c9
    style list-sessions-project-filter fill:#c8e6c9
    style app-refetch-guard fill:#bbdefb
    style assign-ui fill:#bbdefb
    style manager-dashboard fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **broadcast-payload**: "Enrich session_todos_updated event with ownerSession/assigneeSession at all emit sites (api.ts todo routes + setup.ts dispatch) + extend the WS event type"
- **list-sessions-project-filter**: "Add optional `project` filter to list_sessions MCP tool + /api/sessions (backwards-compatible)"

### Wave 2

- **app-refetch-guard**: "Extract shouldRefetchTodos(evt,ctx) pure helper + broaden the todo refetch guard (App.tsx:882-884) to owner/assignee===me; toast when a todo is newly assigned to me"
- **assign-ui**: "getSessions(project) client filter + assignee picker on todo rows (assign via patchSessionTodo({assigneeSession})), assignee badge, unassign"

### Wave 3

- **manager-dashboard**: "Manager view: owned todos grouped by assigneeSession -> status (modest list, not Kanban); reuse row status/reassign controls"
