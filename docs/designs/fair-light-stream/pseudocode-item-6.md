# Pseudocode: Item 6 - Browser notification when user input needed

### App.tsx: Permission request on mount

```
useEffect ON MOUNT:

1. Check if Notification API is available:
   - IF 'Notification' NOT in window: return (unsupported browser)

2. Check current permission status:
   - IF Notification.permission === 'default':
     - Request permission: Notification.requestPermission()
     - (Returns Promise, we don't need to await or handle result)

3. No cleanup needed
```

### App.tsx: WebSocket handler for ui_render

```
CASE 'ui_render':

1. Extract message fields:
   - { uiId, project, session, ui, blocking, timestamp }

2. IF currentSession matches (project AND session):
   a. Add message to chat store (existing):
      - useChatStore.getState().addMessage({...})

   b. NEW: Show browser notification if blocking:
      - IF blocking is true
        AND 'Notification' in window
        AND Notification.permission === 'granted':
        
        - Create notification:
          new Notification('Claude is asking...', {
            body: 'Click here to respond',
            tag: `claude-input-${uiId}`,
            requireInteraction: true
          })

3. Break
```

### Notification behavior

```
- tag: Prevents duplicate notifications for same uiId
- requireInteraction: Keeps notification visible until user acts
- Clicking notification: Browser focuses the tab (default behavior)
- When user responds in UI: Notification auto-dismissed (same tag replaced)
```

**Error Handling:**
- Permission denied: Notification constructor returns null-ish, no error
- Notification API unavailable: Feature detection prevents errors
- Invalid options: Browser ignores unknown options

**Edge Cases:**
- User denies permission: No notifications, UI still works
- Multiple blocking messages: Each gets unique tag, all show
- User switches tabs before responding: Notification brings them back
- Non-blocking messages: No notification (blocking check)

**Dependencies:**
- Notification API (Browser)
- useChatStore (existing)
