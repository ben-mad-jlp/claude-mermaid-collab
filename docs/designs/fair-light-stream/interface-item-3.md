# Interface: Item 3 - Task quantity auto updating via WebSocket

## File Structure
- `src/websocket/handler.ts` - Add new message type
- `src/mcp/setup.ts` - Broadcast on state update
- `ui/src/App.tsx` - Handle new message type

## Type Definitions

```typescript
// src/websocket/handler.ts - ADD to WSMessage union

| { type: 'session_state_updated'; project: string; session: string; state: CollabState }
```

```typescript
// Existing type reference (no changes needed)
// src/mcp/tools/collab-state.ts or ui/src/stores/sessionStore.ts
interface CollabState {
  phase: string;
  lastActivity: string;
  currentItem: number | null;
  totalItems?: number;
  documentedItems?: number;
  pendingTasks?: string[];
  completedTasks?: string[];
  hasSnapshot?: boolean;
}
```

## Function Signatures

```typescript
// src/websocket/handler.ts
// Existing broadcast method - no signature change
broadcast(message: WSMessage): void

// New convenience method (optional)
broadcastSessionState(project: string, session: string, state: CollabState): void
```

## Component Interactions

```
MCP update_session_state → src/mcp/setup.ts
  → updateSessionState() writes file
  → wsHandler.broadcast({ type: 'session_state_updated', project, session, state })
  → WebSocket → ui/src/App.tsx
  → case 'session_state_updated': sessionStore.setCollabState(state)
  → SessionStatusPanel re-renders with new task counts
```
