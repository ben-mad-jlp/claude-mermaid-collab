# Skeleton: Item 5

## Add real-time status updates via WebSocket

### Task Graph

```yaml
tasks:
  - id: item5-dispatch-function
    file: ui/src/lib/websocket.ts
    action: modify
    description: Add dispatchWebSocketEvent helper function
    depends: []
    
  - id: item5-message-handler
    file: ui/src/lib/websocket.ts
    action: modify
    description: Add status_changed and session_state_updated dispatch in onmessage
    depends: [item5-dispatch-function]
```

### Stub Code

#### ui/src/lib/websocket.ts

```typescript
// ADD: Event types to dispatch
const BROADCAST_MESSAGE_TYPES = ['status_changed', 'session_state_updated'] as const;
type BroadcastMessageType = typeof BROADCAST_MESSAGE_TYPES[number];

// ADD: Helper function
function dispatchWebSocketEvent(type: BroadcastMessageType, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

// MODIFY: In existing onmessage handler or WebSocket class
// Add this after parsing the message:

/*
  if (data.type === 'status_changed') {
    dispatchWebSocketEvent('status_changed', {
      project: data.project,
      session: data.session,
      status: data.status
    });
  } else if (data.type === 'session_state_updated') {
    dispatchWebSocketEvent('session_state_updated', {
      project: data.project,
      session: data.session,
      state: data.state
    });
  }
*/
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] 2 tasks - appropriate for scope
- [x] Minimal changes to existing code
