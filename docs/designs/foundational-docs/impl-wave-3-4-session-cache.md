# Wave 3 & 4 Implementation — Watched Session Cache

## Tasks

### prefetch-watched-sessions-hook (Wave 3)
Created `ui/src/hooks/usePrefetchWatchedSessions.ts` — new hook that reads all watched subscriptions from `useSubscriptionStore` and fires staggered (200ms) background `loadSessionItems` calls for any session with a cold or stale cache. Dependency key is `Object.keys(subscriptions).join(',')` so it re-runs when a new session is subscribed.

### app-mount-prefetch (Wave 4)
Modified `ui/src/App.tsx`:
- Added import: `import { usePrefetchWatchedSessions } from '@/hooks/usePrefetchWatchedSessions';`
- Added hook call `usePrefetchWatchedSessions();` immediately after the `useDataLoader()` destructuring block (~line 262)

## Verification
Zero TypeScript errors introduced in either App.tsx or the new hook file.
