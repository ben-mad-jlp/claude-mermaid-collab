## Key Hook Implementations

### useWebSocket
```typescript
function useWebSocket(url?: string, autoConnect = true): UseWebSocketReturn {
  // Manages connection state, subscriptions, and message sending
  return { isConnected, isConnecting, error, send, subscribe, unsubscribe };
}
```

### useIsMobile
```typescript
function useIsMobile(): boolean {
  // Uses matchMedia to detect < 640px viewport
  // Listens for resize events and cleans up on unmount
}
```

### useAutoSave
```typescript
function useAutoSave(
  content: string,
  onSave: (content: string) => Promise<void>,
  debounceMs: number,
  resetKey?: string
): { isSaving: boolean; hasUnsavedChanges: boolean };
```

### useDataLoader
```typescript
function useDataLoader(): {
  isLoading: boolean;
  error: string | null;
  loadSessions: () => Promise<void>;
  loadSessionItems: (project: string, session: string) => Promise<void>;
};
```

### Hook Testing
Hooks have corresponding test files (e.g., `useIsMobile.test.ts`) using Vitest.