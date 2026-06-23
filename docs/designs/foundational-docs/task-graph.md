# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 7
- **Total waves:** 4
- **Max parallelism:** 4

## Execution Waves

**Wave 1:** session-items-cache
**Wave 2:** data-loader-cache-integration, session-store-optimistic-set, ws-cache-patching, subscription-eviction
**Wave 3:** prefetch-watched-sessions-hook
**Wave 4:** app-mount-prefetch

## Task Graph (YAML)

```yaml
tasks:
  - id: session-items-cache
    files: [ui/src/lib/sessionItemsCache.ts]
    tests: [ui/src/lib/__tests__/sessionItemsCache.test.ts]
    description: "Create sessionItemsCache module — Map-based cache with get/set/patch/evict/TTL helpers"
    parallel: true
    depends-on: []
  - id: data-loader-cache-integration
    files: [ui/src/hooks/useDataLoader.ts]
    tests: [ui/src/lib/__tests__/data-loader.test.ts]
    description: "Modify loadSessionItems: Phase 1 optimistic cache read (skip spinner), Phase 2 cache write after fetch"
    parallel: false
    depends-on: [session-items-cache]
  - id: session-store-optimistic-set
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Modify setCurrentSession to pre-populate store from cache before clearing, eliminating empty-sidebar flash"
    parallel: false
    depends-on: [session-items-cache]
  - id: prefetch-watched-sessions-hook
    files: [ui/src/hooks/usePrefetchWatchedSessions.ts]
    tests: []
    description: "Create usePrefetchWatchedSessions hook — staggered background prefetch for all watched sessions on mount and subscribe"
    parallel: false
    depends-on: [data-loader-cache-integration]
  - id: app-mount-prefetch
    files: [ui/src/App.tsx]
    tests: []
    description: "Mount usePrefetchWatchedSessions() in App.tsx near existing hooks"
    parallel: false
    depends-on: [prefetch-watched-sessions-hook]
  - id: ws-cache-patching
    files: [ui/src/App.tsx]
    tests: []
    description: "Extend WS mutation handlers to call patchSessionItemsCache for all sessions (not just active)"
    parallel: false
    depends-on: [session-items-cache]
  - id: subscription-eviction
    files: [ui/src/stores/subscriptionStore.ts]
    tests: []
    description: "Call evictSessionItemsCache in unsubscribe action to clean up stale cache entries on explicit removal"
    parallel: false
    depends-on: [session-items-cache]
```

## Dependency Visualization

```mermaid
graph TD
    session-items-cache["session-items-cache<br/>"Create sessionItemsCache modu..."]
    data-loader-cache-integration["data-loader-cache-integration<br/>"Modify loadSessionItems: Phas..."]
    session-store-optimistic-set["session-store-optimistic-set<br/>"Modify setCurrentSession to p..."]
    prefetch-watched-sessions-hook["prefetch-watched-sessions-hook<br/>"Create usePrefetchWatchedSess..."]
    app-mount-prefetch["app-mount-prefetch<br/>"Mount usePrefetchWatchedSessi..."]
    ws-cache-patching["ws-cache-patching<br/>"Extend WS mutation handlers t..."]
    subscription-eviction["subscription-eviction<br/>"Call evictSessionItemsCache i..."]

     --> session-items-cache
    session-items-cache --> data-loader-cache-integration
    session-items-cache --> session-store-optimistic-set
    data-loader-cache-integration --> prefetch-watched-sessions-hook
    prefetch-watched-sessions-hook --> app-mount-prefetch
    session-items-cache --> ws-cache-patching
    session-items-cache --> subscription-eviction

    style session-items-cache fill:#c8e6c9
    style data-loader-cache-integration fill:#bbdefb
    style session-store-optimistic-set fill:#bbdefb
    style ws-cache-patching fill:#bbdefb
    style subscription-eviction fill:#bbdefb
    style prefetch-watched-sessions-hook fill:#fff3e0
    style app-mount-prefetch fill:#f3e5f5
```

## Tasks by Wave

### Wave 1

- **session-items-cache**: "Create sessionItemsCache module — Map-based cache with get/set/patch/evict/TTL helpers"

### Wave 2

- **data-loader-cache-integration**: "Modify loadSessionItems: Phase 1 optimistic cache read (skip spinner), Phase 2 cache write after fetch"
- **session-store-optimistic-set**: "Modify setCurrentSession to pre-populate store from cache before clearing, eliminating empty-sidebar flash"
- **ws-cache-patching**: "Extend WS mutation handlers to call patchSessionItemsCache for all sessions (not just active)"
- **subscription-eviction**: "Call evictSessionItemsCache in unsubscribe action to clean up stale cache entries on explicit removal"

### Wave 3

- **prefetch-watched-sessions-hook**: "Create usePrefetchWatchedSessions hook — staggered background prefetch for all watched sessions on mount and subscribe"

### Wave 4

- **app-mount-prefetch**: "Mount usePrefetchWatchedSessions() in App.tsx near existing hooks"
