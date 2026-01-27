# Interface: Item 6 - Browser notification when user input needed

## File Structure
- `ui/src/App.tsx` - Add permission request and notification trigger
- `ui/src/services/notification-service.ts` - **CREATE** (optional utility)

## Type Definitions

```typescript
// ui/src/services/notification-service.ts (optional)

export interface NotificationServiceOptions {
  defaultIcon?: string;
  defaultRequireInteraction?: boolean;
}

export interface ShowNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
}
```

## Function Signatures

```typescript
// ui/src/services/notification-service.ts (optional utility)

export function requestNotificationPermission(): Promise<NotificationPermission>
export function showNotification(options: ShowNotificationOptions): Notification | null
export function closeNotification(tag: string): void
```

## Implementation in App.tsx

```typescript
// ui/src/App.tsx

// On mount (in existing useEffect or new one):
useEffect(() => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}, []);

// In case 'ui_render' handler (around line 326-345):
case 'ui_render': {
  const { uiId, project, session, ui, blocking, timestamp } = message as any;
  
  // ... existing code ...
  
  // NEW: Show browser notification for blocking messages
  if (blocking && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Claude is asking...', {
      body: 'Click here to respond',
      tag: `claude-input-${uiId}`,
      requireInteraction: true,
    });
  }
  break;
}
```

## Component Interactions
- App.tsx requests permission on mount (non-blocking)
- WebSocket `ui_render` message with `blocking: true` triggers notification
- Notification `tag` prevents duplicates for same message
- User clicks notification or responds in UI → notification auto-dismissed via tag
