# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 6
- **Total waves:** 3
- **Max parallelism:** 2

## Execution Waves

**Wave 1:** tmux-naming, ws-handler-types
**Wave 2:** ide-routes, ide-state
**Wave 3:** vscode-extension, ui-subscriptions

## Task Graph (YAML)

```yaml
tasks:
  - id: tmux-naming
    files: [src/services/tmux-naming.ts]
    tests: [src/services/__tests__/tmux-naming.test.ts]
    description: "New pure helper tmuxBaseName(project, session) → mc-{basename}-{session}, with unit tests (slug, truncation, basename extraction, distinct names for same session across projects, documented same-basename collision)."
    parallel: true
    depends-on: []
  - id: ws-handler-types
    files: [src/websocket/handler.ts]
    tests: []
    description: "Extend WSMessage: add tmuxSession to ide_reattach; add ide_open_terminal member (session, project, tmuxSession)."
    parallel: true
    depends-on: []
  - id: ide-routes
    files: [src/routes/ide-routes.ts]
    tests: [src/routes/__tests__/ide-routes-create-terminal.test.ts]
    description: "create-terminal accepts project, names tmux session via tmuxBaseName, broadcasts project + tmuxSession in ide_open_terminal."
    parallel: true
    depends-on: [tmux-naming, ws-handler-types]
  - id: ide-state
    files: [src/services/ide-state.ts]
    tests: []
    description: "Add tmuxSession: tmuxBaseName(project, session) to the ide_reattach broadcast payload."
    parallel: true
    depends-on: [tmux-naming, ws-handler-types]
  - id: vscode-extension
    files: [extensions/vscode/src/extension.ts]
    tests: []
    description: "Consume msg.tmuxSession for base/target + grouped name; unique readable terminal display name '{session} · {projectBasename}'; thread project into focusTerminal name match; graceful fallback when project/tmuxSession absent."
    parallel: true
    depends-on: [ide-routes, ide-state]
  - id: ui-subscriptions
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Send project in 3 create-terminal callers; replicate tmuxBaseName locally; tmuxActive checks the derived name."
    parallel: true
    depends-on: [ide-routes]
```

## Dependency Visualization

```mermaid
graph TD
    tmux-naming["tmux-naming<br/>"New pure helper tmuxBaseName(..."]
    ws-handler-types["ws-handler-types<br/>"Extend WSMessage: add tmuxSes..."]
    ide-routes["ide-routes<br/>"create-terminal accepts proje..."]
    ide-state["ide-state<br/>"Add tmuxSession: tmuxBaseName..."]
    vscode-extension["vscode-extension<br/>"Consume msg.tmuxSession for b..."]
    ui-subscriptions["ui-subscriptions<br/>"Send project in 3 create-term..."]

     --> tmux-naming
     --> ws-handler-types
    tmux-naming --> ide-routes
    ws-handler-types --> ide-routes
    tmux-naming --> ide-state
    ws-handler-types --> ide-state
    ide-routes --> vscode-extension
    ide-state --> vscode-extension
    ide-routes --> ui-subscriptions

    style tmux-naming fill:#c8e6c9
    style ws-handler-types fill:#c8e6c9
    style ide-routes fill:#bbdefb
    style ide-state fill:#bbdefb
    style vscode-extension fill:#fff3e0
    style ui-subscriptions fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **tmux-naming**: "New pure helper tmuxBaseName(project, session) → mc-{basename}-{session}, with unit tests (slug, truncation, basename extraction, distinct names for same session across projects, documented same-basename collision)."
- **ws-handler-types**: "Extend WSMessage: add tmuxSession to ide_reattach; add ide_open_terminal member (session, project, tmuxSession)."

### Wave 2

- **ide-routes**: "create-terminal accepts project, names tmux session via tmuxBaseName, broadcasts project + tmuxSession in ide_open_terminal."
- **ide-state**: "Add tmuxSession: tmuxBaseName(project, session) to the ide_reattach broadcast payload."

### Wave 3

- **vscode-extension**: "Consume msg.tmuxSession for base/target + grouped name; unique readable terminal display name '{session} · {projectBasename}'; thread project into focusTerminal name match; graceful fallback when project/tmuxSession absent."
- **ui-subscriptions**: "Send project in 3 create-terminal callers; replicate tmuxBaseName locally; tmuxActive checks the derived name."
