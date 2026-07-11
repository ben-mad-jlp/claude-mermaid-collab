# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 7
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** desktop-shell, cdp-port-config
**Wave 2:** desktop-deeplink, server-supervisor, cdp-electron-target
**Wave 3:** supervisor-instance-dedup, browser-pane

## Task Graph (YAML)

```yaml
tasks:
  - id: desktop-shell
    files: [desktop/electron.vite.config.ts, desktop/src/main/index.ts, desktop/src/preload/index.ts]
    tests: []
    description: "Phase 0.1 — electron-vite shell skeleton; spikes moved to desktop/spikes/; contextIsolation+sandbox; placeholder renderer"
    parallel: true
    depends-on: []
  - id: cdp-port-config
    files: [src/config.ts, src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.config.test.ts]
    description: "Phase 2.1 — CDP_PORT configurable via env (default 9333); cdp-session imports it. No behavioral change when unset"
    parallel: true
    depends-on: []
  - id: desktop-deeplink
    files: [desktop/src/main/index.ts]
    tests: []
    description: "Phase 0.2 — single-instance lock + mermaid-collab:// protocol registration + second-instance forwarding"
    parallel: true
    depends-on: [desktop-shell]
  - id: server-supervisor
    files: [desktop/src/main/server-supervisor.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Phase 1.1 — ServerSupervisor: spawn bun sidecar, poll /api/health, stop (SIGTERM / Windows taskkill); injectable spawn/fetch for tests"
    parallel: true
    depends-on: [desktop-shell]
  - id: cdp-electron-target
    files: [src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Phase 2.2 — electron-view mode in createOrReplaceTab: select existing WebContentsView target by marker via CDP.List, never Target.createTarget"
    parallel: true
    depends-on: [cdp-port-config]
  - id: supervisor-instance-dedup
    files: [desktop/src/main/server-supervisor.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Phase 1.2 — attach to a healthy already-running instance (via discovery registry) instead of double-binding"
    parallel: true
    depends-on: [server-supervisor]
  - id: browser-pane
    files: [desktop/src/main/browser-pane.ts, desktop/src/main/index.ts]
    tests: []
    description: "Phase 2.3 — create WebContentsView pane; set remote-debugging-port; pass CDP_PORT + MC_BROWSER_TARGET=electron-view to sidecar; browser_* tools drive the pane end-to-end"
    parallel: false
    depends-on: [server-supervisor, cdp-electron-target]
```

## Dependency Visualization

```mermaid
graph TD
    desktop-shell["desktop-shell<br/>"Phase 0.1 — electron-vite she..."]
    cdp-port-config["cdp-port-config<br/>"Phase 2.1 — CDP_PORT configur..."]
    desktop-deeplink["desktop-deeplink<br/>"Phase 0.2 — single-instance l..."]
    server-supervisor["server-supervisor<br/>"Phase 1.1 — ServerSupervisor:..."]
    cdp-electron-target["cdp-electron-target<br/>"Phase 2.2 — electron-view mod..."]
    supervisor-instance-dedup["supervisor-instance-dedup<br/>"Phase 1.2 — attach to a healt..."]
    browser-pane["browser-pane<br/>"Phase 2.3 — create WebContent..."]

     --> desktop-shell
     --> cdp-port-config
    desktop-shell --> desktop-deeplink
    desktop-shell --> server-supervisor
    cdp-port-config --> cdp-electron-target
    server-supervisor --> supervisor-instance-dedup
    server-supervisor --> browser-pane
    cdp-electron-target --> browser-pane

    style desktop-shell fill:#c8e6c9
    style cdp-port-config fill:#c8e6c9
    style desktop-deeplink fill:#bbdefb
    style server-supervisor fill:#bbdefb
    style cdp-electron-target fill:#bbdefb
    style supervisor-instance-dedup fill:#fff3e0
    style browser-pane fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **desktop-shell**: "Phase 0.1 — electron-vite shell skeleton; spikes moved to desktop/spikes/; contextIsolation+sandbox; placeholder renderer"
- **cdp-port-config**: "Phase 2.1 — CDP_PORT configurable via env (default 9333); cdp-session imports it. No behavioral change when unset"

### Wave 2

- **desktop-deeplink**: "Phase 0.2 — single-instance lock + mermaid-collab:// protocol registration + second-instance forwarding"
- **server-supervisor**: "Phase 1.1 — ServerSupervisor: spawn bun sidecar, poll /api/health, stop (SIGTERM / Windows taskkill); injectable spawn/fetch for tests"
- **cdp-electron-target**: "Phase 2.2 — electron-view mode in createOrReplaceTab: select existing WebContentsView target by marker via CDP.List, never Target.createTarget"

### Wave 3

- **supervisor-instance-dedup**: "Phase 1.2 — attach to a healthy already-running instance (via discovery registry) instead of double-binding"
- **browser-pane**: "Phase 2.3 — create WebContentsView pane; set remote-debugging-port; pass CDP_PORT + MC_BROWSER_TARGET=electron-view to sidecar; browser_* tools drive the pane end-to-end"
