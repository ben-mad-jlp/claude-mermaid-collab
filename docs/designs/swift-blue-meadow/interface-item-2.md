# Interface: Item 2 - Fix task execution diagram color updates

## Interface Definition

### File Structure

- `ui/src/hooks/useDiagramUpdateQueue.ts` - New hook for batched updates
- `ui/src/stores/sessionStore.ts` - Modified to use update queue
- `ui/src/App.tsx` - Modified message handler

### Type Definitions

```typescript
// ui/src/hooks/useDiagramUpdateQueue.ts

interface PendingUpdate {
  id: string;
  content: string;
  lastModified: number;
}

interface DiagramUpdateQueue {
  pending: Map<string, PendingUpdate>;
  flush: () => void;
}
```

### Function Signatures

```typescript
// ui/src/hooks/useDiagramUpdateQueue.ts
function useDiagramUpdateQueue(
  updateDiagram: (id: string, updates: Partial<Diagram>) => void,
  debounceMs?: number  // default: 100
): {
  queueUpdate: (id: string, content: string, lastModified: number) => void;
  flushNow: () => void;
}
```

### Component Interactions

1. `App.tsx` receives `diagram_updated` WebSocket message
2. Instead of calling `updateDiagram` directly, calls `queueUpdate`
3. Hook debounces updates per diagram ID (keeps latest)
4. After debounce period, flushes all pending updates atomically
5. Store updates trigger single re-render with all changes
