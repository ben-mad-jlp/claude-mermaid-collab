# Pseudocode: Item 3 - Task quantity auto updating via WebSocket

### Backend: MCP update_session_state handler (src/mcp/setup.ts)

```
WHEN update_session_state tool is called:

1. Parse updates from request (phase, currentItem, tasks, etc.)

2. Call updateSessionState(project, session, updates)
   - Writes to collab-state.json file

3. Read the updated state back (or use return value)

4. Broadcast via WebSocket:
   - wsHandler.broadcast({
       type: 'session_state_updated',
       project,
       session,
       state: updatedState
     })

5. Return success response to MCP client
```

### Frontend: App.tsx WebSocket handler

```
WHEN WebSocket message received with type 'session_state_updated':

1. Extract { project, session, state } from message

2. IF currentSession matches (project AND session):
   - Call sessionStore.setCollabState(state)
   - This triggers React re-render of SessionStatusPanel

3. ELSE (different session):
   - Ignore message (not relevant to current view)
```

### Type Addition: WSMessage union (src/websocket/handler.ts)

```
ADD to WSMessage type:
| { type: 'session_state_updated'; project: string; session: string; state: CollabState }
```

**Error Handling:**
- WebSocket send failure: Logged, dead connections cleaned up (existing pattern)
- State parse error: Frontend ignores malformed messages

**Edge Cases:**
- Multiple tabs open: All receive broadcast, all update if same session
- Session switch during update: New session won't see old session's updates
- Rapid state changes: Each broadcast sent, UI shows latest

**Dependencies:**
- WebSocketHandler.broadcast (existing)
- sessionStore.setCollabState (existing)
- CollabState type (existing)
