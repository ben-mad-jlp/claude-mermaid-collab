# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 5
- **Total waves:** 3
- **Max parallelism:** 2

## Execution Waves

**Wave 1:** watch-aggregator, watch-store
**Wave 2:** watch-ipc, switcher-multiselect
**Wave 3:** watch-feed

## Task Graph (YAML)

```yaml
tasks:
  - id: watch-aggregator
    files: [desktop/src/main/watch-aggregator.ts]
    tests: [desktop/src/main/__tests__/watch-aggregator.test.ts]
    description: "Main-process WS multiplexer: per-server ws, filter claude_session_* frames, forward with serverId, reconnect with backoff, setWatched diff, stop()."
    parallel: true
    depends-on: []
  - id: watch-store
    files: [ui/src/stores/watchStore.ts]
    tests: [ui/src/stores/__tests__/watchStore.test.ts]
    description: "Persisted watch-set (watchedIds) + toggleWatched/isWatched; pushes id list to window.mc.setWatchedServers; no-op without mc."
    parallel: true
    depends-on: []
  - id: watch-ipc
    files: [desktop/src/preload/index.ts, desktop/src/main/index.ts]
    tests: []
    description: "preload setWatchedServers/onWatchEvent; main: instantiate WatchAggregator (forward→webContents.send mc:watch-event), IPC mc:setWatchedServers resolving ids→creds via ConnectionStore, before-quit stop()."
    parallel: false
    depends-on: [watch-aggregator]
  - id: watch-feed
    files: [ui/src/hooks/useWatchEvents.ts, ui/src/App.tsx, ui/src/contexts/ServerContext.tsx]
    tests: []
    description: "McBridge type (setWatchedServers/onWatchEvent); useWatchEvents hook subscribes mc.onWatchEvent → subscriptionStore (passive, reuses App.tsx mapping); mount in App.tsx."
    parallel: false
    depends-on: [watch-store, watch-ipc]
  - id: switcher-multiselect
    files: [ui/src/components/ServerSwitcher.tsx]
    tests: []
    description: "Per-row 👁 watch toggle wired to watchStore (independent of active ✓), stopPropagation; optional 'watching N' count."
    parallel: false
    depends-on: [watch-store]
```

## Dependency Visualization

```mermaid
graph TD
    watch-aggregator["watch-aggregator<br/>"Main-process WS multiplexer: ..."]
    watch-store["watch-store<br/>"Persisted watch-set (watchedI..."]
    watch-ipc["watch-ipc<br/>"preload setWatchedServers/onW..."]
    watch-feed["watch-feed<br/>"McBridge type (setWatchedServ..."]
    switcher-multiselect["switcher-multiselect<br/>"Per-row 👁 watch toggle wired..."]

     --> watch-aggregator
     --> watch-store
    watch-aggregator --> watch-ipc
    watch-store --> watch-feed
    watch-ipc --> watch-feed
    watch-store --> switcher-multiselect

    style watch-aggregator fill:#c8e6c9
    style watch-store fill:#c8e6c9
    style watch-ipc fill:#bbdefb
    style switcher-multiselect fill:#bbdefb
    style watch-feed fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **watch-aggregator**: "Main-process WS multiplexer: per-server ws, filter claude_session_* frames, forward with serverId, reconnect with backoff, setWatched diff, stop()."
- **watch-store**: "Persisted watch-set (watchedIds) + toggleWatched/isWatched; pushes id list to window.mc.setWatchedServers; no-op without mc."

### Wave 2

- **watch-ipc**: "preload setWatchedServers/onWatchEvent; main: instantiate WatchAggregator (forward→webContents.send mc:watch-event), IPC mc:setWatchedServers resolving ids→creds via ConnectionStore, before-quit stop()."
- **switcher-multiselect**: "Per-row 👁 watch toggle wired to watchStore (independent of active ✓), stopPropagation; optional 'watching N' count."

### Wave 3

- **watch-feed**: "McBridge type (setWatchedServers/onWatchEvent); useWatchEvents hook subscribes mc.onWatchEvent → subscriptionStore (passive, reuses App.tsx mapping); mount in App.tsx."
