# Bug Review — Phase 1 (post-fix)

## Summary

Verified all 8 previously reported bugs. **All 8 fixes are correct.** Found **1 new Important bug** introduced (or pre-existing and missed in first review) in the toolbar control plumbing when `envelope` is null, plus 1 Minor issue.

---

## Verification of Previously Reported Bugs

### 1. Important — handleDeprecate passes `deprecated: true` — FIXED
`ui/src/components/editors/CodeEditor.tsx:139`
```ts
storeUpdateSnippet(snippetId, { deprecated: true, lastModified: Date.now() });
```
Correct. `Snippet` type (`ui/src/types/snippet.ts:18`) has `deprecated?: boolean`, and `sessionStore.updateSnippet` accepts `Partial<Snippet>`. The subsequent `refreshSnippet()` call preserves `deprecated` via object spread merging in the store.

### 2. refreshSnippet propagates `lastModified` — FIXED
`ui/src/components/editors/CodeEditor.tsx:103`
```ts
storeUpdateSnippet(snippetId, { content: full.content, lastModified: full.lastModified ?? Date.now() });
```
Correct use of `??` so an explicit `0` would still take the fallback (harmless), but preserves valid backend timestamps.

### 3. handleDelete doesn't set flash after unmount — FIXED
`ui/src/components/editors/CodeEditor.tsx:148-158`
Success path only calls `storeRemoveSnippet(snippetId)` with a clarifying comment. Error path still sets flash (fine — component is still mounted on error). Correct.

### 4. `??` instead of `||` for `lastPushedAt`/`lastSyncedAt` — FIXED
`ui/src/components/editors/CodeEditor.tsx:95-96`
```ts
const lastPushedAt = envelope?.lastPushedAt ?? null;
const lastSyncedAt = envelope?.lastSyncedAt ?? Date.now();
```
Correct — an explicit `0` from the envelope now survives instead of being replaced by `null`/`Date.now()`.

### 5. Confirm button disabled when `oldValue === newValue` — FIXED
`ui/src/components/editors/DiffAgainstDiskModal.tsx:212-217`
```tsx
disabled={loading || !!error || oldValue === newValue}
```
Plus the visual style branch on line 214 matches. Correct.

### 6. `parsed` state reset when reopening with new snippetId — FIXED
`ui/src/components/editors/DiffAgainstDiskModal.tsx:74`
```ts
setParsed({ code: '', originalCode: '', diskCode: '' });
```
Called inside the `open` effect body, so the stale previous snippet is cleared before the fetch runs. Effect deps `[open, snippetId, projectPath, sessionName]` correctly re-run on reopen. Correct.

### 7. Escape handler uses `useRef` pattern — FIXED
`ui/src/components/editors/DiffAgainstDiskModal.tsx:100-110`
```ts
const onCloseRef = useRef(onClose);
useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

useEffect(() => {
  if (!open) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCloseRef.current();
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [open]);
```
Listener only re-registers when `open` changes, not on every parent re-render. Correct.

### 8. `handleConfirm` awaits `onConfirm?.()` — FIXED
`ui/src/components/editors/DiffAgainstDiskModal.tsx:112-118`
```ts
const handleConfirm = useCallback(async () => {
  try {
    await onConfirm?.();
  } finally {
    onClose();
  }
}, [onConfirm, onClose]);
```
Correct — `onClose` always runs even if `onConfirm` throws, and confirm is awaited before closing.

---

## New / Missed Bugs

### NEW-1 — Important — Toolbar controls race clobber when `envelope` is null
**File:** `ui/src/components/editors/CodeEditor.tsx:297-306`

When `envelope` is null (snippet isn't a linked-file envelope), the component takes the early-return branch at line 304:
```tsx
if (!envelope) {
  return <SnippetEditor snippetId={snippetId} onSave={onSave} onToolbarControls={onToolbarControls} />;
}
```
The inner `SnippetEditor` publishes its controls directly to the parent's `onToolbarControls` callback.

**But** the effect at lines 297-301 still runs on every render:
```ts
useEffect(() => {
  if (onToolbarControls) {
    onToolbarControls(mergedControls);
  }
}, [onToolbarControls, mergedControls]);
```
And `mergedControls` at line 215 is:
```ts
if (!envelope || !currentSession) return snippetControls;
```
— where `snippetControls` is CodeEditor's own local state, which is only ever populated via `handleSnippetToolbarControls`. In the `!envelope` branch the inner SnippetEditor receives `onToolbarControls` directly (the parent's), so `setSnippetControls` is never called — `snippetControls` stays `null` forever.

**Result:** On every render of CodeEditor in the `!envelope` branch, the parent's `onToolbarControls` is called twice:
1. Directly by SnippetEditor with its real controls (child effect).
2. By CodeEditor's own effect with `null` (parent effect, runs after).

Because parent effects run after child effects, the parent callback ends up with `null` — the SnippetEditor toolbar controls are clobbered to empty.

**Fix:** Short-circuit the publish effect when `envelope` is null (or move the early return before the effect by restructuring). Example:
```ts
useEffect(() => {
  if (!envelope) return; // inner SnippetEditor handles publishing
  if (onToolbarControls) {
    onToolbarControls(mergedControls);
  }
}, [envelope, onToolbarControls, mergedControls]);
```
Alternatively, always route through `handleSnippetToolbarControls` (even in the `!envelope` branch) so `snippetControls` state is populated and `mergedControls` returns it.

### NEW-2 — Minor — `Never pushed` still uses truthy check
**File:** `ui/src/components/editors/CodeEditor.tsx:369`
```tsx
<span className="flex-shrink-0">{lastPushedAt ? `Pushed ${formatRelativeTime(lastPushedAt)}` : 'Never pushed'}</span>
```
Bug 4 was fixed at the destructuring site (line 95) so that `lastPushedAt === 0` is preserved from the envelope, but the consumer at line 369 still uses a truthy check. An envelope pushed at epoch time 0 (or the fallback `0` sentinel if backend ever emits one) would render "Never pushed". In practice this is unreachable (no one pushes at 1970-01-01), but the fix is trivially: `lastPushedAt != null ? ... : 'Never pushed'`.

---

## No Bugs Found In

- `ui/src/components/editors/CodeArtifactKebabMenu.tsx` — clean. Flash-message timer cleanup correct; click-outside and Escape listeners correctly gated on `isOpen`; error paths do not leak through successful unlink confirm; `handleDeprecate` / `handleUnlink` wrapped in try/catch with setFlashMessage on failure.
- `ui/src/components/editors/PseudoSideBySideView.tsx` — clean. `cancelled` flag used correctly; early-return path (no projectPath/stem) does not leak a listener; `setPseudoExists(null)` before fetch correctly shows loading.

---

## Files Reviewed
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/editors/DiffAgainstDiskModal.tsx`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/editors/CodeArtifactKebabMenu.tsx`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/editors/PseudoSideBySideView.tsx`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/editors/CodeEditor.tsx`
