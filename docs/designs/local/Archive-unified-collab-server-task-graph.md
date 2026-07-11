# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 3
- **Total waves:** 2
- **Max parallelism:** 2

## Execution Waves

**Wave 1:** server-electron-target, server-idle-shutdown
**Wave 2:** app-shared-server

## Task Graph (YAML)

```yaml
tasks:
  - id: server-electron-target
    files: [src/services/cdp-session.ts, src/routes/browser-routes.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Runtime electron-view target override (setElectronTarget/clearElectronTarget) read by cdp-session; POST/DELETE /api/browser/electron-target endpoint."
    parallel: true
    depends-on: []
  - id: server-idle-shutdown
    files: [src/websocket/handler.ts, src/server.ts, src/config.ts]
    tests: []
    description: "WS consumer-count change callback; server arms MERMAID_IDLE_SHUTDOWN_MS timer on zero connections → removeInstance + clean exit; cancel on new connection; default 10min, 0 disables."
    parallel: true
    depends-on: []
  - id: app-shared-server
    files: [desktop/src/main/server-supervisor.ts, desktop/src/main/index.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Supervisor attach-or-start on canonical port (MERMAID_PORT/9002): health-check→attach if up, else spawn on that port. index.ts registers cdp target via POST /api/browser/electron-target after start; remove shared-server stop from before-quit."
    parallel: false
    depends-on: [server-electron-target]
```

## Dependency Visualization

```mermaid
graph TD
    server-electron-target["server-electron-target<br/>"Runtime electron-view target ..."]
    server-idle-shutdown["server-idle-shutdown<br/>"WS consumer-count change call..."]
    app-shared-server["app-shared-server<br/>"Supervisor attach-or-start on..."]

     --> server-electron-target
     --> server-idle-shutdown
    server-electron-target --> app-shared-server

    style server-electron-target fill:#c8e6c9
    style server-idle-shutdown fill:#c8e6c9
    style app-shared-server fill:#bbdefb
```

## Tasks by Wave

### Wave 1

- **server-electron-target**: "Runtime electron-view target override (setElectronTarget/clearElectronTarget) read by cdp-session; POST/DELETE /api/browser/electron-target endpoint."
- **server-idle-shutdown**: "WS consumer-count change callback; server arms MERMAID_IDLE_SHUTDOWN_MS timer on zero connections → removeInstance + clean exit; cancel on new connection; default 10min, 0 disables."

### Wave 2

- **app-shared-server**: "Supervisor attach-or-start on canonical port (MERMAID_PORT/9002): health-check→attach if up, else spawn on that port. index.ts registers cdp target via POST /api/browser/electron-target after start; remove shared-server stop from before-quit."
