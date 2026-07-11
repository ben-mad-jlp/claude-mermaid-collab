# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 8
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** roadmap-store, supervisor-store-global, transcript-reader
**Wave 2:** supervisor-routes-v2, supervisor-mcp-tools
**Wave 3:** ui-supervisor-rework, ui-supervise-toggle, supervisor-skill-v2

## Task Graph (YAML)

```yaml
tasks:
  - id: roadmap-store
    files: [src/services/roadmap-store.ts]
    tests: [src/services/roadmap-store.test.ts]
    description: "Per-project roadmap.db store (items + item-todo links), todo-store pattern"
    parallel: true
    depends-on: []
  - id: supervisor-store-global
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "REPLACE membership with global supervisor.db: watched projects, supervised sessions, attended-locks, escalations"
    parallel: true
    depends-on: []
  - id: transcript-reader
    files: [src/services/transcript-reader.ts]
    tests: [src/services/transcript-reader.test.ts]
    description: "Read a session's last end_turn assistant message from its JSONL transcript via binding"
    parallel: true
    depends-on: []
  - id: supervisor-routes-v2
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/supervisor-routes.test.ts]
    description: "REPLACE /targets with /projects /supervised /roadmap /escalations /locks endpoints"
    parallel: false
    depends-on: [roadmap-store, supervisor-store-global]
  - id: supervisor-mcp-tools
    files: [src/mcp/setup.ts]
    tests: []
    description: "Add MCP tools: roadmap CRUD + spawn-session, reconcile, read_last_assistant_turn, escalations, attended-locks"
    parallel: false
    depends-on: [roadmap-store, supervisor-store-global, transcript-reader]
  - id: ui-supervisor-rework
    files: [ui/src/components/layout/SupervisorPanel.tsx, ui/src/stores/supervisorStore.ts]
    tests: []
    description: "Rework panel+store: roadmaps, spawned-session status, escalations inbox, lock badges"
    parallel: false
    depends-on: [supervisor-routes-v2]
  - id: ui-supervise-toggle
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Per-row supervise toggle writing the supervised flag"
    parallel: false
    depends-on: [supervisor-routes-v2]
  - id: supervisor-skill-v2
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Rewrite skill: roadmap planning, approval-gated spawn, per-turn+wake reconcile, classify/nudge/escalate, attended-lock"
    parallel: false
    depends-on: [supervisor-mcp-tools, supervisor-routes-v2, transcript-reader]
```

## Dependency Visualization

```mermaid
graph TD
    roadmap-store["roadmap-store<br/>"Per-project roadmap.db store ..."]
    supervisor-store-global["supervisor-store-global<br/>"REPLACE membership with globa..."]
    transcript-reader["transcript-reader<br/>"Read a session's last end_tur..."]
    supervisor-routes-v2["supervisor-routes-v2<br/>"REPLACE /targets with /projec..."]
    supervisor-mcp-tools["supervisor-mcp-tools<br/>"Add MCP tools: roadmap CRUD +..."]
    ui-supervisor-rework["ui-supervisor-rework<br/>"Rework panel+store: roadmaps,..."]
    ui-supervise-toggle["ui-supervise-toggle<br/>"Per-row supervise toggle writ..."]
    supervisor-skill-v2["supervisor-skill-v2<br/>"Rewrite skill: roadmap planni..."]

     --> roadmap-store
     --> supervisor-store-global
     --> transcript-reader
    roadmap-store --> supervisor-routes-v2
    supervisor-store-global --> supervisor-routes-v2
    roadmap-store --> supervisor-mcp-tools
    supervisor-store-global --> supervisor-mcp-tools
    transcript-reader --> supervisor-mcp-tools
    supervisor-routes-v2 --> ui-supervisor-rework
    supervisor-routes-v2 --> ui-supervise-toggle
    supervisor-mcp-tools --> supervisor-skill-v2
    supervisor-routes-v2 --> supervisor-skill-v2
    transcript-reader --> supervisor-skill-v2

    style roadmap-store fill:#c8e6c9
    style supervisor-store-global fill:#c8e6c9
    style transcript-reader fill:#c8e6c9
    style supervisor-routes-v2 fill:#bbdefb
    style supervisor-mcp-tools fill:#bbdefb
    style ui-supervisor-rework fill:#fff3e0
    style ui-supervise-toggle fill:#fff3e0
    style supervisor-skill-v2 fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **roadmap-store**: "Per-project roadmap.db store (items + item-todo links), todo-store pattern"
- **supervisor-store-global**: "REPLACE membership with global supervisor.db: watched projects, supervised sessions, attended-locks, escalations"
- **transcript-reader**: "Read a session's last end_turn assistant message from its JSONL transcript via binding"

### Wave 2

- **supervisor-routes-v2**: "REPLACE /targets with /projects /supervised /roadmap /escalations /locks endpoints"
- **supervisor-mcp-tools**: "Add MCP tools: roadmap CRUD + spawn-session, reconcile, read_last_assistant_turn, escalations, attended-locks"

### Wave 3

- **ui-supervisor-rework**: "Rework panel+store: roadmaps, spawned-session status, escalations inbox, lock badges"
- **ui-supervise-toggle**: "Per-row supervise toggle writing the supervised flag"
- **supervisor-skill-v2**: "Rewrite skill: roadmap planning, approval-gated spawn, per-turn+wake reconcile, classify/nudge/escalate, attended-lock"
