# Task Dependency Graph - All Items

## Combined YAML Graph

```yaml
tasks:
  # Item 1: Auto-select new terminal
  - id: item-1-terminal-autoselect
    files: [ui/src/hooks/useTerminalTabs.ts]
    tests: [ui/src/hooks/useTerminalTabs.test.ts, ui/src/hooks/__tests__/useTerminalTabs.test.ts]
    description: Modify addTab to auto-select new terminal after creation
    parallel: true

  # Item 2: Fix terminal close project change
  - id: item-2-header-fix
    files: [ui/src/components/layout/Header.tsx]
    tests: [ui/src/components/layout/Header.test.tsx, ui/src/components/layout/__tests__/Header.test.tsx]
    description: Fix useEffect dependencies to prevent state sync issues on terminal close
    parallel: true

  # Item 3: Task quantity auto updating
  - id: item-3-ws-type
    files: [src/websocket/handler.ts]
    tests: [src/websocket/handler.test.ts, src/websocket/__tests__/handler.test.ts]
    description: Add session_state_updated message type to WSMessage union
    parallel: true

  - id: item-3-mcp-broadcast
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts, src/mcp/__tests__/setup.test.ts]
    description: Broadcast session state after updateSessionState
    depends-on: [item-3-ws-type]

  - id: item-3-app-handler
    files: [ui/src/App.tsx]
    tests: [ui/src/App.test.tsx, ui/src/__tests__/App.test.tsx]
    description: Handle session_state_updated in WebSocket handler
    depends-on: [item-3-ws-type]

  # Item 4: Terminal selection without copying
  - id: item-4-xterm-component
    files: [ui/src/components/terminal/XTermTerminal.tsx]
    tests: [ui/src/components/terminal/XTermTerminal.test.tsx, ui/src/components/terminal/__tests__/XTermTerminal.test.tsx]
    description: Create new XTermTerminal component with xterm.js
    parallel: true

  - id: item-4-embedded-terminal
    files: [ui/src/components/EmbeddedTerminal.tsx]
    tests: [ui/src/components/EmbeddedTerminal.test.tsx, ui/src/components/__tests__/EmbeddedTerminal.test.tsx]
    description: Update EmbeddedTerminal to use XTermTerminal instead of iframe
    depends-on: [item-4-xterm-component]

  # Item 5: Disable tmux splitting
  - id: item-5-tmux-unbind
    files: [src/services/terminal-manager.ts]
    tests: [src/services/terminal-manager.test.ts, src/services/__tests__/terminal-manager.test.ts]
    description: Add tmux unbind-key commands to disable pane splitting
    parallel: true

  # Item 6: Browser notification
  - id: item-6-notification
    files: [ui/src/App.tsx]
    tests: [ui/src/App.test.tsx, ui/src/__tests__/App.test.tsx]
    description: Add notification permission request and browser notification for blocking messages
    parallel: true
```

## Execution Waves

**Wave 1 (all parallel - no dependencies):**
- item-1-terminal-autoselect
- item-2-header-fix
- item-3-ws-type
- item-4-xterm-component
- item-5-tmux-unbind
- item-6-notification

**Wave 2 (depends on Wave 1):**
- item-3-mcp-broadcast (depends on item-3-ws-type)
- item-3-app-handler (depends on item-3-ws-type)
- item-4-embedded-terminal (depends on item-4-xterm-component)

## File Conflict Analysis

**Note:** item-3-app-handler and item-6-notification both modify `ui/src/App.tsx`. They should NOT run in parallel to avoid merge conflicts.

**Recommended execution:**
1. Run item-6-notification first (simpler change)
2. Then run item-3-app-handler (adds new case)

Or combine into single task if preferred.

## Summary

| Task ID | Files | Dependencies | Wave |
|---------|-------|--------------|------|
| item-1-terminal-autoselect | useTerminalTabs.ts | none | 1 |
| item-2-header-fix | Header.tsx | none | 1 |
| item-3-ws-type | handler.ts | none | 1 |
| item-3-mcp-broadcast | setup.ts | item-3-ws-type | 2 |
| item-3-app-handler | App.tsx | item-3-ws-type | 2 |
| item-4-xterm-component | XTermTerminal.tsx | none | 1 |
| item-4-embedded-terminal | EmbeddedTerminal.tsx | item-4-xterm-component | 2 |
| item-5-tmux-unbind | terminal-manager.ts | none | 1 |
| item-6-notification | App.tsx | none | 1* |

*Note: item-6-notification should run before item-3-app-handler due to shared file.
