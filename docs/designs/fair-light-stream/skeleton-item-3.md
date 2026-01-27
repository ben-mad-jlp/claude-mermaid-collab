# Skeleton: Item 3 - Task quantity auto updating via WebSocket

## Planned Files
- [ ] `src/websocket/handler.ts` - Modify existing (add message type)
- [ ] `src/mcp/setup.ts` - Modify existing (add broadcast)
- [ ] `ui/src/App.tsx` - Modify existing (handle new message)

**Note:** All modifications to existing files.

## File Changes

### src/websocket/handler.ts (MODIFY)

```typescript
// ADD to WSMessage type union (around line 31)

export type WSMessage =
  // ... existing types ...
  | { type: 'status_changed'; status: 'working' | 'waiting' | 'idle'; message?: string; lastActivity: string }
  // TODO: Add session_state_updated message type
  | { type: 'session_state_updated'; project: string; session: string; state: CollabState };
```

### src/mcp/setup.ts (MODIFY)

```typescript
// In case 'update_session_state' handler (around line 1046-1061)
// After updateSessionState call, add broadcast

case 'update_session_state': {
  const { project, session, ...updates } = params;
  const result = await updateSessionState(project, session, updates);
  
  // TODO: Broadcast state update to connected clients
  // wsHandler.broadcast({
  //   type: 'session_state_updated',
  //   project,
  //   session,
  //   state: result  // or read fresh state
  // });
  
  return JSON.stringify(result, null, 2);
}
```

### ui/src/App.tsx (MODIFY)

```typescript
// ADD new case in WebSocket message handler (around line 365)

case 'session_state_updated': {
  // TODO: Handle session state updates
  const { project, session, state } = message as {
    type: 'session_state_updated';
    project: string;
    session: string;
    state: CollabState;
  };
  
  // Only update if matches current session
  if (currentSession &&
      project === currentSession.project &&
      session === currentSession.name) {
    useSessionStore.getState().setCollabState(state);
  }
  break;
}
```

## Task Dependency Graph

```yaml
tasks:
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
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-3-ws-type

**Wave 2 (depends on Wave 1):**
- item-3-mcp-broadcast (parallel)
- item-3-app-handler (parallel)

## Verification
- [ ] WSMessage type includes session_state_updated
- [ ] MCP handler broadcasts after state update
- [ ] App.tsx handles new message type
- [ ] Only updates if current session matches
