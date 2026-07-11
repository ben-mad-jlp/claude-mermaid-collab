# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 8
- **Total waves:** 5
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** config-bind-auth, connection-store, ws-singleton-switch
**Wave 2:** server-auth-gate, server-proxy
**Wave 3:** main-ipc-wiring
**Wave 4:** server-context
**Wave 5:** switcher-ui

## Task Graph (YAML)

```yaml
tasks:
  - id: config-bind-auth
    files: [src/config.ts]
    tests: [src/__tests__/config-bind-auth.test.ts]
    description: "Phase 5 — add MERMAID_BIND_HOST (default 127.0.0.1) + MERMAID_AUTH_TOKEN to config; flip HOST default to loopback"
    parallel: true
    depends-on: []
  - id: connection-store
    files: [desktop/src/main/connection-store.ts]
    tests: [desktop/src/main/__tests__/connection-store.test.ts]
    description: "Phase 6 — persisted ServerEntry store; safeStorage tokens; auto-list local instances from registry; list() omits tokens"
    parallel: true
    depends-on: []
  - id: ws-singleton-switch
    files: [ui/src/lib/websocket.ts, ui/src/lib/onboarding-api.ts]
    tests: [ui/src/lib/websocket.test.ts]
    description: "Phase 4/6 — clean WS singleton teardown/rebuild on switch; onboarding-api uses relative URL (rides proxy)"
    parallel: true
    depends-on: []
  - id: server-auth-gate
    files: [src/server.ts]
    tests: [src/__tests__/server-auth.test.ts]
    description: "Phase 5 — checkAuth gate at top of fetch(); Bearer token required when configured; exempt /api/health and /mcp; covers /ws + /terminal + /api/*"
    parallel: true
    depends-on: [config-bind-auth]
  - id: server-proxy
    files: [desktop/src/main/server-proxy.ts]
    tests: [desktop/src/main/__tests__/server-proxy.test.ts]
    description: "Phase 4 — per-server local HTTP+WS proxy; inject Authorization on HTTP + WS upstream; repointable setUpstream; 503/502 handling"
    parallel: true
    depends-on: [config-bind-auth]
  - id: main-ipc-wiring
    files: [desktop/src/main/index.ts, desktop/src/preload/index.ts]
    tests: []
    description: "Phase 4 — start proxy + ConnectionStore; load proxy URL instead of sidecar; expand mc bridge (list/get/switch/add/removeServer) via IPC"
    parallel: false
    depends-on: [server-proxy, connection-store]
  - id: server-context
    files: [ui/src/contexts/ServerContext.tsx]
    tests: [ui/src/contexts/ServerContext.test.tsx]
    description: "Phase 6 — thin React context: active server id + switch() → mc.switchServer + resetWebSocketClient + remount version bump"
    parallel: false
    depends-on: [ws-singleton-switch, main-ipc-wiring]
  - id: switcher-ui
    files: [ui/src/components/ServerSwitcher.tsx]
    tests: [ui/src/components/ServerSwitcher.test.tsx]
    description: "Phase 6 — switcher UI (active pill + sidebar + add/edit dialog with live /api/health probe); Level 1→2 from design-server-switcher"
    parallel: false
    depends-on: [server-context]
```

## Dependency Visualization

```mermaid
graph TD
    config-bind-auth["config-bind-auth<br/>"Phase 5 — add MERMAID_BIND_HO..."]
    connection-store["connection-store<br/>"Phase 6 — persisted ServerEnt..."]
    ws-singleton-switch["ws-singleton-switch<br/>"Phase 4/6 — clean WS singleto..."]
    server-auth-gate["server-auth-gate<br/>"Phase 5 — checkAuth gate at t..."]
    server-proxy["server-proxy<br/>"Phase 4 — per-server local HT..."]
    main-ipc-wiring["main-ipc-wiring<br/>"Phase 4 — start proxy + Conne..."]
    server-context["server-context<br/>"Phase 6 — thin React context:..."]
    switcher-ui["switcher-ui<br/>"Phase 6 — switcher UI (active..."]

     --> config-bind-auth
     --> connection-store
     --> ws-singleton-switch
    config-bind-auth --> server-auth-gate
    config-bind-auth --> server-proxy
    server-proxy --> main-ipc-wiring
    connection-store --> main-ipc-wiring
    ws-singleton-switch --> server-context
    main-ipc-wiring --> server-context
    server-context --> switcher-ui

    style config-bind-auth fill:#c8e6c9
    style connection-store fill:#c8e6c9
    style ws-singleton-switch fill:#c8e6c9
    style server-auth-gate fill:#bbdefb
    style server-proxy fill:#bbdefb
    style main-ipc-wiring fill:#fff3e0
    style server-context fill:#f3e5f5
    style switcher-ui fill:#ffccbc
```

## Tasks by Wave

### Wave 1

- **config-bind-auth**: "Phase 5 — add MERMAID_BIND_HOST (default 127.0.0.1) + MERMAID_AUTH_TOKEN to config; flip HOST default to loopback"
- **connection-store**: "Phase 6 — persisted ServerEntry store; safeStorage tokens; auto-list local instances from registry; list() omits tokens"
- **ws-singleton-switch**: "Phase 4/6 — clean WS singleton teardown/rebuild on switch; onboarding-api uses relative URL (rides proxy)"

### Wave 2

- **server-auth-gate**: "Phase 5 — checkAuth gate at top of fetch(); Bearer token required when configured; exempt /api/health and /mcp; covers /ws + /terminal + /api/*"
- **server-proxy**: "Phase 4 — per-server local HTTP+WS proxy; inject Authorization on HTTP + WS upstream; repointable setUpstream; 503/502 handling"

### Wave 3

- **main-ipc-wiring**: "Phase 4 — start proxy + ConnectionStore; load proxy URL instead of sidecar; expand mc bridge (list/get/switch/add/removeServer) via IPC"

### Wave 4

- **server-context**: "Phase 6 — thin React context: active server id + switch() → mc.switchServer + resetWebSocketClient + remount version bump"

### Wave 5

- **switcher-ui**: "Phase 6 — switcher UI (active pill + sidebar + add/edit dialog with live /api/health probe); Level 1→2 from design-server-switcher"
