# Bug Review — Phase 1

Reviewed four files for correctness bugs only (not design compliance):
- ui/src/components/editors/DiffAgainstDiskModal.tsx
- ui/src/components/editors/CodeArtifactKebabMenu.tsx
- ui/src/components/editors/PseudoSideBySideView.tsx
- ui/src/components/editors/CodeEditor.tsx

## Bugs Found

### 1. Important — CodeEditor.tsx `handleDeprecate` leaves store's `deprecated` flag stale

**File:** ui/src/components/editors/CodeEditor.tsx
**Lines:** 135-146

```ts
const handleDeprecate = useCallback(async () => {
  if (!currentSession) return;
  try {
    await api.setDeprecated(currentSession.project, currentSession.name, snippetId, true);
    storeUpdateSnippet(snippetId, { lastModified: Date.now() });
    setFlashMessage('Deprecated');
    await refreshSnippet();
  } catch (err) { ... }
}, ...);
```

**Problem:** `Snippet` (see `ui/src/types/snippet.ts:18`) has a top-level `deprecated?: boolean` field. After the API call succeeds, the store is patched with only `lastModified`. `refreshSnippet` re-fetches and updates only `content` (see lines 98-108). So the `deprecated` flag in the session store remains `false` until a full session reload, causing UI that depends on `snippet.deprecated` (sidebar filtering, badges) to stay out of sync.

**Fix:** Also update the deprecated flag in the store:
```ts
storeUpdateSnippet(snippetId, { deprecated: true, lastModified: Date.now() });
```
And update `refreshSnippet` to include `deprecated` (or fetch the snippet metadata, not just content).

---

### 2. Minor — CodeEditor.tsx `refreshSnippet` does not propagate `deprecated`/other metadata

**File:** ui/src/components/editors/CodeEditor.tsx
**Lines:** 98-108

`refreshSnippet` only copies `full.content` back to the store. If the server changes any other metadata (pinned, deprecated, blueprint, etc.) during a push/deprecate, the store stays stale. This compounds bug #1.

**Fix:** Spread the fetched snippet fields or selectively copy the known metadata fields.

---

### 3. Minor — CodeEditor.tsx `handleDelete` sets state after probable unmount

**File:** ui/src/components/editors/CodeEditor.tsx
**Lines:** 148-158

```ts
await api.deleteSnippet(...);
storeRemoveSnippet(snippetId);
setFlashMessage('Unlinked');
```

After `storeRemoveSnippet`, the parent will almost certainly unmount `CodeEditor` since the snippet is gone. `setFlashMessage` then fires on an unmounted component, producing a React dev warning. Also, the flash message is never shown to the user because the component is gone.

**Fix:** Either show the toast elsewhere (session-level toaster), or skip the flash-message update in the success path of delete. Same applies to `CodeArtifactKebabMenu.handleUnlink` which may also setFlashMessage after unmount in the catch path (less likely to hit since the delete already succeeded by that point).

---

### 4. Non-bug — CodeEditor.tsx `mergedControls` useMemo deps verified

**File:** ui/src/components/editors/CodeEditor.tsx
**Line:** 294 (deps array)

`mergedControls` does not reference `actualPush` directly (only `handlePush`). The `DiffAgainstDiskModal` JSX at line 378 references `actualPush` and `dirty` but it is not memoized, so no stale-closure issue. All values closed over by `mergedControls` (envelope, currentSession, snippetControls, handlePush, handlePreview, handleSync, isPushing, isSyncing, dirty, conflict, flashMessage, showPseudo, snippetId, filePath, handleDeprecate, handleDelete) appear in the deps array. No bug.

---

### 5. Minor — DiffAgainstDiskModal.tsx stale `parsed` state on modal reopen

**File:** ui/src/components/editors/DiffAgainstDiskModal.tsx
**Lines:** 60-96

When the modal reopens with a new `snippetId`, the effect sets `loading=true` and kicks off a fetch, but `parsed` state still holds the PREVIOUS snippet's values until the new fetch resolves. While `loading` is true the UI shows "Loading diff...", so the stale `parsed` isn't visible — but if the fetch fails, the error state renders while `oldValue === newValue` from the previous snippet could momentarily flash through stale state during re-renders. Very minor.

**Fix (optional):** Reset `parsed` to empty when starting a new fetch:
```ts
setParsed({ code: '', originalCode: '', diskCode: '' });
setLoading(true);
```

---

### 6. Minor — DiffAgainstDiskModal.tsx Escape handler re-registers every render

**File:** ui/src/components/editors/DiffAgainstDiskModal.tsx
**Lines:** 99-106

The effect deps include `onClose`, which the parent passes as an inline arrow `() => setDiffModalOpen(false)` at CodeEditor.tsx:377. The listener tears down and re-attaches on every CodeEditor render. Not a correctness bug but wasteful. Same pattern in the backdrop onClick.

**Fix:** Either `useCallback` the `onClose` in CodeEditor, or remove `onClose` from the effect deps and use a ref. Low priority.

---

### 7. Minor — DiffAgainstDiskModal.tsx Confirm button not gated on "no changes"

**File:** ui/src/components/editors/DiffAgainstDiskModal.tsx
**Lines:** 202-214

The Confirm button is `disabled={loading || !!error}` — but if `oldValue === newValue` (body shows "No changes detected"), the button is still enabled and a Push-to-file can fire on unchanged content. In practice `CodeEditor` passes `onConfirm={dirty ? actualPush : undefined}`, so if the envelope's `dirty=false` the button is hidden. But if `dirty=true` yet the content equals disk (e.g. user typed then undid), the button is clickable and runs a no-op push.

**Fix:** Also disable when `oldValue === newValue`:
```ts
const noChanges = !loading && !error && oldValue === newValue;
disabled={loading || !!error || noChanges}
```

---

### 8. Minor — CodeEditor.tsx footer "Synced X ago" uses `Date.now()` default masking missing data

**File:** ui/src/components/editors/CodeEditor.tsx
**Lines:** 55, 96

In `parseLinkedEnvelope` line 55, missing `lastSyncedAt` defaults to `Date.now()`. This is captured at parse time (memoized with content), so each time content changes, if the server doesn't supply `lastSyncedAt`, the footer resets to "just now" regardless of actual sync time. The server should always send a real value, but the silent default masks upstream bugs.

Additionally, line 96 `envelope?.lastSyncedAt || Date.now()` coerces a legitimate `lastSyncedAt === 0` to `Date.now()`. Use `??` instead of `||`.

**Fix:** Default to `null` in the parser, use `??` in the accessor, and render "never synced" or omit the "Synced ... ago" span when null.

---

### 9. Minor — CodeEditor.tsx `handleConfirm` in modal not awaited

**File:** ui/src/components/editors/CodeEditor.tsx (line 378) and DiffAgainstDiskModal.tsx (lines 108-111)

`handleConfirm` in DiffAgainstDiskModal fires `onConfirm?.()` without awaiting, then closes the modal. `actualPush` is async — the modal closes before the push completes. `actualPush` is guarded by `isPushing`, so there is no double-push risk. HOWEVER: if the user reopens the modal mid-push and clicks Confirm again, the second call returns early silently. No user-visible feedback that the click was ignored.

This meets the prompt's "no double-push" guarantee — flagged only for UX awareness.

**Fix (optional):** Make `handleConfirm` await the async confirm and show a spinner on the Confirm button, or disable Push button while `isPushing`.

---

### 10. No bugs — PseudoSideBySideView.tsx

**File:** ui/src/components/editors/PseudoSideBySideView.tsx

Rapid prop changes are correctly handled via the `cancelled` flag in the effect (lines 54-75). `setPseudoExists(null)` is called synchronously at effect-start so the loading spinner re-appears. `deriveStem` is a pure function with correct regex handling of no-extension paths and missing `projectPath`.

---

### 11. No bugs — CodeArtifactKebabMenu.tsx

**File:** ui/src/components/editors/CodeArtifactKebabMenu.tsx

Click-outside (lines 39-48) and Escape (lines 51-58) both early-return when `!isOpen` and properly remove their listeners in the cleanup functions. `setFlashMessage` timer (lines 32-36) also cleans up. `handleUnlink` confirms via `window.confirm`, calls `onDelete`, and only catches to flash on failure.

---

## Summary

**Important bugs: 1**
1. `handleDeprecate` leaves store's `deprecated` field stale

**Minor bugs: 7**
- `refreshSnippet` only copies `content`, not metadata (compounds #1)
- `handleDelete` sets state after probable unmount
- Confirm button not disabled on "no changes"
- `lastSyncedAt` silent `Date.now()` default masks missing timestamps; `||` vs `??`
- `parsed` state not reset on modal reopen (very minor)
- Escape handler re-registers due to inline `onClose` (perf only)
- Push confirm not awaited (UX only, no double-push)

**Non-issues verified:**
- PseudoSideBySideView cancellation works correctly on rapid prop changes
- CodeArtifactKebabMenu listener cleanup is correct
- DiffAgainstDiskModal's useEffect correctly cancels stale fetches on snippetId change
- `handlePush`/`actualPush` cannot double-push (guarded by `isPushing`)
- `mergedControls` useMemo deps are complete for all closed-over values
- `deriveStem` correctly handles edge cases (no extension, missing projectPath)
