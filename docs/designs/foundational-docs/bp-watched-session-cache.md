# Blueprint: Watched-Session Prefetch Cache

## Source Artifacts
- `research-watched-session-cache` — root cause analysis, memory estimates, caching options
- `design-watched-session-cache` — full design doc with data model, implementation waves, open questions

---

## 1. Structure Summary

### Files

- [ ] `ui/src/lib/sessionItemsCache.ts` — **NEW** — module-level `Map` cache; get/set/patch/evict/TTL helpers
- [ ] `ui/src/hooks/useDataLoader.ts` — **MODIFY** — Phase 1 optimistic cache read before spinner; Phase 2 cache write after fetch
- [ ] `ui/src/stores/sessionStore.ts` — **MODIFY** — `setCurrentSession` pre-populates store from cache before clearing (eliminates empty-sidebar flash)
- [ ] `ui/src/hooks/usePrefetchWatchedSessions.ts` — **NEW** — hook that background-fetches all watched sessions with cold/stale cache on mount and on subscribe
- [ ] `ui/src/App.tsx` — **MODIFY** — mount `usePrefetchWatchedSessions()`; extend WS mutation handlers to patch cache for non-active sessions

### Type Definitions

```ts
// ui/src/lib/sessionItemsCache.ts

interface SessionItemsSnapshot {
  diagrams:     Diagram[];
  documents:    Document[];
  designs:      Design[];
  spreadsheets: Spreadsheet[];
  snippets:     Snippet[];
  embeds:       Embed[];
  images:       Image[];
  collabState:  CollabState | null;
  fetchedAt:    number; // Unix ms — used for TTL check
}

type SessionCacheKey = string; // "${project}:${session}"

export const SESSION_ITEMS_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

### Component Interactions

```
subscriptionStore.subscribe()
    └─► usePrefetchWatchedSessions (useEffect on subscriptions key)
            └─► loadSessionItems(project, session) [background]
                    ├─► setSessionItemsCache(project, session, snapshot)   [write]
                    └─► store setters (diagrams, documents, …)

setCurrentSession(session)                                     [sessionStore.ts:215]
    ├─► getSessionItemsCache(project, session)                 [synchronous read]
    └─► set({ diagrams: snapshot?.diagrams ?? [], … })         [optimistic populate]

App.tsx useEffect([currentSession])
    └─► loadSessionItems(project, session)
            ├─► getSessionItemsCache → warm?                   [Phase 1]
            │       ├─ yes → skip setIsLoading(true), populate store immediately
            │       └─ no  → setIsLoading(true) (spinner as today)
            └─► Promise.all(7 fetches) + loadCollabState       [Phase 2, always runs]
                    └─► setSessionItemsCache(…, freshSnapshot) [write back]

App.tsx WebSocket handler (diagram_created, document_created, …)
    ├─► patchSessionItemsCache(project, session, {…})          [all sessions]
    └─► store addDiagram / addDocument / …                     [active session only]
```

---

## 2. Function Blueprints

### `sessionItemsCache.ts` — module API

#### `getSessionItemsCache(project, session): SessionItemsSnapshot | undefined`
1. Compute key = `"${project}:${session}"`
2. Return `cache.get(key)` or `undefined`

**Edge cases:** always safe to call; undefined means cold cache.

#### `setSessionItemsCache(project, session, snapshot): void`
1. Compute key
2. `cache.set(key, snapshot)`

**Note:** `snapshot.fetchedAt` must be `Date.now()` at call site.

#### `patchSessionItemsCache(project, session, patch): void`
1. Compute key
2. Retrieve existing entry; if none, return early (no entry to patch)
3. Merge: `cache.set(key, { ...existing, ...patch, fetchedAt: existing.fetchedAt })`

**Why preserve `fetchedAt`:** a WS patch does not represent a full re-fetch; TTL clock should not reset.

#### `evictSessionItemsCache(project, session): void`
1. `cache.delete(makeCacheKey(project, session))`

#### `isCacheStale(snapshot): boolean`
1. Return `Date.now() - snapshot.fetchedAt > SESSION_ITEMS_TTL_MS`

---

### `useDataLoader.ts` — `loadSessionItems` (modified)

**Signature:** `async (project: string, session: string): Promise<void>`

**Pseudocode:**
1. Read cache: `cached = getSessionItemsCache(project, session)`
2. If `cached && !isCacheStale(cached)`:
   - Populate store from cache (`setDiagrams`, `setDocuments`, …, `setCollabState`)
   - **Skip** `setIsLoading(true)` — no spinner for warm-cache hits
3. Else: `setIsLoading(true)`
4. `setError(null)`
5. `[diagrams, documents, designs, spreadsheets, snippets, embeds, images] = await Promise.all([…7 fetches…])`
6. Set store with fresh data
7. `collabState = await loadCollabState(project, session)` (inline, not sequential — move into Promise.all in Wave 1 bonus)
8. `setSessionItemsCache(project, session, { diagrams, documents, …, collabState, fetchedAt: Date.now() })`
9. `catch` → `setError(message)`
10. `finally` → `setIsLoading(false)`

**Error handling:** network errors skip the cache write; existing cache entry remains valid until TTL.
**Edge case:** concurrent calls for the same session (e.g. prefetch + switch) both resolve to same data; second write is idempotent.

---

### `sessionStore.ts` — `setCurrentSession` (modified)

**Signature:** `(session: Session | null) => void`

**Pseudocode:**
1. Guard: if `current?.project === session?.project && current?.name === session?.name` → return early (unchanged)
2. `snapshot = session ? getSessionItemsCache(session.project, session.name) : undefined`
3. `set({`
   - `currentSession: session`
   - `diagrams: snapshot?.diagrams ?? []`
   - `documents: snapshot?.documents ?? []`
   - `designs: snapshot?.designs ?? []`
   - `spreadsheets: snapshot?.spreadsheets ?? []`
   - `snippets: snapshot?.snippets ?? []`
   - `embeds: snapshot?.embeds ?? []`
   - `images: snapshot?.images ?? []`
   - `collabState: snapshot?.collabState ?? null`
   - `selectedDiagramId: null, selectedDocumentId: null, …` (unchanged)
   - `sessionTodos: [], error: null`
   - `})`
4. Fire-and-forget `getSessionTodos` (unchanged, lines 247–260)

**Why here:** eliminates the one-render-cycle gap between `setCurrentSession` clearing and the `useEffect` in App.tsx applying the cache. The sidebar never shows empty.

---

### `usePrefetchWatchedSessions.ts` — new hook

**Signature:** `(): void`

**Pseudocode:**
1. Destructure `loadSessionItems` from `useDataLoader()`
2. `subscriptions = useSubscriptionStore(s => s.subscriptions)`
3. `useEffect`:
   a. `entries = Object.values(subscriptions)`
   b. For each `{ project, session }` at index `idx`:
      - `cached = getSessionItemsCache(project, session)`
      - If `!cached || isCacheStale(cached)`:
        - `setTimeout(() => loadSessionItems(project, session), idx * 200)`
4. Dependency: `Object.keys(subscriptions).join(',')` — fires on mount and when a new session is subscribed

**Why stagger (200 ms):** avoids a burst of 10+ parallel requests on app load with many watched sessions.
**Edge case:** if user unsubscribes during the stagger window, the prefetch still runs but `setSessionItemsCache` will write an orphaned entry — harmless, TTL clears it in 5 min.

---

### `App.tsx` — WS handler extension (Wave 3)

For each artifact mutation event type (`diagram_created`, `diagram_deleted`, `diagram_updated`, `document_created`, `document_deleted`, `document_updated`, `design_created`, `design_deleted`, `snippet_created`, `snippet_deleted`, `embed_created`, `embed_deleted`):

**Pseudocode for `_created` events:**
1. Extract `{ id, name, lastModified, project, session }` from message
2. `cached = getSessionItemsCache(project, session)`
3. If `cached`: `patchSessionItemsCache(project, session, { [artifactType]: [...cached.[type].filter(x => x.id !== id), { id, name, lastModified }] })`
4. Existing active-session store mutation (unchanged, guard: `project === currentSession?.project && session === currentSession?.name`)

**Pseudocode for `_deleted` events:**
1. Extract `{ id, project, session }`
2. `cached = getSessionItemsCache(project, session)`
3. If `cached`: `patchSessionItemsCache(project, session, { [type]: cached.[type].filter(x => x.id !== id) })`
4. Existing store removal (unchanged)

**Pseudocode for `_updated` events:**
1. Patch only `lastModified` in the cache list entry (content not cached)
2. Existing content update in store (unchanged)

---

## 3. Task Dependency Graph

### YAML Graph

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

### Execution Waves

**Wave 1 (parallel):**
- `session-items-cache`

**Wave 2 (depends on Wave 1, parallel with each other):**
- `data-loader-cache-integration`
- `session-store-optimistic-set`
- `ws-cache-patching`
- `subscription-eviction`

**Wave 3 (depends on data-loader-cache-integration):**
- `prefetch-watched-sessions-hook`

**Wave 4 (depends on prefetch-watched-sessions-hook):**
- `app-mount-prefetch`

### Summary
- Total tasks: 7
- Total waves: 4
- Max parallelism: 4 (Wave 2)
- Minimum shippable unit: Wave 1 + `data-loader-cache-integration` + `session-store-optimistic-set` (instant warm-cache switches with no new dependencies)
