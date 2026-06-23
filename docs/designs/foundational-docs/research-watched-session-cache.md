# Research: Watched Session Cache — Eliminating Switch Lag

## Executive Summary

Switching between watched sessions currently triggers a full round-trip data fetch for every switch. The lag is real and entirely avoidable. A `Map`-based prefetch cache — populated on subscribe and kept warm by the existing WebSocket push — can make switches instant at low memory cost.

---

## 1. How Watched Sessions Work

### Subscription state (`subscriptionStore.ts`)

Watched sessions are tracked in Zustand's `useSubscriptionStore`. Each entry stores:

```ts
{ project, session, claudeSessionId?, status, lastUpdate }
```

Subscriptions are persisted in `localStorage` (`session-subscriptions` and `session-subscriptions-order`). Status (`active | waiting | permission | unknown`) is updated in real time via `claude_session_status` WebSocket messages. **No artifact data is cached** — only status metadata.

### Navigation flow (`SubscriptionsPanel.tsx`)

Clicking a watched session row calls:

```ts
setCurrentSession(target)  // → sessionStore.setCurrentSession
```

### What `setCurrentSession` does (`sessionStore.ts` L215–260)

Every session switch:
1. **Clears all artifact state**: `diagrams`, `documents`, `designs`, `spreadsheets`, `snippets`, `embeds`, `images`, `sessionTodos`, `collabState` all reset to empty arrays/null.
2. Immediately fires a `getSessionTodos` fetch (fire-and-forget).

### What the `currentSession` change triggers (`App.tsx` L1056–1079)

A `useEffect` watching `currentSession` runs `loadSessionItems`, which is **7 parallel HTTP fetches**:

```ts
const [diagrams, documents, designs, spreadsheets, snippets, embeds, images] = await Promise.all([
  api.getDiagrams(project, session),
  api.getDocuments(project, session),
  api.getDesigns(project, session),
  api.getSpreadsheets(project, session),
  api.getSnippets(project, session),
  embedsApi.fetchEmbeds(session, project),
  api.listImages(project, session),
]);
```

After these resolve, `loadCollabState` adds an 8th fetch (`/api/session-state`). Then the active tab's artifact content is fetched individually.

There is also a `getSessionTodos` fetch fired from `setCurrentSession` itself (9th request total on switch).

### Root cause of lag

Every switch to a watched session initiates **8–9 sequential and parallel HTTP requests** from scratch. There is zero client-side caching of artifact lists. The UI shows a loading spinner (via `isLoading`) while the `Promise.all` resolves, leaving the user with a blank content area.

---

## 2. What Gets Fetched and How Large Is It

### List endpoints return metadata only

The backend `listDiagrams()` and `listDocuments()` methods return only `{ id, name, lastModified }` per item — **no content**. The same pattern holds for designs, spreadsheets, and snippets. Content is fetched individually on artifact selection.

### Typical payload estimates

| Artifact type | Typical items | Bytes per item (metadata) | Total |
|---|---|---|---|
| Diagrams | 3–10 | ~120 B | ~0.5–1.2 KB |
| Documents | 3–15 | ~120 B | ~0.4–1.8 KB |
| Designs | 1–5 | ~120 B | ~0.1–0.6 KB |
| Spreadsheets | 0–3 | ~120 B | ~0–0.4 KB |
| Snippets | 2–10 | ~120 B | ~0.2–1.2 KB |
| Embeds | 0–5 | ~200 B | ~0–1 KB |
| Images (metadata) | 0–10 | ~180 B | ~0–1.8 KB |
| Session state (collab) | 1 | ~500 B | ~0.5 KB |
| Session todos | 0–20 | ~100 B | ~0–2 KB |

**Per-session metadata cache size: ~3–10 KB**

Content (diagram source, document markdown, design JSON) adds weight when actually opened — typically 1–50 KB per artifact — but that is fetched on demand and does not need to be pre-cached.

### Worst-case memory for N watched sessions (metadata only)

| Watched sessions | Estimated cache size |
|---|---|
| 5 | ~15–50 KB |
| 20 | ~60–200 KB |
| 50 | ~150–500 KB |
| 100 | ~300 KB–1 MB |

**Conclusion: caching all watched session metadata simultaneously is not problematic.** Even 100 sessions with generous artifact counts would consume well under 5 MB — negligible in a modern browser context.

---

## 3. Existing Caching Patterns in the Codebase

### `useSessionList.ts` — module-level `Map` cache

```ts
const sessionListCache = new Map<string, SessionMetadata[]>();
```

This is the closest existing pattern: a module-level `Map` keyed by `projectRoot`. On load it serves the cached value immediately and refetches in the background. It also listens to `sessions_list_invalidated` WebSocket messages to invalidate on demand.

### WebSocket push for subscribed sessions

`claude_session_status` messages already flow through for every watched session. This provides a ready-made "push channel" for keeping a cache warm without polling.

### `getUIState` / `restoreUIState` in `App.tsx`

The app already restores cached UI state from the backend on reconnection. This shows a precedent for "restore from cache, then verify" patterns.

---

## 4. Proposed Caching Strategy

### Option A: Module-level `Map` prefetch cache (recommended)

Extend the pattern from `useSessionList` to the full session-items payload.

**What to cache:**
- The artifact list metadata for each watched session (`diagrams[]`, `documents[]`, `designs[]`, `spreadsheets[]`, `snippets[]`, `embeds[]`, `images[]`, `sessionTodos[]`, `collabState`)
- Keyed by `"${project}:${session}"`

**When to populate:**
1. When a session is subscribed (subscribe action in `subscriptionStore`)
2. Eagerly on app load for all already-subscribed sessions (background fetch waterfall or batched)
3. After any WebSocket mutation event for a watched-but-not-active session (e.g. `diagram_created` carrying a non-current session key)

**When to invalidate / revalidate:**
- On any WebSocket event matching the cached session key — apply incremental updates to the cache (same logic as `App.tsx` already does for the active session)
- On explicit user refresh
- TTL of ~5 minutes as a safety net for sessions where WS events may be missed

**Switch behavior with cache:**
1. `setCurrentSession` is called
2. Instead of clearing to empty arrays, **immediately populate from cache** if entry exists
3. In the background, revalidate stale entries (refetch lists; compare `lastModified`)
4. No loading spinner shown if cache hit

**Implementation sketch:**

```ts
// sessionItemsCache.ts (new module)
interface SessionItemsSnapshot {
  diagrams: Diagram[];
  documents: Document[];
  designs: Design[];
  spreadsheets: Spreadsheet[];
  snippets: Snippet[];
  embeds: Embed[];
  images: Image[];
  collabState: CollabState | null;
  sessionTodos: SessionTodo[];
  fetchedAt: number;
}

const cache = new Map<string, SessionItemsSnapshot>();

export function getCachedItems(project: string, session: string) {
  return cache.get(`${project}:${session}`) ?? null;
}

export function setCachedItems(project: string, session: string, snapshot: SessionItemsSnapshot) {
  cache.set(`${project}:${session}`, snapshot);
}

export function invalidateCachedItems(project: string, session: string) {
  cache.delete(`${project}:${session}`);
}

export function patchCachedItems(project: string, session: string, patch: Partial<SessionItemsSnapshot>) {
  const existing = cache.get(`${project}:${session}`);
  if (existing) cache.set(`${project}:${session}`, { ...existing, ...patch });
}
```

Modify `setCurrentSession` in `sessionStore`:
- If `getCachedItems(project, session)` returns a hit, populate store immediately from cache instead of clearing to empty
- Schedule background revalidation

Modify `loadSessionItems` in `useDataLoader`:
- After successful fetch, call `setCachedItems` to store the snapshot

Modify WebSocket handler in `App.tsx`:
- For non-active-session mutation events (e.g. `diagram_created` where `project !== currentSession.project || session !== currentSession.name`), call `patchCachedItems` to keep the cache current

Modify `subscribe` action in `subscriptionStore`:
- Trigger a background prefetch of the session items immediately after subscribing

### Option B: Stale-while-revalidate via React Query / SWR

Replace `useDataLoader` with `useQuery` from TanStack Query or `useSWR`. Both support:
- Automatic deduplication
- Background revalidation
- `staleTime` configuration
- Per-query caching keyed by `[project, session, 'items']`

**Pros:** battle-tested, handles edge cases (focus refetch, window visibility)
**Cons:** new dependency; requires restructuring how data flows into the store; the WebSocket push integration needs custom `queryClient.setQueryData()` calls

### Option C: WebSocket push to keep cache warm (complementary)

The server already broadcasts mutation events. Extend the `claude_session_status` / artifact mutation messages to also apply to **non-current** watched sessions:

In `App.tsx`, the WebSocket handler currently guards every event with `project === currentSession.project && session === currentSession.name`. Relaxing this guard for cache-write operations (not store-write) allows the cache to stay current for all watched sessions without any polling.

This is a natural complement to Option A, not a standalone solution, since the initial population still requires HTTP fetches.

---

## 5. Recommendation

**Implement Option A with Option C as a complement.**

1. **Create `sessionItemsCache.ts`** — module-level `Map<string, SessionItemsSnapshot>` with get/set/patch/invalidate helpers. No new dependencies.

2. **Modify `setCurrentSession`** — check cache before clearing; populate immediately if hit; mark for background revalidation.

3. **Modify `loadSessionItems`** — write to cache after every successful fetch.

4. **Prefetch on subscribe** — when user clicks "Watch a session", trigger `loadSessionItems` in the background.

5. **Prefetch all watched sessions on app load** — after `loadSessions()` resolves, fire background fetches for all subscribed sessions not currently loaded.

6. **Extend the WebSocket handler** — for artifact mutation events from non-active sessions, call `patchCachedItems` to keep the cache current incrementally.

7. **TTL safety net** — treat entries older than 5 minutes as stale; revalidate in background on switch.

### Expected outcome

- **Switch latency: ~0 ms** for warm cache (typical case after initial load)
- **Switch latency: ~200–500 ms** for cold cache (first switch, or after TTL expiry) — unchanged from today
- **Memory overhead: negligible** (~5–50 KB for typical 5–20 watched sessions)
- **No new dependencies required**

---

## 6. What Not to Cache

- **Artifact content** (diagram source, document markdown, design JSON): fetch on demand as today. Content can be large (10s of KB per item) and changes frequently; the stale-while-revalidate benefit is lower.
- **Agent chat history**: already managed by `agentStore` with its own fetch lifecycle.
- **Question/UI state**: transient; not worth caching.
