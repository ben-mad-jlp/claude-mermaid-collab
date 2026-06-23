# Completeness Review — Watched Session Cache

## Check 1: All 5 files exist

| File | Status |
|------|--------|
| `ui/src/lib/sessionItemsCache.ts` | PRESENT |
| `ui/src/hooks/useDataLoader.ts` | PRESENT |
| `ui/src/stores/sessionStore.ts` | PRESENT |
| `ui/src/hooks/usePrefetchWatchedSessions.ts` | PRESENT |
| `ui/src/App.tsx` | PRESENT |

All 5 files exist. No gaps.

---

## Check 2: sessionItemsCache.ts exports all 7 required symbols

| Symbol | Status |
|--------|--------|
| `SESSION_ITEMS_TTL_MS` | PRESENT — `5 * 60 * 1000` (line 18) |
| `makeCacheKey` | PRESENT (line 22) |
| `getSessionItemsCache` | PRESENT (line 26) |
| `setSessionItemsCache` | PRESENT (line 33) |
| `patchSessionItemsCache` | PRESENT (line 41) |
| `evictSessionItemsCache` | PRESENT (line 52) |
| `isCacheStale` | PRESENT (line 56) |

All 7 symbols exported. No gaps.

---

## Check 3: useDataLoader.ts — Phase 1 cache read + Phase 2 cache write

**Phase 1 (cache read before spinner):** PRESENT
- Lines 131–144: reads cache with `getSessionItemsCache`, checks `isCacheStale`, populates store immediately if warm, suppresses spinner (`setIsLoading(true)` only in the `else` branch).

**Phase 2 (cache write after fetch):** PRESENT
- Lines 167–180: after all parallel fetches resolve, constructs a `SessionItemsSnapshot` and calls `setSessionItemsCache(project, session, snapshot)`.

No gaps.

---

## Check 4: setCurrentSession reads cache before clearing store

PRESENT — `sessionStore.ts` lines 224–246:
- Calls `getSessionItemsCache(session.project, session.name)` before the `set({...})` call.
- Uses `snapshot?.diagrams ?? []`, `snapshot?.documents ?? []`, etc. for all 7 item collections and `collabState` when populating the new state.

No gaps.

---

## Check 5: usePrefetchWatchedSessions.ts exists with stagger logic

PRESENT:
- Iterates `Object.values(subscriptions)` with `forEach(({ project, session }, idx)`.
- Skips sessions with a warm cache (`!cached || isCacheStale(cached)`).
- Staggers calls via `setTimeout(() => loadSessionItems(...), idx * 200)` — 200 ms per slot.

No gaps.

---

## Check 6: usePrefetchWatchedSessions mounted in App.tsx

PRESENT:
- Import on line 38: `import { usePrefetchWatchedSessions } from '@/hooks/usePrefetchWatchedSessions';`
- Mount on line 262: `usePrefetchWatchedSessions();`

No gaps.

---

## Check 7: WS handlers patch cache for _created and _deleted events

| Event | Cache patch | Status |
|-------|-------------|--------|
| `diagram_created` | `patchSessionItemsCache` → diagrams | PRESENT |
| `diagram_deleted` | `patchSessionItemsCache` → diagrams | PRESENT |
| `document_created` | `patchSessionItemsCache` → documents | PRESENT |
| `document_deleted` | `patchSessionItemsCache` → documents | PRESENT |
| `design_created` | `patchSessionItemsCache` → designs | PRESENT |
| `design_deleted` | `patchSessionItemsCache` → designs | PRESENT |
| `snippet_created` | `patchSessionItemsCache` → snippets | PRESENT |
| `snippet_deleted` | `patchSessionItemsCache` → snippets | PRESENT |

**Note:** `spreadsheet_created` and `spreadsheet_deleted` handlers do NOT patch the cache — but spreadsheet is not listed in the blueprint's required event types, so this is not a gap against spec.

No gaps.

---

## Check 8: TODO / "Not implemented" stubs in new files

Searched `sessionItemsCache.ts`, `useDataLoader.ts`, and `usePrefetchWatchedSessions.ts` for `TODO`, `FIXME`, `Not implemented`, `stub`. No matches found.

No gaps.

---

## Summary

**0 gaps. Implementation is complete against the blueprint spec.**

All 5 files are present, all 7 cache symbols are exported, Phase 1 and Phase 2 are both implemented in `loadSessionItems`, `setCurrentSession` pre-populates from cache before clearing store, the prefetch hook uses staggered 200 ms timeouts, it is mounted in `App.tsx`, and all 8 required WS mutation event types (`diagram/document/design/snippet _created/_deleted`) patch the cache. No TODO stubs were found in any of the new files.
