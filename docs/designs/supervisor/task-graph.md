# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 10
- **Total waves:** 4
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** config-and-supervisor-config-routes, claude-launch, transcript-route, serverid-state
**Wave 2:** launch-route, peer-registry-ws, tools-serverid-routing
**Wave 3:** desktop-federation, ui-start-buttons
**Wave 4:** skill-and-smoke

## Task Graph (YAML)

```yaml
tasks:
  - id: config-and-supervisor-config-routes
    files: [src/config.ts, src/routes/supervisor-routes.ts]
    tests: []
    description: "SUPERVISOR_PROJECT/SESSION config + GET /api/supervisor/config + /api/supervisor/identity"
    parallel: true
    depends-on: []
  - id: claude-launch
    files: [src/services/claude-launch.ts]
    tests: [src/services/claude-launch.test.ts]
    description: "launchAndBind: tmux -c cwd, launch claude, readiness, /collab, optional skill"
    parallel: true
    depends-on: []
  - id: transcript-route
    files: [src/routes/api.ts]
    tests: []
    description: "GET /api/transcript/last-turn (peer-callable, wraps lastAssistantTurn)"
    parallel: true
    depends-on: []
  - id: launch-route
    files: [src/routes/ide-routes.ts]
    tests: []
    description: "POST /api/ide/launch-session -> launchAndBind"
    parallel: false
    depends-on: [claude-launch]
  - id: serverid-state
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "serverId column on supervised/escalation/lock (migration); peer-registry cache; register_supervisor records home serverId"
    parallel: true
    depends-on: []
  - id: peer-registry-ws
    files: [src/websocket/handler.ts]
    tests: []
    description: "Accept peer_registry WS message from desktop -> supervisor-store.setPeerRegistry"
    parallel: false
    depends-on: [serverid-state]
  - id: tools-serverid-routing
    files: [src/mcp/setup.ts]
    tests: []
    description: "supervisor tools gain serverId; peerFetch routes reconcile/nudge/read to peers via registry; register_supervisor takes serverId"
    parallel: false
    depends-on: [serverid-state, transcript-route]
  - id: desktop-federation
    files: [desktop/src/main/watch-aggregator.ts, desktop/src/main/index.ts]
    tests: []
    description: "Desktop pushes peer_registry to home server; cross-machine push in WatchAggregator (replaces per-server session-notify push)"
    parallel: false
    depends-on: [peer-registry-ws, tools-serverid-routing]
  - id: ui-start-buttons
    files: [ui/src/components/layout/SubscriptionsPanel.tsx, ui/src/components/layout/SupervisorPanel.tsx]
    tests: []
    description: "Per-row Start button + Start-supervisor button -> invokeOnServer launch-session"
    parallel: false
    depends-on: [launch-route, config-and-supervisor-config-routes]
  - id: skill-and-smoke
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Skill: serverId-aware ops; register_supervisor with serverId. Smoke verify local launch-and-bind + (if desktop) cross-machine."
    parallel: false
    depends-on: [tools-serverid-routing, ui-start-buttons, desktop-federation]
```

## Dependency Visualization

```mermaid
graph TD
    config-and-supervisor-config-routes["config-and-supervisor-config-routes<br/>"SUPERVISOR_PROJECT/SESSION co..."]
    claude-launch["claude-launch<br/>"launchAndBind: tmux -c cwd, l..."]
    transcript-route["transcript-route<br/>"GET /api/transcript/last-turn..."]
    launch-route["launch-route<br/>"POST /api/ide/launch-session ..."]
    serverid-state["serverid-state<br/>"serverId column on supervised..."]
    peer-registry-ws["peer-registry-ws<br/>"Accept peer_registry WS messa..."]
    tools-serverid-routing["tools-serverid-routing<br/>"supervisor tools gain serverI..."]
    desktop-federation["desktop-federation<br/>"Desktop pushes peer_registry ..."]
    ui-start-buttons["ui-start-buttons<br/>"Per-row Start button + Start-..."]
    skill-and-smoke["skill-and-smoke<br/>"Skill: serverId-aware ops; re..."]

     --> config-and-supervisor-config-routes
     --> claude-launch
     --> transcript-route
    claude-launch --> launch-route
     --> serverid-state
    serverid-state --> peer-registry-ws
    serverid-state --> tools-serverid-routing
    transcript-route --> tools-serverid-routing
    peer-registry-ws --> desktop-federation
    tools-serverid-routing --> desktop-federation
    launch-route --> ui-start-buttons
    config-and-supervisor-config-routes --> ui-start-buttons
    tools-serverid-routing --> skill-and-smoke
    ui-start-buttons --> skill-and-smoke
    desktop-federation --> skill-and-smoke

    style config-and-supervisor-config-routes fill:#c8e6c9
    style claude-launch fill:#c8e6c9
    style transcript-route fill:#c8e6c9
    style serverid-state fill:#c8e6c9
    style launch-route fill:#bbdefb
    style peer-registry-ws fill:#bbdefb
    style tools-serverid-routing fill:#bbdefb
    style desktop-federation fill:#fff3e0
    style ui-start-buttons fill:#fff3e0
    style skill-and-smoke fill:#f3e5f5
```

## Tasks by Wave

### Wave 1

- **config-and-supervisor-config-routes**: "SUPERVISOR_PROJECT/SESSION config + GET /api/supervisor/config + /api/supervisor/identity"
- **claude-launch**: "launchAndBind: tmux -c cwd, launch claude, readiness, /collab, optional skill"
- **transcript-route**: "GET /api/transcript/last-turn (peer-callable, wraps lastAssistantTurn)"
- **serverid-state**: "serverId column on supervised/escalation/lock (migration); peer-registry cache; register_supervisor records home serverId"

### Wave 2

- **launch-route**: "POST /api/ide/launch-session -> launchAndBind"
- **peer-registry-ws**: "Accept peer_registry WS message from desktop -> supervisor-store.setPeerRegistry"
- **tools-serverid-routing**: "supervisor tools gain serverId; peerFetch routes reconcile/nudge/read to peers via registry; register_supervisor takes serverId"

### Wave 3

- **desktop-federation**: "Desktop pushes peer_registry to home server; cross-machine push in WatchAggregator (replaces per-server session-notify push)"
- **ui-start-buttons**: "Per-row Start button + Start-supervisor button -> invokeOnServer launch-session"

### Wave 4

- **skill-and-smoke**: "Skill: serverId-aware ops; register_supervisor with serverId. Smoke verify local launch-and-bind + (if desktop) cross-machine."
