# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 11
- **Total waves:** 3
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** session-status-store, tmux-send-keys, supervisor-store, ui-supervisor-store
**Wave 2:** api-status-wire, ws-status-replay, supervisor-api, ui-supervisor-panel
**Wave 3:** ui-sidebar-wire, supervisor-skill, watch-tmux-push

## Task Graph (YAML)

```yaml
tasks:
  - id: session-status-store
    files: [src/services/session-status-store.ts]
    tests: [src/services/session-status-store.test.ts]
    description: "SQLite per-project last-known Claude status store (record/get)"
    parallel: true
    depends-on: []
  - id: tmux-send-keys
    files: [src/routes/ide-routes.ts]
    tests: [src/routes/ide-routes.test.ts]
    description: "POST /api/ide/tmux-send-keys — inject text+Enter into a session's tmux"
    parallel: true
    depends-on: []
  - id: supervisor-store
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "SQLite supervisor→assigned-sessions membership store"
    parallel: true
    depends-on: []
  - id: ui-supervisor-store
    files: [ui/src/stores/supervisorStore.ts]
    tests: [ui/src/stores/supervisorStore.test.ts]
    description: "Zustand store for assigned sessions, backed by supervisor REST API"
    parallel: true
    depends-on: []
  - id: api-status-wire
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts]
    description: "Persist status in /api/session-notify; add GET /api/session-status"
    parallel: false
    depends-on: [session-status-store]
  - id: ws-status-replay
    files: [src/websocket/handler.ts]
    tests: [src/websocket/handler.test.ts]
    description: "Replay last-known claude_session_status to new subscribers (optional)"
    parallel: true
    depends-on: [session-status-store]
  - id: supervisor-api
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/supervisor-routes.test.ts]
    description: "CRUD endpoints for supervisor membership"
    parallel: false
    depends-on: [supervisor-store]
  - id: ui-supervisor-panel
    files: [ui/src/components/layout/SupervisorPanel.tsx]
    tests: [ui/src/components/layout/SupervisorPanel.test.tsx]
    description: "Sidebar Supervisor section (status rows, add/remove, escalation badge)"
    parallel: false
    depends-on: [ui-supervisor-store]
  - id: ui-sidebar-wire
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Mount SupervisorPanel above the Watching section"
    parallel: false
    depends-on: [ui-supervisor-panel]
  - id: supervisor-skill
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Supervisor wake-loop skill: poll status+todos, nudge idle, escalate"
    parallel: false
    depends-on: [tmux-send-keys, api-status-wire, supervisor-api]
  - id: watch-tmux-push
    files: [desktop/src/main/index.ts, desktop/src/main/watch-aggregator.ts]
    tests: []
    description: "FOLLOW-UP: push tmux send-keys into supervisor tmux on watch events"
    parallel: false
    depends-on: [tmux-send-keys, supervisor-api]
```

## Dependency Visualization

```mermaid
graph TD
    session-status-store["session-status-store<br/>"SQLite per-project last-known..."]
    tmux-send-keys["tmux-send-keys<br/>"POST /api/ide/tmux-send-keys ..."]
    supervisor-store["supervisor-store<br/>"SQLite supervisor→assigned-se..."]
    ui-supervisor-store["ui-supervisor-store<br/>"Zustand store for assigned se..."]
    api-status-wire["api-status-wire<br/>"Persist status in /api/sessio..."]
    ws-status-replay["ws-status-replay<br/>"Replay last-known claude_sess..."]
    supervisor-api["supervisor-api<br/>"CRUD endpoints for supervisor..."]
    ui-supervisor-panel["ui-supervisor-panel<br/>"Sidebar Supervisor section (s..."]
    ui-sidebar-wire["ui-sidebar-wire<br/>"Mount SupervisorPanel above t..."]
    supervisor-skill["supervisor-skill<br/>"Supervisor wake-loop skill: p..."]
    watch-tmux-push["watch-tmux-push<br/>"FOLLOW-UP: push tmux send-key..."]

     --> session-status-store
     --> tmux-send-keys
     --> supervisor-store
     --> ui-supervisor-store
    session-status-store --> api-status-wire
    session-status-store --> ws-status-replay
    supervisor-store --> supervisor-api
    ui-supervisor-store --> ui-supervisor-panel
    ui-supervisor-panel --> ui-sidebar-wire
    tmux-send-keys --> supervisor-skill
    api-status-wire --> supervisor-skill
    supervisor-api --> supervisor-skill
    tmux-send-keys --> watch-tmux-push
    supervisor-api --> watch-tmux-push

    style session-status-store fill:#c8e6c9
    style tmux-send-keys fill:#c8e6c9
    style supervisor-store fill:#c8e6c9
    style ui-supervisor-store fill:#c8e6c9
    style api-status-wire fill:#bbdefb
    style ws-status-replay fill:#bbdefb
    style supervisor-api fill:#bbdefb
    style ui-supervisor-panel fill:#bbdefb
    style ui-sidebar-wire fill:#fff3e0
    style supervisor-skill fill:#fff3e0
    style watch-tmux-push fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **session-status-store**: "SQLite per-project last-known Claude status store (record/get)"
- **tmux-send-keys**: "POST /api/ide/tmux-send-keys — inject text+Enter into a session's tmux"
- **supervisor-store**: "SQLite supervisor→assigned-sessions membership store"
- **ui-supervisor-store**: "Zustand store for assigned sessions, backed by supervisor REST API"

### Wave 2

- **api-status-wire**: "Persist status in /api/session-notify; add GET /api/session-status"
- **ws-status-replay**: "Replay last-known claude_session_status to new subscribers (optional)"
- **supervisor-api**: "CRUD endpoints for supervisor membership"
- **ui-supervisor-panel**: "Sidebar Supervisor section (status rows, add/remove, escalation badge)"

### Wave 3

- **ui-sidebar-wire**: "Mount SupervisorPanel above the Watching section"
- **supervisor-skill**: "Supervisor wake-loop skill: poll status+todos, nudge idle, escalate"
- **watch-tmux-push**: "FOLLOW-UP: push tmux send-keys into supervisor tmux on watch events"
