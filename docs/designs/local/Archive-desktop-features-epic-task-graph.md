# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 8
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** text-size, pty-tmux, browser-pane-manager
**Wave 2:** desktop-control-server, terminal-column, browser-panel
**Wave 3:** cdp-session-select, watching-drive

## Task Graph (YAML)

```yaml
tasks:
  - id: text-size
    files: [ui/src/App.tsx, ui/src/components/layout/Header.tsx]
    tests: [ui/src/stores/__tests__/uiStore.zoom.test.ts]
    description: "Apply uiStore.zoomLevel as a global root font-size scale + header text-size control; desktop setZoomFactor via IPC."
    parallel: true
    depends-on: []
  - id: pty-tmux
    files: [src/terminal/PTYManager.ts, src/routes/websocket.ts]
    tests: [src/terminal/__tests__/PTYManager.tmux.test.ts]
    description: "PTYManager tmux-attach spawn mode (grouped session, mirrors VSCodium) + WS opts plumbing."
    parallel: true
    depends-on: []
  - id: browser-pane-manager
    files: [desktop/src/main/browser-pane.ts, desktop/src/preload/index.ts]
    tests: [desktop/src/main/__tests__/browser-pane.test.ts]
    description: "BrowserPaneManager: N WebContentsViews, per-session/user markers, active-bounds, lifecycle + preload mc.browser bridge."
    parallel: true
    depends-on: []
  - id: desktop-control-server
    files: [desktop/src/main/desktop-control.ts, desktop/src/main/server-supervisor.ts, desktop/src/main/index.ts]
    tests: [desktop/src/main/__tests__/desktop-control.test.ts]
    description: "Token-guarded loopback control server (POST /panes/ensure → ensureSessionTab); supervisor env injection; start before supervisor; register browser IPC."
    parallel: false
    depends-on: [browser-pane-manager]
  - id: terminal-column
    files: [ui/src/stores/terminalStore.ts, ui/src/components/terminal/TerminalDrawer.tsx, ui/src/components/terminal/TerminalPane.tsx]
    tests: [ui/src/stores/__tests__/terminalStore.test.ts]
    description: "Tabbed terminal column + multi-tab store + openFor(project,session) mapping to tmux base name."
    parallel: false
    depends-on: [pty-tmux]
  - id: browser-panel
    files: [ui/src/stores/browserStore.ts, ui/src/components/browser/BrowserPanel.tsx]
    tests: [ui/src/stores/__tests__/browserStore.test.ts]
    description: "Browser panel: tab strip + address bar + native-view bounds container (ResizeObserver→setBounds); browserStore mirror + activateSession."
    parallel: false
    depends-on: [browser-pane-manager]
  - id: cdp-session-select
    files: [src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Per-session marker selection (selectElectronViewTarget(tabs,session)) + ensureTab control-endpoint call before listing; gated by electron-view + control url."
    parallel: false
    depends-on: [desktop-control-server]
  - id: watching-drive
    files: [ui/src/components/layout/SubscriptionsPanel.tsx, ui/src/App.tsx]
    tests: [ui/src/components/layout/__tests__/SubscriptionsPanel.drive.test.ts]
    description: "Verify/harden live Watching updates over the (fixed) WS proxy; row click drives the session's browser tab + terminal."
    parallel: false
    depends-on: [terminal-column, browser-panel]
```

## Dependency Visualization

```mermaid
graph TD
    text-size["text-size<br/>"Apply uiStore.zoomLevel as a ..."]
    pty-tmux["pty-tmux<br/>"PTYManager tmux-attach spawn ..."]
    browser-pane-manager["browser-pane-manager<br/>"BrowserPaneManager: N WebCont..."]
    desktop-control-server["desktop-control-server<br/>"Token-guarded loopback contro..."]
    terminal-column["terminal-column<br/>"Tabbed terminal column + mult..."]
    browser-panel["browser-panel<br/>"Browser panel: tab strip + ad..."]
    cdp-session-select["cdp-session-select<br/>"Per-session marker selection ..."]
    watching-drive["watching-drive<br/>"Verify/harden live Watching u..."]

     --> text-size
     --> pty-tmux
     --> browser-pane-manager
    browser-pane-manager --> desktop-control-server
    pty-tmux --> terminal-column
    browser-pane-manager --> browser-panel
    desktop-control-server --> cdp-session-select
    terminal-column --> watching-drive
    browser-panel --> watching-drive

    style text-size fill:#c8e6c9
    style pty-tmux fill:#c8e6c9
    style browser-pane-manager fill:#c8e6c9
    style desktop-control-server fill:#bbdefb
    style terminal-column fill:#bbdefb
    style browser-panel fill:#bbdefb
    style cdp-session-select fill:#fff3e0
    style watching-drive fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **text-size**: "Apply uiStore.zoomLevel as a global root font-size scale + header text-size control; desktop setZoomFactor via IPC."
- **pty-tmux**: "PTYManager tmux-attach spawn mode (grouped session, mirrors VSCodium) + WS opts plumbing."
- **browser-pane-manager**: "BrowserPaneManager: N WebContentsViews, per-session/user markers, active-bounds, lifecycle + preload mc.browser bridge."

### Wave 2

- **desktop-control-server**: "Token-guarded loopback control server (POST /panes/ensure → ensureSessionTab); supervisor env injection; start before supervisor; register browser IPC."
- **terminal-column**: "Tabbed terminal column + multi-tab store + openFor(project,session) mapping to tmux base name."
- **browser-panel**: "Browser panel: tab strip + address bar + native-view bounds container (ResizeObserver→setBounds); browserStore mirror + activateSession."

### Wave 3

- **cdp-session-select**: "Per-session marker selection (selectElectronViewTarget(tabs,session)) + ensureTab control-endpoint call before listing; gated by electron-view + control url."
- **watching-drive**: "Verify/harden live Watching updates over the (fixed) WS proxy; row click drives the session's browser tab + terminal."
