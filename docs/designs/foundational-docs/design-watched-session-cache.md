# Design: Watched-Session Prefetch Cache

**Status:** Draft  
**Date:** 2026-04-21  
**Scope:** `ui/src/` — frontend only, no server changes required

---

## 1. Problem

Every time the user switches between watched sessions in the collab UI, the app fires 8–9 HTTP requests from scratch and displays a full loading spinner until all of them complete. The requests are:

1. `api.getDiagrams(project, session)` — `/api/diagrams`
2. `api.getDocuments(project, session)` — `/api/documents`
3. `api.getDesigns(project, session)` — `/api/designs`
4. `api.getSpreadsheets(project, session)` — `/api/spreadsheets`
5. `api.getSnippets(project, session)` — `/api/snippets`
6. `embedsApi.fetchEmbeds(session, project)` — `/api/embeds`
7. `api.listImages(project, session)` — `/api/images`
8. `api.getSessionState(project, session)` — `/api/session-state` (collab state)
9. `api.getSessionTodos(project, session, true)` — `/api/todos` (fired separately in `setCurrentSession`)

These are all launched in `loadSessionItems` (`ui/src/hooks/useDataLoader.ts`, line 130) via a single `Promise.all`, plus `loadCollabState` immediately after (line 148), plus the `getSessionTodos` call in `setCurrentSession` (`ui/src/stores/sessionStore.ts`, line 250).

The trigger is the `useEffect` in `App.tsx` (lines 1056–1079) that watches `currentSession` and calls `loadSessionItems` unconditionally every time it changes:

```ts
// App.tsx lines 1056–1060
useEffect(() => {
  if (!currentSession) return;
  const project = currentSession.project || '';
  (async () => {
    await loadSessionItems(project, currentSession.name);
    // … restore active tab content
  })();
}, [currentSession, loadSessionItems, …]);
```

There is zero caching. Switching from session A to session B and back to session A re-fetches all 9 endpoints for A again. For a user watching 10–20 active sessions, this makes the session switcher feel sluggish regardless of server latency.

The payloads are metadata-only lists — `{ id, name, lastModified }` per artifact — not artifact content. They are structurally identical to the `SessionMetadata[]` lists already cached in `sessionListCache` inside `ui/src/hooks/useSessionList.ts` (line 5).

---

## 2. Goals

- **Eliminate the perceived loading delay** when switching to any previously-visited watched session by serving from cache before the network response arrives.
- **Keep the sidebar artifact list instantly populated** on session switch.
- **Mirror the `sessionListCache` pattern** already established in `useSessionList.ts` so the approach is immediately recognizable to anyone reading the codebase.
- **Prefetch watched sessions proactively** so the cache is warm before the user clicks.
- **Keep the cache coherent** via the existing WebSocket mutation events, which already fire `diagram_created`, `diagram_deleted`, `document_created`, `document_deleted`, etc. for the active session.

## 2.1 Non-Goals

- Caching **artifact content** (diagram source, document markdown, design JSON). Content is fetched on-demand only when a tab is opened; that latency is acceptable and keeping content in a module-level cache would be a significant memory commitment.
- Replacing the **real network fetch**. The cache provides an optimistic initial render; the network fetch always runs and overwrites the cache on completion.
- **Cross-tab cache coherence**. Two browser tabs watching the same session will each maintain their own in-memory cache. This is the same trade-off the `sessionListCache` already accepts.
- **Persistence across hard reloads**. The cache lives in module memory (not `localStorage` or `IndexedDB`), so it is lost on page refresh. This is intentional — a stale cache from a previous session is worse than no cache.
- Caching **agent history, chat messages, or transient UI state** (question panel content, pending diffs, etc.).

---

## 3. Design

### 3.1 The `sessionItemsCache` Module

A new file, `ui/src/lib/sessionItemsCache.ts`, holds a module-level `Map` keyed by `"project:session"`. This mirrors `sessionListCache` in `useSessionList.ts` exactly, but for artifact lists.

```ts
// ui/src/lib/sessionItemsCache.ts

import type { Diagram, Document } from '@/types';
import type { Design, Spreadsheet } from '@/stores/sessionStore';
import type { Snippet, Embed, Image, CollabState } from '@/types';

/** Immutable snapshot of all artifact lists for one session. */
export interface SessionItemsSnapshot {
  diagrams: Diagram[];
  documents: Document[];
  designs: Design[];
  spreadsheets: Spreadsheet[];
  snippets: Snippet[];
  embeds: Embed[];
  images: Image[];
  collabState: CollabState | null;
  /** Unix ms timestamp of the last full fetch. Used for TTL eviction. */
  fetchedAt: number;
}

/** Cache key format: "project:session" */
export type SessionCacheKey = string;

export function makeCacheKey(project: string, session: string): SessionCacheKey {
  return `${project}:${session}`;
}

// Module-level singleton — survives React re-renders, cleared only on page unload.
const cache = new Map<SessionCacheKey, SessionItemsSnapshot>();

/** Returns the cached snapshot, or undefined if not yet fetched. */
export function getSessionItemsCache(
  project: string,
  session: string
): SessionItemsSnapshot | undefined {
  return cache.get(makeCacheKey(project, session));
}

/** Stores a full snapshot after a successful fetch. */
export function setSessionItemsCache(
  project: string,
  session: string,
  snapshot: SessionItemsSnapshot
): void {
  cache.set(makeCacheKey(project, session), snapshot);
}

/** Applies a partial patch to one artifact list in the cache (used by WS handler). */
export function patchSessionItemsCache(
  project: string,
  session: string,
  patch: Partial<Omit<SessionItemsSnapshot, 'fetchedAt'>>
): void {
  const key = makeCacheKey(project, session);
  const existing = cache.get(key);
  if (!existing) return; // No cache entry — nothing to patch
  cache.set(key, { ...existing, ...patch, fetchedAt: existing.fetchedAt });
}

/** Removes a stale entry (e.g., after session deletion). */
export function evictSessionItemsCache(project: string, session: string): void {
  cache.delete(makeCacheKey(project, session));
}

/** Returns all currently-cached keys. Used for prefetch and diagnostics. */
export function getCachedKeys(): SessionCacheKey[] {
  return Array.from(cache.keys());
}

/** TTL in milliseconds. Entries older than this are considered stale on next read. */
export const SESSION_ITEMS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function isCacheStale(snapshot: SessionItemsSnapshot): boolean {
  return Date.now() - snapshot.fetchedAt > SESSION_ITEMS_TTL_MS;
}
```

### 3.2 Changes to `loadSessionItems` in `useDataLoader.ts`

`loadSessionItems` is the sole place all 7 artifact fetches are assembled. The change is a two-phase pattern: **serve from cache immediately, then fetch and update**.

```ts
// ui/src/hooks/useDataLoader.ts — modified loadSessionItems
import {
  getSessionItemsCache,
  setSessionItemsCache,
  isCacheStale,
} from '@/lib/sessionItemsCache';

const loadSessionItems = useCallback(
  async (project: string, session: string) => {
    // Phase 1 — populate store from cache if available and not stale.
    // This gives the sidebar an immediate artifact list without waiting for the network.
    const cached = getSessionItemsCache(project, session);
    if (cached && !isCacheStale(cached)) {
      setDiagrams(cached.diagrams);
      setDocuments(cached.documents);
      setDesigns(cached.designs);
      setSpreadsheets(cached.spreadsheets);
      setSnippets(cached.snippets);
      setEmbeds(cached.embeds);
      setImages(cached.images);
      if (cached.collabState !== undefined) setCollabState(cached.collabState);
      // Do NOT setIsLoading(true) when we have a warm cache — avoid spinner flash.
    } else {
      setIsLoading(true);
    }

    setError(null);

    try {
      const [diagrams, documents, designs, spreadsheets, snippets, embeds, images] =
        await Promise.all([
          api.getDiagrams(project, session),
          api.getDocuments(project, session),
          api.getDesigns(project, session),
          api.getSpreadsheets(project, session),
          api.getSnippets(project, session),
          embedsApi.fetchEmbeds(session, project),
          api.listImages(project, session),
        ]);

      setDiagrams(diagrams);
      setDocuments(documents);
      setDesigns(designs);
      setSpreadsheets(spreadsheets);
      setSnippets(snippets);
      setEmbeds(embeds);
      setImages(images);

      const collabState = await (async () => {
        try {
          const s = await api.getSessionState(project, session);
          setCollabState(s);
          return s;
        } catch {
          setCollabState(null);
          return null;
        }
      })();

      // Phase 2 — write the fresh data back into the cache.
      setSessionItemsCache(project, session, {
        diagrams,
        documents,
        designs,
        spreadsheets,
        snippets,
        embeds,
        images,
        collabState,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load session items';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  },
  [setDiagrams, setDocuments, setDesigns, setSpreadsheets, setSnippets,
   setEmbeds, setImages, setCollabState]
);
```

The key behavior change: when a warm cache entry exists, `setIsLoading(true)` is skipped, so the `LoadingOverlay` in `App.tsx` never appears and the sidebar is populated synchronously. The network fetch still runs and overwrites the store when it completes, reconciling any changes that arrived since the last cache fill.

### 3.3 Prefetch on Subscribe

When the user pins a session to the watched-sessions panel (`subscriptionStore.subscribe`), we should immediately prefetch its artifact lists. This is the highest-value prefetch opportunity because the user has explicitly declared intent to monitor that session.

Add a `prefetchWatchedSession` helper called from the `subscribe` action (or from a `useEffect` that watches the subscriptions map):

```ts
// ui/src/hooks/usePrefetchWatchedSessions.ts (new file)

import { useEffect } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { getSessionItemsCache, isCacheStale } from '@/lib/sessionItemsCache';
import { useDataLoader } from '@/hooks/useDataLoader';

/**
 * Background prefetch for all watched sessions that have a stale or missing cache.
 * Mount this once at the App level alongside useDataLoader.
 */
export function usePrefetchWatchedSessions(): void {
  const { loadSessionItems } = useDataLoader();
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  useEffect(() => {
    // Fire prefetches for all watched sessions not yet in cache.
    // Stagger them with a 200ms gap to avoid a burst of parallel requests
    // on app load when many sessions are watched simultaneously.
    const entries = Object.values(subscriptions);
    entries.forEach(({ project, session }, idx) => {
      const cached = getSessionItemsCache(project, session);
      if (!cached || isCacheStale(cached)) {
        setTimeout(() => {
          loadSessionItems(project, session);
        }, idx * 200);
      }
    });
    // Only run on mount and when the subscriptions object reference changes
    // (i.e., a new session is subscribed). The staggered delay prevents
    // a thundering-herd on initial app load.
  }, [Object.keys(subscriptions).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}
```

Mount it in `App.tsx` alongside the existing hooks:

```ts
// App.tsx — add near line 405
usePrefetchWatchedSessions();
```

### 3.4 WebSocket Handler Extension for Cache Patching (Option C)

The existing WebSocket handler in `App.tsx` (lines 442–845) already handles mutation events for the **active session** by calling `addDiagram`, `removeDiagram`, `updateDiagram`, etc. on the Zustand store. We extend it to also patch the **in-memory cache** for any session, including non-active watched sessions.

This ensures that if Claude creates a diagram in session B while the user is viewing session A, the cache for B is updated so that switching to B shows the new diagram without a full re-fetch.

```ts
// App.tsx — add cache patch calls alongside existing store mutations
import {
  getSessionItemsCache,
  setSessionItemsCache,
  patchSessionItemsCache,
} from '@/lib/sessionItemsCache';

// Inside the 'diagram_created' case:
case 'diagram_created': {
  const { id, name, content, lastModified, project, session } = message as any;
  if (id && name && content !== undefined) {
    // Patch the cache regardless of which session is active
    const cached = getSessionItemsCache(project, session);
    if (cached) {
      patchSessionItemsCache(project, session, {
        diagrams: [...cached.diagrams.filter((d) => d.id !== id),
                   { id, name, content, lastModified: lastModified || Date.now() }],
      });
    }
    // Existing store update (only for active session)
    if (currentSession?.project === project && currentSession?.name === session) {
      addDiagram({ id, name, content, lastModified: lastModified || Date.now() } as any);
    }
  }
  break;
}
```

Apply the same pattern for `diagram_deleted`, `document_created`, `document_deleted`, `design_created`, `design_deleted`, `spreadsheet_created`, `spreadsheet_deleted`, `snippet_created`, `snippet_deleted`, `embed_created`, `embed_deleted`, and `metadata_updated`. The active-session store mutations are preserved unchanged; the cache patch is additive.

For `document_updated` and `diagram_updated`, which carry full content (not just metadata), we update only the `lastModified` field in the cache, not the content, since the cache stores metadata-only lists:

```ts
case 'diagram_updated': {
  const { id, content, lastModified, project, session } = message as any;
  // Patch cache metadata (not content — cache is metadata-only)
  const cached = getSessionItemsCache(project ?? currentSession?.project, session ?? currentSession?.name);
  if (cached && id) {
    patchSessionItemsCache(project ?? currentSession?.project, session ?? currentSession?.name, {
      diagrams: cached.diagrams.map((d) =>
        d.id === id ? { ...d, lastModified: lastModified || Date.now() } : d
      ),
    });
  }
  // Existing active-session store update (unchanged)
  if (id && content !== undefined) {
    updateDiagram(id, { content, lastModified: Date.now() });
  }
  break;
}
```

### 3.5 TTL Strategy

The cache TTL is 5 minutes (`SESSION_ITEMS_TTL_MS = 300_000`). This is the same as Anthropic's prompt cache TTL, chosen because:

- It is long enough that typical session-switching within a work session never hits the spinner.
- It is short enough that a user who leaves the tab open overnight does not see dramatically stale artifact lists on return.
- WebSocket patches keep the cache fresh for any mutation that happens while the tab is open; TTL only matters for the initial cold-start or after a reconnect.

Stale entries are not evicted eagerly. They are detected at read time in `loadSessionItems` via `isCacheStale(cached)`. When stale, the loader skips the optimistic render and shows the normal loading spinner, then re-populates the cache after the fetch completes.

---

## 4. Data Model

```ts
/** Artifact list shapes as returned from the server (metadata-only, no content). */

// From ui/src/types — already defined
interface Diagram   { id: string; name: string; lastModified: number; content: string; deprecated?: boolean; pinned?: boolean; }
interface Document  { id: string; name: string; lastModified: number; content: string; deprecated?: boolean; pinned?: boolean; }
interface Snippet   { id: string; name: string; lastModified: number; content: string; }
interface Embed     { id: string; name: string; url: string; subtype?: string; width?: number; height?: number; createdAt: string; storybook?: unknown; }
interface Image     { id: string; name: string; mimeType: string; size: number; uploadedAt: string; }

// From ui/src/stores/sessionStore.ts
interface Design      { id: string; name: string; content?: string; lastModified?: number; deprecated?: boolean; pinned?: boolean; }
interface Spreadsheet { id: string; name: string; content?: string; lastModified?: number; deprecated?: boolean; pinned?: boolean; }

// From ui/src/types — already defined
interface CollabState { /* task counts, pair mode, etc. */ }

/** The cache entry type, defined in ui/src/lib/sessionItemsCache.ts */
interface SessionItemsSnapshot {
  diagrams:     Diagram[];
  documents:    Document[];
  designs:      Design[];
  spreadsheets: Spreadsheet[];
  snippets:     Snippet[];
  embeds:       Embed[];
  images:       Image[];
  collabState:  CollabState | null;
  fetchedAt:    number; // Unix ms
}
```

Note: `content` is present in the `Diagram` / `Document` types but the list endpoints return it as an empty string or abbreviated preview — actual content is fetched on-demand via `selectDiagramWithContent` / `selectDocumentWithContent`. The cache holds whatever the list API returns, which is sufficient for the sidebar to render artifact names and `lastModified` timestamps.

---

## 5. Implementation Waves

### Wave 1 — Cache Module + Read-Through in `loadSessionItems` (Highest Value, Self-Contained)

**Files changed:**
- `ui/src/lib/sessionItemsCache.ts` — create new module
- `ui/src/hooks/useDataLoader.ts` — Phase 1 optimistic render + Phase 2 cache write

**What this delivers:** Session switching to any previously-visited session is instant. The loading spinner disappears for warm-cache hits. No other code paths are touched.

**Testing:** Switch to session A, then B, then A again. Confirm the sidebar for A appears before the network response (visible in DevTools Network tab — store update precedes the XHR completion event).

---

### Wave 2 — Prefetch on Subscribe and App Load

**Files changed:**
- `ui/src/hooks/usePrefetchWatchedSessions.ts` — create new hook
- `ui/src/App.tsx` — mount `usePrefetchWatchedSessions()` near line 405

**What this delivers:** Cache is warm for watched sessions even before the user clicks them for the first time. Adding a new watched session triggers an immediate background prefetch.

**Testing:** Load the app with 5 watched sessions. Open DevTools Network. Confirm 5 staggered prefetch bursts fire within ~1 second of mount. Switch to any watched session — no spinner.

---

### Wave 3 — WebSocket Cache Patching for Non-Active Sessions

**Files changed:**
- `ui/src/App.tsx` — extend all artifact WS message handlers to call `patchSessionItemsCache`
- `ui/src/lib/sessionItemsCache.ts` — `patchSessionItemsCache` already defined in Wave 1

**What this delivers:** The cache stays current for watched sessions even when Claude is actively creating or deleting artifacts in them. Switching to a busy session reflects work-in-progress without re-fetching.

**Testing:** Open two sessions. In session B (inactive), trigger artifact creation via the MCP server. Switch to session B — confirm the new artifact appears immediately without a loading flash.

---

### Wave 4 — Eviction on Session Delete / Unsubscribe

**Files changed:**
- `ui/src/stores/subscriptionStore.ts` — call `evictSessionItemsCache` in `unsubscribe`
- `ui/src/App.tsx` — call `evictSessionItemsCache` after `api.deleteSession` / `api.archiveSession` succeed

**What this delivers:** Prevents stale cache entries from accumulating for sessions the user has explicitly removed. Low urgency since TTL handles this eventually.

---

## 6. Memory Analysis

The list endpoints return metadata-only payloads. A typical entry is:

```json
{ "id": "abc123", "name": "My Diagram", "lastModified": 1745123456789 }
```

Estimated sizes:
- Per artifact entry: ~100 bytes JSON / ~300 bytes V8 object overhead = ~400 bytes
- Typical session: 5 diagrams + 3 documents + 2 designs + 1 spreadsheet + 2 snippets + 0 embeds + 0 images = **~13 items × 400 bytes = ~5 KB**
- CollabState: ~500 bytes

**Per session: ~6 KB**

| Watched sessions | Total cache size |
|---|---|
| 10 | ~60 KB |
| 25 | ~150 KB |
| 50 | ~300 KB |
| 100 | ~600 KB |

At 50 sessions — an extreme power-user scenario — the cache consumes ~300 KB of heap. This is negligible on any modern device. The `sessionListCache` in `useSessionList.ts` already accepts the same trade-off for session metadata; this is the same pattern applied one level deeper.

---

## 7. What NOT to Cache

| Data | Why Not |
|---|---|
| Artifact content (diagram source, document markdown, design JSON) | Can be arbitrarily large (10 KB–500 KB per artifact). On-demand fetch latency is acceptable because content is only needed when a tab is open. |
| Agent history / chat messages | Structural content, not metadata; grows unboundedly; already managed by `chatStore`. |
| Transient UI state (pending diffs, question panel, proposed edits) | Ephemeral by definition; should not survive session switch. |
| `sessionTodos` | Already fetched separately in `setCurrentSession` with its own sequence guard (see `sessionStore.ts` line 248). Folding it into the cache would complicate the sequence-counter invalidation logic. |
| WebSocket connection state | Not a cache concern; managed by `useWebSocket`. |

---

## 8. Open Questions and Risks

### 8.1 Stale Cache on Rapid Edits from Claude

If Claude is running and modifying artifacts in a watched session, the WS cache patches (Wave 3) keep the metadata list current. However, between the last WS event and the moment the user switches to that session, there is a window where the cache is optimistically rendered and then overwritten by the network fetch. This produces a brief re-render of the sidebar. The UX impact is low (artifact names rarely change mid-session; only `lastModified` timestamps would shift), but it is worth monitoring.

**Mitigation:** The `patchSessionItemsCache` function updates `lastModified` on `diagram_updated` / `document_updated` events, keeping the optimistic render close to ground truth.

### 8.2 Cache Coherence Across Browser Tabs

Two tabs watching the same session maintain independent caches. A mutation made in tab A will propagate to the server and emit a WS event, which both tabs will receive. Both will apply the `patchSessionItemsCache` call. This is coherent.

The problem case is a tab that loses its WebSocket connection and reconnects. On reconnection, `isConnected` flips to `true`, which triggers the `useEffect` in `App.tsx` (line 435) to re-subscribe. The active session will be re-fetched via `loadSessionItems` (called by the `currentSession` effect). Non-active watched sessions will _not_ be re-fetched automatically unless Wave 2 is implemented and the prefetch hook detects stale entries post-reconnect.

**Recommendation:** In Wave 2, add a `useEffect` that responds to `isConnected` transitioning from `false` to `true` and re-runs the stale-check loop for all watched sessions.

### 8.3 Race: User Switches Session During Prefetch

If `loadSessionItems` is prefetching session B in the background and the user simultaneously switches to session B, two calls to `loadSessionItems("proj", "B")` will run concurrently. Both will write to the store and to the cache. Because both fetches hit the same server state, the results are identical and the second write is idempotent. No guard is needed for Wave 1, but it is worth adding an in-flight deduplication map in Wave 2 if profiling shows redundant requests.

### 8.4 `loadCollabState` is Currently Called Separately

`loadCollabState` is called inside `loadSessionItems` (line 148 of `useDataLoader.ts`) after the `Promise.all`. The current implementation calls it with `await`, making it sequential. This means the total latency of `loadSessionItems` is `max(7 parallel fetches) + collabState fetch`. The design above inlines `collabState` into the `Promise.all` to make all 8 fetches parallel and cache the result together. This is a latency improvement independent of the cache.

### 8.5 Sessions with No Artifacts

A watched session with zero artifacts will still fetch and cache an empty snapshot (`diagrams: [], documents: [], …`). This is correct behavior — the sidebar correctly shows "No artifacts" and the cache avoids a re-fetch. No special handling needed.

### 8.6 `setCurrentSession` Clears Store State Before `loadSessionItems` Runs

`setCurrentSession` in `sessionStore.ts` (line 226) immediately clears all artifact arrays. The optimistic cache render in `loadSessionItems` runs in the `useEffect` in `App.tsx`, which fires _after_ `setCurrentSession` completes. This means there is a brief render where the store is empty (cleared by `setCurrentSession`) before the cache is applied. In practice this is one React render cycle (~16 ms) and is not perceptible, but it can cause a flash of an empty sidebar.

**Fix option:** Move the cache read into `setCurrentSession` itself, applying it synchronously before clearing:

```ts
setCurrentSession: (session: Session | null) => {
  // … identity guard …

  // Pre-populate from cache before clearing (avoids empty-sidebar flash)
  const snapshot = session
    ? getSessionItemsCache(session.project, session.name)
    : undefined;

  set({
    currentSession: session,
    diagrams:     snapshot?.diagrams     ?? [],
    documents:    snapshot?.documents    ?? [],
    designs:      snapshot?.designs      ?? [],
    spreadsheets: snapshot?.spreadsheets ?? [],
    snippets:     snapshot?.snippets     ?? [],
    embeds:       snapshot?.embeds       ?? [],
    images:       snapshot?.images       ?? [],
    selectedDiagramId:     null,
    selectedDocumentId:    null,
    selectedDesignId:      null,
    selectedSpreadsheetId: null,
    selectedSnippetId:     null,
    sessionTodos:  [],
    collabState:   snapshot?.collabState ?? null,
    error: null,
  });
  // … sessionTodos fire-and-forget fetch …
},
```

This eliminates the empty-sidebar flash entirely and is the recommended approach for Wave 1.
