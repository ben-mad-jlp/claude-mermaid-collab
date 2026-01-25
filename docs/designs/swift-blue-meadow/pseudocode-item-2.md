# Pseudocode: Item 2 - Fix task execution diagram color updates

## useDiagramUpdateQueue Hook

```
FUNCTION useDiagramUpdateQueue(updateDiagram, debounceMs = 100):
  pending = new Map<string, PendingUpdate>()
  timerRef = useRef(null)
  
  FUNCTION queueUpdate(id, content, lastModified):
    # Always keep the latest update for each diagram
    pending.set(id, { id, content, lastModified })
    
    # Reset debounce timer
    IF timerRef.current:
      clearTimeout(timerRef.current)
    
    timerRef.current = setTimeout(flush, debounceMs)
  
  FUNCTION flush():
    IF pending.size == 0:
      RETURN
    
    # Apply all pending updates atomically
    FOR each (id, update) in pending:
      updateDiagram(id, { 
        content: update.content, 
        lastModified: update.lastModified 
      })
    
    pending.clear()
  
  FUNCTION flushNow():
    IF timerRef.current:
      clearTimeout(timerRef.current)
    flush()
  
  # Cleanup on unmount
  useEffect(() => {
    RETURN () => {
      IF timerRef.current:
        clearTimeout(timerRef.current)
    }
  }, [])
  
  RETURN { queueUpdate, flushNow }
```

## App.tsx Message Handler Changes

```
# Current (problematic):
case 'diagram_updated':
  updateDiagram(id, { content, lastModified })  # Immediate, can race

# New (batched):
case 'diagram_updated':
  queueUpdate(id, content, lastModified)  # Queued, debounced
```

## Error Handling

- If updateDiagram throws: Log error, don't crash the queue
- If debounce timer fails: Fallback to immediate update

## Edge Cases

- Rapid updates to same diagram: Only latest is applied
- Updates to different diagrams: All applied in single flush
- Component unmount during pending: Timer cancelled, no update
