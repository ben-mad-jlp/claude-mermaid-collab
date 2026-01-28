# Pseudocode: Item 5

## Add real-time status updates via WebSocket

### ui/src/lib/websocket.ts

#### dispatchWebSocketEvent(type, detail)

```
FUNCTION dispatchWebSocketEvent(type, detail):
  event = new CustomEvent(type, { detail })
  window.dispatchEvent(event)
```

#### WebSocket onmessage handler (modify existing)

```
ws.onmessage = (event) => {
  data = JSON.parse(event.data)
  
  // Handle existing message types (terminal output, etc.)
  // ... existing logic ...
  
  // ADD: Bridge broadcast messages to CustomEvents
  IF data.type === 'status_changed':
    dispatchWebSocketEvent('status_changed', {
      project: data.project,
      session: data.session,
      status: data.status
    })
    
  ELSE IF data.type === 'session_state_updated':
    dispatchWebSocketEvent('session_state_updated', {
      project: data.project,
      session: data.session,
      state: data.state
    })
}
```

### ui/src/hooks/useAgentStatus.ts (reference - no changes needed)

```
// Already has this listener:
useEffect(() => {
  const handler = (event: CustomEvent) => {
    setStatus(event.detail.status)
  }
  
  window.addEventListener('status_changed', handler)
  return () => window.removeEventListener('status_changed', handler)
}, [])
```

### ui/src/App.tsx (optional - may not need changes)

```
// If websocket.ts doesn't have global message handler,
// we might need to set one up here.

// But if websocket.ts already handles all incoming messages,
// just ensure the onmessage handler includes the new dispatch logic.

// DECISION: Check websocket.ts implementation to see if
// onmessage handler is already centralized or if App.tsx
// needs to wire it up.
```

### Verification

- [x] All functions from interface covered
- [x] dispatchWebSocketEvent bridges WS to window events
- [x] Handles both status_changed and session_state_updated
- [x] Existing useAgentStatus hook needs no changes
- [x] Polling remains as fallback
