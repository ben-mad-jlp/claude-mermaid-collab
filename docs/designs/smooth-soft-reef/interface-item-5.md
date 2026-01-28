# Interface Definition: Item 5

## Add real-time status updates via WebSocket

### File Structure

- `ui/src/lib/websocket.ts` - **MODIFY** - Dispatch CustomEvents for status messages
- `ui/src/App.tsx` - **MODIFY** - Set up global WebSocket message handler (if needed)

### Type Definitions

```typescript
// ui/src/lib/websocket.ts

/**
 * WebSocket message types that should dispatch CustomEvents
 */
type BroadcastMessageType = 'status_changed' | 'session_state_updated';

/**
 * Status changed event detail
 */
interface StatusChangedDetail {
  project: string;
  session: string;
  status: AgentStatus;
}

/**
 * Session state updated event detail
 */
interface SessionStateUpdatedDetail {
  project: string;
  session: string;
  state: SessionState;
}
```

### Function Signatures

```typescript
// ui/src/lib/websocket.ts

/**
 * Dispatch a CustomEvent to window for a WebSocket message.
 * Allows React hooks to subscribe without direct WebSocket access.
 */
function dispatchWebSocketEvent(type: BroadcastMessageType, detail: unknown): void;
```

### Component Interactions

1. Backend calls `wsHandler.broadcastStatus()` → sends `{ type: 'status_changed', ... }`
2. `ui/src/lib/websocket.ts` receives message in `onmessage` handler
3. For `status_changed` and `session_state_updated` types, call `dispatchWebSocketEvent()`
4. `window.dispatchEvent(new CustomEvent(type, { detail }))`
5. `useAgentStatus` hook already has `window.addEventListener('status_changed', ...)` 
6. Hook callback fires → state updates → UI re-renders

### Event Flow

```
Backend                  WebSocket Client              Window Events            React Hooks
   |                           |                            |                       |
   |-- broadcast status ------>|                            |                       |
   |                           |-- dispatchEvent() -------->|                       |
   |                           |                            |-- status_changed ---->|
   |                           |                            |                       | (setState)
```

### Verification Checklist

- [x] All files from design are listed (2 files)
- [x] All public interfaces have signatures
- [x] Parameter types are explicit
- [x] Return types are explicit
- [x] Component interactions documented
