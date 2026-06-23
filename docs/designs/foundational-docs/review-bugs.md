# Bug Review — Watched Session Cache

## Summary

5 bugs found across 3 files. 2 critical, 2 important, 1 minor.

---

## Bug 1 — Critical: Prefetch fires after unsubscribe (race condition)

**File:** `ui/src/hooks/usePrefetchWatchedSessions.ts`, lines 13–19  
**What's wrong:**  
The staggered `setTimeout` captures `{ project, session }` at effect-fire time but does not re-verify that the session is still subscribed when the timeout actually fires. If the user unsubscribes a session within the stagger window (0 – `(n-1)*200` ms), `loadSessionItems` runs for a session that has already been evicted from the cache via `unsubscribe → evictSessionItemsCache`. The fetch succeeds and calls `setSessionItemsCache`, reinstating a cache entry for a session that was deliberately removed. It also pollutes the live store (`setDiagrams`, `setDocuments`, etc.) if the user happens to have navigated to that session in the meantime.

**Fix:**
```ts
setTimeout(() => {
  const stillSubscribed = useSubscriptionStore.getState().subscriptions;
  const key = `${project}:${session}`;
  if (!stillSubscribed[key]) return;
  loadSessionItems(project, session);
}, idx * 200);
```

---

## Bug 2 — Critical: `finally` unconditionally clears the spinner for background revalidation calls

**File:** `ui/src/hooks/useDataLoader.ts`, lines 142–144 and 184–186  
**What's wrong:**  
When the cache is warm, the code correctly skips `setIsLoading(true)` (no spinner). But the `finally` block unconditionally calls `setIsLoading(false)`. If a foreground `loadSessionItems` call (which did set `isLoading = true`) is running concurrently with a background revalidation triggered by prefetch, whichever finishes first calls `setIsLoading(false)` and clears the spinner for the other. The `isLoading` state is a single shared slot per `useDataLoader` instance — two concurrent callers step on each other.

**Fix:**  
Track whether this particular invocation showed the spinner, and only clear it if so:
```ts
let showedSpinner = false;
if (cached && !isCacheStale(cached)) {
  // serve from cache; background revalidate silently
} else {
  showedSpinner = true;
  setIsLoading(true);
}
// ...
finally {
  if (showedSpinner) setIsLoading(false);
}
```

---

## Bug 3 — Important: `collabState` snapshot may capture a different session's state

**File:** `ui/src/hooks/useDataLoader.ts`, lines 165–178  
**What's wrong:**  
After `await loadCollabState(project, session)` resolves, the code reads `collabState` from the Zustand store via `useSessionStore.getState()`. But `collabState` in the store is a single global slot — it is not keyed by session. If two concurrent `loadSessionItems` calls are in flight (e.g. prefetch stagger for session B fires while session A's `loadCollabState` is still pending), session B's `loadCollabState` may resolve and overwrite the slot first. Session A's snapshot then captures session B's `collabState`.

**Fix:**  
Return the value directly from `loadCollabState` rather than re-reading the store:
```ts
const loadCollabState = useCallback(
  async (project: string, session: string): Promise<CollabState | null> => {
    try {
      const state = await api.getSessionState(project, session);
      setCollabState(state);
      return state;
    } catch (err) {
      console.error('Failed to load collab state:', err);
      setCollabState(null);
      return null;
    }
  },
  [setCollabState]
);

// In loadSessionItems, replace the two-step read with:
const collabState = await loadCollabState(project, session);
const snapshot: SessionItemsSnapshot = { ..., collabState, fetchedAt: Date.now() };
```

---

## Bug 4 — Important: Stale cache entries kept alive indefinitely by WebSocket patches

**File:** `ui/src/App.tsx`, every `patchSessionItemsCache` call site (lines 493, 519, 540, 561, 587, 622, 680, 711)  
**What's wrong:**  
The WebSocket event handlers call `patchSessionItemsCache` whenever `_existing` is truthy — regardless of whether that entry is stale. A stale entry (one where `isCacheStale` would return `true`) continues to receive partial mutations as long as WebSocket events arrive, so `isCacheStale` never gets a chance to return `true` from `usePrefetchWatchedSessions`'s perspective. The result is that the prefetch hook never re-fetches for a session that has accumulated stale partial state, and the next time the user switches to it they may see an inconsistent snapshot that is part-old-fetch, part-live-events.

`patchSessionItemsCache` itself correctly preserves `fetchedAt` (line 49 of `sessionItemsCache.ts`) — the problem is not there, it is at the call sites that skip the staleness check.

**Fix:**  
Import `isCacheStale` in `App.tsx` (it is already imported at line 42 alongside `getSessionItemsCache`) and guard each patch block:
```ts
const _existing = getSessionItemsCache(project, session);
if (_existing && !isCacheStale(_existing)) {
  patchSessionItemsCache(project, session, { ... });
}
```

---

## Bug 5 — Minor: Stale closure on `loadSessionItems` due to suppressed exhaustive-deps

**File:** `ui/src/hooks/usePrefetchWatchedSessions.ts`, line 11 and line 21  
**What's wrong:**  
The effect dependency array uses an inline expression `[Object.keys(subscriptions).join(',')]` and suppresses the exhaustive-deps lint rule with `// eslint-disable-line`. This hides that `loadSessionItems` is missing from the deps array. `loadSessionItems` is a `useCallback` from `useDataLoader` that depends on multiple store setters. If any of those setter references change identity (e.g. after a store reset or hot reload), `loadSessionItems` gets a new identity but the effect closure retains the stale version. In practice, Zustand store actions are stable across re-renders, so this is low-probability — but it is a latent correctness issue that the suppressed lint rule masks.

**Fix:**  
Derive a stable memo value for the dep and include `loadSessionItems` properly:
```ts
const subscriptionKeys = useMemo(
  () => Object.keys(subscriptions).sort().join(','),
  [subscriptions]
);

useEffect(() => {
  // ...
}, [subscriptionKeys, loadSessionItems]);
// remove the two eslint-disable comments
```

---

## File Index

| File | Bugs |
|---|---|
| `ui/src/lib/sessionItemsCache.ts` | none |
| `ui/src/hooks/usePrefetchWatchedSessions.ts` | Bug 1 (critical), Bug 5 (minor) |
| `ui/src/hooks/useDataLoader.ts` | Bug 2 (critical), Bug 3 (important) |
| `ui/src/stores/sessionStore.ts` | none |
| `ui/src/stores/subscriptionStore.ts` | none |
| `ui/src/App.tsx` | Bug 4 (important) |
