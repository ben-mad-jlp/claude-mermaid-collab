# Wave 1 & 2 Implementation — Watched Session Cache

## Tasks

### session-items-cache (Wave 1)
Created `ui/src/lib/sessionItemsCache.ts` — module-level Map cache with exports: `SessionItemsSnapshot`, `SESSION_ITEMS_TTL_MS`, `makeCacheKey`, `getSessionItemsCache`, `setSessionItemsCache`, `patchSessionItemsCache`, `evictSessionItemsCache`, `isCacheStale`.

### data-loader-cache-integration (Wave 2)
Modified `ui/src/hooks/useDataLoader.ts` — stale-while-revalidate pattern in `loadSessionItems`: Phase 1 populates store from cache immediately (no spinner), Phase 2 always runs network fetch and writes fresh snapshot back to cache.

### session-store-optimistic-set (Wave 2)
Modified `ui/src/stores/sessionStore.ts` — `setCurrentSession` now reads cache before clearing, pre-populating all artifact arrays from snapshot instead of empty arrays. Eliminates empty-sidebar flash on session switch.

### ws-cache-patching (Wave 2)
Modified `ui/src/App.tsx` — all 8 WS mutation handlers (diagram/document/design/snippet _created/_deleted) now also patch the module-level cache for non-active sessions. Fix applied: added `content: ''` placeholder to _created patch objects to satisfy Diagram/Document/Snippet type requirements.

### subscription-eviction (Wave 2)
Modified `ui/src/stores/subscriptionStore.ts` — `unsubscribe` action now calls `evictSessionItemsCache(entry.project, entry.session)` before deleting the subscription entry.

## Verification
TypeScript clean in all wave files. Pre-existing errors in unrelated files (PseudoPage.tsx, agentStore.ts, etc.) — not introduced by this work.
