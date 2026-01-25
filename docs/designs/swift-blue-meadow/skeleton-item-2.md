# Skeleton: Item 2 - Fix task execution diagram color updates

## Planned Files

- [ ] `ui/src/hooks/useDiagramUpdateQueue.ts` - NEW
- [ ] `ui/src/App.tsx` - MODIFY
- [ ] `ui/src/hooks/useDiagramUpdateQueue.test.ts` - NEW (test)

## File Contents

### ui/src/hooks/useDiagramUpdateQueue.ts

```typescript
import { useCallback, useRef, useEffect } from 'react';

interface PendingUpdate {
  id: string;
  content: string;
  lastModified: number;
}

interface UseDiagramUpdateQueueOptions {
  debounceMs?: number;
}

export function useDiagramUpdateQueue(
  updateDiagram: (id: string, updates: { content: string; lastModified: number }) => void,
  options: UseDiagramUpdateQueueOptions = {}
) {
  const { debounceMs = 100 } = options;
  const pending = useRef<Map<string, PendingUpdate>>(new Map());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // TODO: Implement queueUpdate
  // - Add update to pending map (replace if exists)
  // - Reset debounce timer
  // - After debounce, call flush()

  // TODO: Implement flush
  // - Apply all pending updates atomically
  // - Clear pending map

  // TODO: Implement flushNow
  // - Cancel timer
  // - Call flush immediately

  // TODO: Cleanup on unmount

  return { queueUpdate, flushNow };
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: diagram-update-queue-hook
    files: [ui/src/hooks/useDiagramUpdateQueue.ts]
    tests: [ui/src/hooks/useDiagramUpdateQueue.test.ts]
    description: New hook for batched diagram updates
    parallel: true

  - id: integrate-update-queue
    files: [ui/src/App.tsx]
    description: Use queue in WebSocket message handler
    depends-on: [diagram-update-queue-hook]
```

## Execution Order

1. Wave 1 (parallel): Create useDiagramUpdateQueue hook + tests
2. Wave 2: Modify App.tsx to use the hook
