# Skeleton: Item 6 - Browser notification when user input needed

## Planned Files
- [ ] `ui/src/App.tsx` - Modify existing (add permission request and notification)

**Note:** This is a modification to an existing file.

## File Changes

### ui/src/App.tsx (MODIFY)

```typescript
// ADD: Permission request useEffect (near other useEffects, around line 200)

useEffect(() => {
  // TODO: Request notification permission on mount
  // if ('Notification' in window && Notification.permission === 'default') {
  //   Notification.requestPermission();
  // }
}, []);

// MODIFY: case 'ui_render' handler (around line 326-345)

case 'ui_render': {
  const { uiId, project, session, ui, blocking, timestamp } = message as any;

  if (currentSession &&
      project === currentSession.project &&
      session === currentSession.name) {
    useChatStore.getState().addMessage({
      id: uiId,
      type: 'ui_render',
      ui,
      blocking: blocking ?? true,
      timestamp: timestamp || Date.now(),
      responded: false,
      project,
      session,
    });
    
    // TODO: Show browser notification for blocking messages
    // if (blocking && 'Notification' in window && Notification.permission === 'granted') {
    //   new Notification('Claude is asking...', {
    //     body: 'Click here to respond',
    //     tag: `claude-input-${uiId}`,
    //     requireInteraction: true,
    //   });
    // }
  }
  break;
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: item-6-notification
    files: [ui/src/App.tsx]
    tests: [ui/src/App.test.tsx, ui/src/__tests__/App.test.tsx]
    description: Add notification permission request and browser notification for blocking messages
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-6-notification

## Verification
- [ ] Permission request useEffect added
- [ ] Notification triggered for blocking messages only
- [ ] Feature detection for Notification API
- [ ] Permission check before showing notification
- [ ] Unique tag prevents duplicate notifications
