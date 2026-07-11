# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 20
- **Total waves:** 5
- **Max parallelism:** 10

## Execution Waves

**Wave 1:** session-type-serverid, connection-capabilities, aggregator-claude-events, proxy-srv-routing
**Wave 2:** session-store-persist, session-creation-serverid, subscriptions-capability-gates, app-consume-aggregator, sidebarview-consume-aggregator, resolve-image-src-srv, milkdown-embed-bridge-srv, terminal-drawer-picker, add-project-picker, parse-deep-link-srv
**Wave 3:** artifact-tree-multi-server, create-session-picker, sidebar-view-search-params
**Wave 4:** server-context-cleanup, proxy-setupstream-remove
**Wave 5:** delete-switcher-ui

## Task Graph (YAML)

```yaml
tasks:
  - id: session-type-serverid
    files: [ui/src/types/session.ts]
    tests: []
    description: "Add serverId to Session type"
    parallel: true
    depends-on: []
  - id: connection-capabilities
    files: [desktop/src/main/connection-store.ts]
    tests: []
    description: "Track per-server tmux capability"
    parallel: true
    depends-on: []
  - id: aggregator-claude-events
    files: [ui/src/services/WatchAggregator.ts]
    tests: []
    description: "Extend aggregator subscription set with claude_session_* and claude_context_update; emit tagged"
    parallel: true
    depends-on: []
  - id: proxy-srv-routing
    files: [desktop/src/main/server-proxy.ts]
    tests: []
    description: "Add /srv/<id>/api/... routing to ServerProxy"
    parallel: true
    depends-on: []
  - id: session-store-persist
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Persist currentSession; validate server online on restore; fall back to picker"
    parallel: true
    depends-on: [session-type-serverid]
  - id: session-creation-serverid
    files: []
    tests: []
    description: "Backfill serverId at every session-creation call site (grep all callers)"
    parallel: true
    depends-on: [session-type-serverid]
  - id: subscriptions-capability-gates
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Replace activeId gates at lines 199-227, 304-313, 622-631 with capability flag check"
    parallel: true
    depends-on: [connection-capabilities]
  - id: app-consume-aggregator
    files: [ui/src/App.tsx]
    tests: []
    description: "App.tsx:962-992 consume aggregator stream; drop activeId tagging"
    parallel: true
    depends-on: [aggregator-claude-events]
  - id: sidebarview-consume-aggregator
    files: [ui/src/components/layout/SidebarView.tsx]
    tests: []
    description: "SidebarView.tsx:25-33 consume aggregator stream; drop activeId tagging"
    parallel: true
    depends-on: [aggregator-claude-events]
  - id: resolve-image-src-srv
    files: [ui/src/utils/resolveImageSrc.ts]
    tests: []
    description: "Inject /srv/<id>/ prefix based on artifact.serverId"
    parallel: true
    depends-on: [proxy-srv-routing]
  - id: milkdown-embed-bridge-srv
    files: [ui/src/utils/milkdownEmbedBridge.ts]
    tests: []
    description: "Inject /srv/<id>/ prefix for embed iframe URLs"
    parallel: true
    depends-on: [proxy-srv-routing]
  - id: artifact-tree-multi-server
    files: [ui/src/hooks/useDataLoader.ts]
    tests: []
    description: "Artifact-tree + current-session queries accept serverId; fetch via mc.invokeOnServer or /srv/<id>"
    parallel: true
    depends-on: [session-type-serverid, session-store-persist, proxy-srv-routing]
  - id: create-session-picker
    files: [ui/src/App.tsx]
    tests: []
    description: "CreateSessionDialog gets server picker; default to SubscriptionsPanel row's server"
    parallel: true
    depends-on: [session-type-serverid, session-creation-serverid]
  - id: terminal-drawer-picker
    files: [ui/src/components/terminal/TerminalDrawer.tsx]
    tests: []
    description: "Convert '+' to NewTerminalDropdown; default to currentSession.serverId"
    parallel: true
    depends-on: [session-type-serverid]
  - id: add-project-picker
    files: [ui/src/components/layout/MobileHeader.tsx, ui/src/components/.../ProjectSelector.tsx]
    tests: []
    description: "Add Project flow gets server picker; default local"
    parallel: true
    depends-on: [session-type-serverid]
  - id: parse-deep-link-srv
    files: [desktop/src/main/index.ts]
    tests: []
    description: "parseDeepLink reads ?srv=<id>&project=&session="
    parallel: true
    depends-on: [session-type-serverid]
  - id: sidebar-view-search-params
    files: [ui/src/components/layout/SidebarView.tsx]
    tests: []
    description: "SidebarView reads ?srv=<id> via useSearchParams"
    parallel: true
    depends-on: [parse-deep-link-srv]
  - id: server-context-cleanup
    files: [ui/src/contexts/ServerContext.tsx]
    tests: []
    description: "Remove activeId/setActive; rename hook useServer→useServers; expose connected/capabilities/health"
    parallel: false
    depends-on: [subscriptions-capability-gates, app-consume-aggregator, sidebarview-consume-aggregator, artifact-tree-multi-server, create-session-picker, terminal-drawer-picker, add-project-picker, resolve-image-src-srv, milkdown-embed-bridge-srv]
  - id: delete-switcher-ui
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Delete server switcher UI from Header"
    parallel: true
    depends-on: [server-context-cleanup]
  - id: proxy-setupstream-remove
    files: [desktop/src/main/server-proxy.ts, desktop/src/main/connection-store.ts]
    tests: []
    description: "Remove setUpstream/active-upstream pinning; proxy routes by path only"
    parallel: true
    depends-on: [artifact-tree-multi-server, proxy-srv-routing, resolve-image-src-srv, milkdown-embed-bridge-srv]
```

## Dependency Visualization

```mermaid
graph TD
    session-type-serverid["session-type-serverid<br/>"Add serverId to Session type""]
    connection-capabilities["connection-capabilities<br/>"Track per-server tmux capabil..."]
    aggregator-claude-events["aggregator-claude-events<br/>"Extend aggregator subscriptio..."]
    proxy-srv-routing["proxy-srv-routing<br/>"Add /srv/<id>/api/... routing..."]
    session-store-persist["session-store-persist<br/>"Persist currentSession; valid..."]
    session-creation-serverid["session-creation-serverid<br/>"Backfill serverId at every se..."]
    subscriptions-capability-gates["subscriptions-capability-gates<br/>"Replace activeId gates at lin..."]
    app-consume-aggregator["app-consume-aggregator<br/>"App.tsx:962-992 consume aggre..."]
    sidebarview-consume-aggregator["sidebarview-consume-aggregator<br/>"SidebarView.tsx:25-33 consume..."]
    resolve-image-src-srv["resolve-image-src-srv<br/>"Inject /srv/<id>/ prefix base..."]
    milkdown-embed-bridge-srv["milkdown-embed-bridge-srv<br/>"Inject /srv/<id>/ prefix for ..."]
    artifact-tree-multi-server["artifact-tree-multi-server<br/>"Artifact-tree + current-sessi..."]
    create-session-picker["create-session-picker<br/>"CreateSessionDialog gets serv..."]
    terminal-drawer-picker["terminal-drawer-picker<br/>"Convert '+' to NewTerminalDro..."]
    add-project-picker["add-project-picker<br/>"Add Project flow gets server ..."]
    parse-deep-link-srv["parse-deep-link-srv<br/>"parseDeepLink reads ?srv=<id>..."]
    sidebar-view-search-params["sidebar-view-search-params<br/>"SidebarView reads ?srv=<id> v..."]
    server-context-cleanup["server-context-cleanup<br/>"Remove activeId/setActive; re..."]
    delete-switcher-ui["delete-switcher-ui<br/>"Delete server switcher UI fro..."]
    proxy-setupstream-remove["proxy-setupstream-remove<br/>"Remove setUpstream/active-ups..."]

     --> session-type-serverid
     --> connection-capabilities
     --> aggregator-claude-events
     --> proxy-srv-routing
    session-type-serverid --> session-store-persist
    session-type-serverid --> session-creation-serverid
    connection-capabilities --> subscriptions-capability-gates
    aggregator-claude-events --> app-consume-aggregator
    aggregator-claude-events --> sidebarview-consume-aggregator
    proxy-srv-routing --> resolve-image-src-srv
    proxy-srv-routing --> milkdown-embed-bridge-srv
    session-type-serverid --> artifact-tree-multi-server
    session-store-persist --> artifact-tree-multi-server
    proxy-srv-routing --> artifact-tree-multi-server
    session-type-serverid --> create-session-picker
    session-creation-serverid --> create-session-picker
    session-type-serverid --> terminal-drawer-picker
    session-type-serverid --> add-project-picker
    session-type-serverid --> parse-deep-link-srv
    parse-deep-link-srv --> sidebar-view-search-params
    subscriptions-capability-gates --> server-context-cleanup
    app-consume-aggregator --> server-context-cleanup
    sidebarview-consume-aggregator --> server-context-cleanup
    artifact-tree-multi-server --> server-context-cleanup
    create-session-picker --> server-context-cleanup
    terminal-drawer-picker --> server-context-cleanup
    add-project-picker --> server-context-cleanup
    resolve-image-src-srv --> server-context-cleanup
    milkdown-embed-bridge-srv --> server-context-cleanup
    server-context-cleanup --> delete-switcher-ui
    artifact-tree-multi-server --> proxy-setupstream-remove
    proxy-srv-routing --> proxy-setupstream-remove
    resolve-image-src-srv --> proxy-setupstream-remove
    milkdown-embed-bridge-srv --> proxy-setupstream-remove

    style session-type-serverid fill:#c8e6c9
    style connection-capabilities fill:#c8e6c9
    style aggregator-claude-events fill:#c8e6c9
    style proxy-srv-routing fill:#c8e6c9
    style session-store-persist fill:#bbdefb
    style session-creation-serverid fill:#bbdefb
    style subscriptions-capability-gates fill:#bbdefb
    style app-consume-aggregator fill:#bbdefb
    style sidebarview-consume-aggregator fill:#bbdefb
    style resolve-image-src-srv fill:#bbdefb
    style milkdown-embed-bridge-srv fill:#bbdefb
    style terminal-drawer-picker fill:#bbdefb
    style add-project-picker fill:#bbdefb
    style parse-deep-link-srv fill:#bbdefb
    style artifact-tree-multi-server fill:#fff3e0
    style create-session-picker fill:#fff3e0
    style sidebar-view-search-params fill:#fff3e0
    style server-context-cleanup fill:#f3e5f5
    style proxy-setupstream-remove fill:#f3e5f5
    style delete-switcher-ui fill:#ffccbc
```

## Tasks by Wave

### Wave 1

- **session-type-serverid**: "Add serverId to Session type"
- **connection-capabilities**: "Track per-server tmux capability"
- **aggregator-claude-events**: "Extend aggregator subscription set with claude_session_* and claude_context_update; emit tagged"
- **proxy-srv-routing**: "Add /srv/<id>/api/... routing to ServerProxy"

### Wave 2

- **session-store-persist**: "Persist currentSession; validate server online on restore; fall back to picker"
- **session-creation-serverid**: "Backfill serverId at every session-creation call site (grep all callers)"
- **subscriptions-capability-gates**: "Replace activeId gates at lines 199-227, 304-313, 622-631 with capability flag check"
- **app-consume-aggregator**: "App.tsx:962-992 consume aggregator stream; drop activeId tagging"
- **sidebarview-consume-aggregator**: "SidebarView.tsx:25-33 consume aggregator stream; drop activeId tagging"
- **resolve-image-src-srv**: "Inject /srv/<id>/ prefix based on artifact.serverId"
- **milkdown-embed-bridge-srv**: "Inject /srv/<id>/ prefix for embed iframe URLs"
- **terminal-drawer-picker**: "Convert '+' to NewTerminalDropdown; default to currentSession.serverId"
- **add-project-picker**: "Add Project flow gets server picker; default local"
- **parse-deep-link-srv**: "parseDeepLink reads ?srv=<id>&project=&session="

### Wave 3

- **artifact-tree-multi-server**: "Artifact-tree + current-session queries accept serverId; fetch via mc.invokeOnServer or /srv/<id>"
- **create-session-picker**: "CreateSessionDialog gets server picker; default to SubscriptionsPanel row's server"
- **sidebar-view-search-params**: "SidebarView reads ?srv=<id> via useSearchParams"

### Wave 4

- **server-context-cleanup**: "Remove activeId/setActive; rename hook useServer→useServers; expose connected/capabilities/health"
- **proxy-setupstream-remove**: "Remove setUpstream/active-upstream pinning; proxy routes by path only"

### Wave 5

- **delete-switcher-ui**: "Delete server switcher UI from Header"
