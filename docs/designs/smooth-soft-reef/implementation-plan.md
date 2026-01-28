# Implementation Plan

## Summary

- **8 work items** documented
- **27 tasks** in dependency graph
- **9 parallel-safe tasks** in first batch
- **Files affected:** 12 unique files

## Combined Task Dependency Graph

```yaml
tasks:
  # Item 1: Fix render_ui timeout
  - id: item1-transport-types
    file: src/mcp/http-transport.ts
    description: Add HandlePostOptions interface and update PendingResponse type
    depends: []
    
  - id: item1-transport-handlepost
    file: src/mcp/http-transport.ts
    description: Update handlePost to accept options parameter and handle timeout=-1
    depends: [item1-transport-types]
    
  - id: item1-api-route
    file: src/routes/api.ts
    description: Pass timeout option to handlePost for blocking render_ui calls
    depends: [item1-transport-handlepost]

  # Item 2: Add item drawer toggle
  - id: item2-preview-tab-button
    file: ui/src/components/mobile/PreviewTab.tsx
    description: Add Browse Items button to empty state
    depends: []

  # Item 3: Add terminal button
  - id: item3-terminaltab-props
    file: ui/src/components/mobile/TerminalTab.tsx
    description: Add onCreateTerminal prop to TerminalTabProps interface
    depends: []
    
  - id: item3-terminaltab-button
    file: ui/src/components/mobile/TerminalTab.tsx
    description: Add New Terminal button to empty state
    depends: [item3-terminaltab-props]
    
  - id: item3-mobilelayout-handler
    file: ui/src/components/mobile/MobileLayout.tsx
    description: Add handleCreateTerminal function and pass to TerminalTab
    depends: [item3-terminaltab-props]

  # Item 4: Fix terminal sizing
  - id: item4-pty-types
    file: src/terminal/PTYManager.ts
    description: Add hasReceivedResize and deferReplay fields to PTYSession
    depends: []
    
  - id: item4-pty-attach
    file: src/terminal/PTYManager.ts
    description: Update attach() to support deferReplay option
    depends: [item4-pty-types]
    
  - id: item4-pty-replay
    file: src/terminal/PTYManager.ts
    description: Add replayBuffer() method
    depends: [item4-pty-types]
    
  - id: item4-pty-resize
    file: src/terminal/PTYManager.ts
    description: Update resize() to trigger replay on first resize
    depends: [item4-pty-replay]
    
  - id: item4-ws-handler
    file: src/routes/websocket.ts
    description: Pass deferReplay:true to attach(), handle isInitial flag
    depends: [item4-pty-attach]
    
  - id: item4-client-resize
    file: ui/src/components/terminal/XTermTerminal.tsx
    description: Send resize with isInitial:true on WebSocket open
    depends: []

  # Item 5: Real-time status updates
  - id: item5-dispatch-function
    file: ui/src/lib/websocket.ts
    description: Add dispatchWebSocketEvent helper function
    depends: []
    
  - id: item5-message-handler
    file: ui/src/lib/websocket.ts
    description: Add status_changed and session_state_updated dispatch in onmessage
    depends: [item5-dispatch-function]

  # Item 6: Auto-flag Kodex topics
  - id: item6-kodex-hasflag
    file: src/services/kodex-manager.ts
    description: Add hasFlag method to check for existing flags
    depends: []
    
  - id: item6-kodex-createflag
    file: src/services/kodex-manager.ts
    description: Add createFlag method with dedupe support
    depends: [item6-kodex-hasflag]
    
  - id: item6-query-autoflag
    file: src/mcp/setup.ts
    description: Update kodex_query_topic to auto-flag missing and add hint
    depends: [item6-kodex-createflag]

  # Item 7: State display names
  - id: item7-display-names-const
    file: src/mcp/workflow/state-machine.ts
    description: Add STATE_DISPLAY_NAMES constant mapping
    depends: []
    
  - id: item7-get-display-name
    file: src/mcp/workflow/state-machine.ts
    description: Add getDisplayName function with clear-* handling
    depends: [item7-display-names-const]
    
  - id: item7-session-manager
    file: src/services/session-manager.ts
    description: Add displayName to getSessionState return, derive phase
    depends: [item7-get-display-name]
    
  - id: item7-ui-update
    file: ui/src/components/
    description: Update UI components to use displayName instead of phase/state
    depends: [item7-session-manager]

  # Item 8: Fix state machine per-item pipeline
  - id: item8-types-itemstatus
    file: src/mcp/workflow/types.ts
    description: Replace WorkItem status type with unified ItemStatus pipeline
    depends: []
    
  - id: item8-transitions-conditions
    file: src/mcp/workflow/transitions.ts
    description: Add itemReadyFor* condition functions for each pipeline phase
    depends: [item8-types-itemstatus]
    
  - id: item8-statemachine-helpers
    file: src/mcp/workflow/state-machine.ts
    description: Add findNextPendingItem, updateItemStatus, getCurrentWorkItem helpers
    depends: [item8-types-itemstatus]
    
  - id: item8-statemachine-getnextstate
    file: src/mcp/workflow/state-machine.ts
    description: Update getNextState to implement per-item pipeline flow
    depends: [item8-statemachine-helpers, item8-transitions-conditions]
    
  - id: item8-migration
    file: src/mcp/workflow/state-machine.ts
    description: Add migration logic to convert 'documented' → 'brainstormed'
    depends: [item8-types-itemstatus]
```

## Execution Order

### Batch 1 (no dependencies - 9 parallel tasks)
| Task ID | File | Description |
|---------|------|-------------|
| item1-transport-types | src/mcp/http-transport.ts | Add HandlePostOptions interface |
| item2-preview-tab-button | ui/src/components/mobile/PreviewTab.tsx | Add Browse Items button |
| item3-terminaltab-props | ui/src/components/mobile/TerminalTab.tsx | Add onCreateTerminal prop |
| item4-pty-types | src/terminal/PTYManager.ts | Add PTYSession fields |
| item4-client-resize | ui/src/components/terminal/XTermTerminal.tsx | Send initial resize |
| item5-dispatch-function | ui/src/lib/websocket.ts | Add dispatchWebSocketEvent |
| item6-kodex-hasflag | src/services/kodex-manager.ts | Add hasFlag method |
| item7-display-names-const | src/mcp/workflow/state-machine.ts | Add STATE_DISPLAY_NAMES |
| item8-types-itemstatus | src/mcp/workflow/types.ts | Add ItemStatus type |

### Batch 2 (depends on batch 1 - 11 tasks)
| Task ID | File | Description |
|---------|------|-------------|
| item1-transport-handlepost | src/mcp/http-transport.ts | Update handlePost |
| item3-terminaltab-button | ui/src/components/mobile/TerminalTab.tsx | Add New Terminal button |
| item3-mobilelayout-handler | ui/src/components/mobile/MobileLayout.tsx | Add handleCreateTerminal |
| item4-pty-attach | src/terminal/PTYManager.ts | Update attach() |
| item4-pty-replay | src/terminal/PTYManager.ts | Add replayBuffer() |
| item5-message-handler | ui/src/lib/websocket.ts | Add dispatch in onmessage |
| item6-kodex-createflag | src/services/kodex-manager.ts | Add createFlag method |
| item7-get-display-name | src/mcp/workflow/state-machine.ts | Add getDisplayName |
| item8-transitions-conditions | src/mcp/workflow/transitions.ts | Add condition functions |
| item8-statemachine-helpers | src/mcp/workflow/state-machine.ts | Add helper functions |
| item8-migration | src/mcp/workflow/state-machine.ts | Add migration logic |

### Batch 3 (depends on batch 2 - 6 tasks)
| Task ID | File | Description |
|---------|------|-------------|
| item1-api-route | src/routes/api.ts | Pass timeout option |
| item4-pty-resize | src/terminal/PTYManager.ts | Update resize() |
| item4-ws-handler | src/routes/websocket.ts | Pass deferReplay to attach |
| item6-query-autoflag | src/mcp/setup.ts | Update kodex_query_topic |
| item7-session-manager | src/services/session-manager.ts | Add displayName to state |
| item8-statemachine-getnextstate | src/mcp/workflow/state-machine.ts | Update getNextState |

### Batch 4 (depends on batch 3 - 1 task)
| Task ID | File | Description |
|---------|------|-------------|
| item7-ui-update | ui/src/components/ | Update UI to use displayName |

## Files by Item

| Item | Files |
|------|-------|
| 1 | src/mcp/http-transport.ts, src/routes/api.ts |
| 2 | ui/src/components/mobile/PreviewTab.tsx |
| 3 | ui/src/components/mobile/TerminalTab.tsx, ui/src/components/mobile/MobileLayout.tsx |
| 4 | src/terminal/PTYManager.ts, src/routes/websocket.ts, ui/src/components/terminal/XTermTerminal.tsx |
| 5 | ui/src/lib/websocket.ts |
| 6 | src/services/kodex-manager.ts, src/mcp/setup.ts |
| 7 | src/mcp/workflow/state-machine.ts, src/services/session-manager.ts, ui/src/components/ |
| 8 | src/mcp/workflow/types.ts, src/mcp/workflow/transitions.ts, src/mcp/workflow/state-machine.ts |
