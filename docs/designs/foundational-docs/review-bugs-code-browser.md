# Bug Review — Code Browser Revamp (Waves 2–4)

Scope: uncommitted diff on `ui/` + new files CodeFileView.tsx, promote-code-file.ts, perf-bus.ts. Design compliance excluded.

## Critical
None.

## Important

### 1. `linkFile` cache race creates duplicate snippets
**File:** `ui/src/lib/link-file.ts:23-33`
**Problem:** The newly added cache-check reads `useSessionStore.getState().snippets` then falls through to the server create call. Two concurrent `linkFile(...)` invocations for the same `filePath` (e.g. two quick clicks, or auto-promote firing while a user also clicks) will both miss the cache because the first call's resulting snippet hasn't been inserted into the store yet. Both hit `POST` and two duplicate snippets get created on the server.
**Why it matters:** Duplicate snippet artifacts pollute the session; subsequent `promoteCodeFile` cache lookup returns whichever is first in iteration order, orphaning the other.
**Fix:** Memoize the in-flight promise keyed by `filePath`:
```ts
const inflight = new Map<string, Promise<string>>();
export async function linkFile(project, session, filePath) {
  const cached = /* existing snippet scan */;
  if (cached) return cached;
  const key = `${project}::${session}::${filePath}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => { /* existing POST body */ })()
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
```

### 2. `linkFile` cache does not validate session scope
**File:** `ui/src/lib/link-file.ts:10-20`
**Problem:** The cache scan iterates `useSessionStore.getState().snippets` and matches by `filePath` only. `linkFile` takes `project` and `session` parameters, but the snippets store reflects the *currently selected* session — if the caller passes a different session (cross-session link) the cache returns a snippet that belongs to the wrong session.
**Fix:** Either (a) assert that the passed `session` equals `useSessionStore.getState().currentSession?.name && project` before consulting the cache, or (b) skip the cache entirely when params don't match the current session.

### 3. `CodeFileView` fetch race on `allowLarge` / reload
**File:** `ui/src/components/editors/CodeFileView.tsx:42-61`
**Problem:** The fetch effect aborts on cleanup, but the `.finally(() => setLoading(false))` runs regardless of abort. When `allowLarge` / `reloadTick` changes, React cleans up the old effect (aborts controller), then the new effect runs and synchronously calls `setLoading(true)`. The *old* promise then resolves its `finally` asynchronously and sets `loading=false`, clobbering the new loading state. The UI flashes a non-loading, `data=null`, `error=null` state until the new fetch completes.
**Fix:** Guard the `finally` with the controller signal:
```ts
.finally(() => {
  if (!controller.signal.aborted) setLoading(false);
});
```
Also guard `setData` / `setError` for the same reason (cleaner: use a `cancelled` flag inside the effect).

## Minor

### 4. `Close All` in pinned & regular TabBar closes across categories
**File:** `ui/src/components/layout/tabs/PinnedTabBar.tsx:58-60` and `ui/src/components/layout/tabs/TabBar.tsx:175-177`
**Problem:** `handleCloseAll` iterates `tabs` (the full list) and closes every entry — pinned, regular, and preview alike. From the user's perspective "Close All" invoked on a *regular* tab unexpectedly closes pinned tabs too, and vice versa.
**Fix:** Filter to the same category used when building each bar, or rename the item to "Close All Tabs" to set expectation.

### 5. Drift calc silently false on unparseable `syncedAt`
**File:** `ui/src/components/editors/CodeFileView.tsx:78`
**Problem:** `Date.parse(pseudo.syncedAt)` returns `NaN` for non-ISO strings, and `data.mtimeMs > NaN` is always false — so a malformed `syncedAt` silently suppresses the "stale" badge instead of surfacing the anomaly.
**Fix:**
```ts
const syncedMs = pseudo?.syncedAt ? Date.parse(pseudo.syncedAt) : NaN;
const drift = Number.isFinite(syncedMs) && data?.kind === 'text' && data.mtimeMs > syncedMs + 86400000;
```

### 6. `peekPseudoFile` invoked unconditionally on every render
**File:** `ui/src/components/editors/CodeFileView.tsx:77`
**Problem:** `peekPseudoFile(project, path)` runs on every render. For large SWR caches this is wasteful and not memoized.
**Fix:** Wrap in `useMemo` keyed on `[project, path, data?.kind]`.

### 7. `promoteCodeFile` path construction assumes POSIX-absolute
**File:** `ui/src/lib/promote-code-file.ts:25-27`
**Problem:** Absolute-path check is `stem.startsWith('/')`. Windows (`C:/...`) / UNC paths wouldn't match. Moot for this Linux-only codebase but brittle.
**Fix:** Centralize with an `isAbsolutePath` helper if cross-platform matters.

### 8. `TabBar` menu `onPinToggle` reads state inconsistently
**File:** `ui/src/components/layout/tabs/TabBar.tsx:239-241`
**Problem:** Mixes hooked `pinTab` with `useTabsStore.getState().unpinTab(...)` inline. Works correctly but inconsistent; rename-safety differs between the two accessors.
**Fix:** Hook `unpinTab` at the top of the component.

### 9. Dead `group` hover styling in PseudoFileTree
**File:** `ui/src/pages/pseudo/PseudoFileTree.tsx`
**Problem:** `handleLinkAndOpen` and the link button using `group-hover:opacity-100` were removed, but the enclosing row still has the `group` class. Harmless leftover.

## Summary
- Critical: 0
- Important: 3
- Minor: 6
