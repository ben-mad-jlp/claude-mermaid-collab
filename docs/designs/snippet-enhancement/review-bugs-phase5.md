# Bug Review — Phase 5 (Cross-file nav + Global Search)

Scope: uncommitted Phase 5 changes only. Review focused on correctness, not design compliance.

---

## Bugs Found

### 1. `LinkAndNavigateDialog` — `isProcessing` stuck at `true` after successful confirm — **Important**

**File:** `ui/src/components/editors/LinkAndNavigateDialog.tsx` lines 50-61, 46-48

**Problem:** In `handleConfirm`, on the success path (no throw), `isProcessing` is set to `true` but is never reset to `false`. The comment says "Parent closes on success" and indeed the parent flips `open=false` and the component returns `null`. However, the component is NOT unmounted — it remains in the tree with state preserved. The `useEffect` that runs when `open` flips to `true` again only resets `error`, not `isProcessing`:

```tsx
useEffect(() => {
  if (open) setError(null);
}, [open]);
```

So on the *next* open of the dialog, `isProcessing` is still `true` from the last successful confirm, which means:
- The Cancel button is disabled
- The primary button shows "Linking…" and is disabled
- The Escape/backdrop-click guards `!isProcessing` fail
- The dialog is effectively frozen until a hard refresh

This affects every second-and-later use of the dialog via both Feature B (`CodeEditor`) and GlobalSearch.

**Fix:** Reset `isProcessing` whenever `open` transitions to true:

```tsx
useEffect(() => {
  if (open) {
    setError(null);
    setIsProcessing(false);
  }
}, [open]);
```

---

### 2. GlobalSearch pseudo-branch excerpt is not HTML-escaped — **Important (XSS-adjacent)**

**File:** `src/routes/code-api.ts` lines ~258-270 in `handleCodeSearch`

**Problem:** The `code` branch carefully builds the excerpt with `htmlEscape(before) + '<mark>' + htmlEscape(matched) + '</mark>' + htmlEscape(after)` (good). The `pseudo` branch, however, pushes `hit.snippet` directly:

```ts
results.push({
  kind: 'pseudo',
  ...
  snippet: hit.snippet, // already has <mark> from FTS snippet()
});
```

`PseudoDbService.search()` uses SQLite's FTS `snippet(pseudo_fts, 1, '<mark>', '</mark>', '...', 30)`. The surrounding code body pulled from `.pseudo` files is NOT escaped — it may legitimately contain `<`, `>`, `&`, etc. (e.g., generic type parameters `List<String>`, comparison operators, JSX). On the client, `GlobalSearch` renders this via `dangerouslySetInnerHTML={{ __html: r.snippet }}`.

This is inconsistent with the code branch and opens an injection surface. Attack surface is limited (a user would need to put markup into their own `.pseudo` file to XSS themselves), but it will also break rendering of legitimate pseudo code containing angle brackets.

**Fix:** HTML-escape the raw pseudo body before re-inserting the `<mark>` tags. One option is to change the FTS snippet markers to placeholders that won't collide, escape, then swap back. For example:

```ts
// Use unlikely sentinels to avoid collision with user code
const MARK_OPEN = '\x00MARK_OPEN\x00';
const MARK_CLOSE = '\x00MARK_CLOSE\x00';
// In pseudo-db.search(): use these markers in snippet() call
// Then in handleCodeSearch:
const safe = htmlEscape(hit.snippet)
  .replaceAll(MARK_OPEN, '<mark>')
  .replaceAll(MARK_CLOSE, '</mark>');
```

Alternatively, drop the raw FTS snippet entirely and compute the excerpt from `source_body` with the same escape+mark pipeline used in the code branch.

---

### 3. `useNavHistory` — `push` does not update `entriesRef` synchronously — **Minor (race)**

**File:** `ui/src/hooks/useNavHistory.ts` lines 39-47

**Problem:** `push` calls `setEntries(prev => ...)` but does NOT update `entriesRef.current`. The ref is only reconciled via the `useEffect` on line 35-37 after the next render. If a caller synchronously pushes and then calls `back()` in the same tick (before React flushes), `back()` reads the stale `entriesRef.current` and returns the older top-of-stack (or `null` on the very first push).

In practice, the current UI never does push+back synchronously — back is always triggered by a user click — so this is latent. But the comment on line 54 ("Mutate ref synchronously so rapid back() calls see fresh state") reveals the author's intent was for refs to always be fresh, and `push` silently violates that contract.

**Fix:** Mirror the back() pattern in push:

```ts
const push = useCallback((entry: NavEntry) => {
  const next = [...entriesRef.current, entry];
  while (next.length > maxEntries) next.shift();
  entriesRef.current = next;
  setEntries(next);
}, [maxEntries]);
```

Note: tests still pass because each `act()` block flushes effects between calls.

---

### 4. `CodeEditor` — `toolbarControls` re-memoizes every render due to `navHistory` object identity — **Minor (perf)**

**File:** `ui/src/components/editors/CodeEditor.tsx` — `handleBack` dep array and `toolbarControls` useMemo deps

**Problem:** `useNavHistory` returns a fresh object literal `{ entries, push, back, clear, canGoBack }` every render. `handleBack` depends on `[navHistory, snippetId, jumpToLine, selectSnippet, setPendingJumpStore]`. Because `navHistory` is a new reference every render, `handleBack` is re-created every render, which in turn busts the `toolbarControls` useMemo (`handleBack` is in its deps) every render. The "stable ref" pattern the author used elsewhere (`snippetIdRef`, `navPushRef`) is defeated for `handleBack`.

Not a correctness bug, but it wastes memoization. The simplest fix is to depend on the primitive/method references the function actually uses:

```ts
const handleBack = useCallback(() => {
  const entry = navHistory.back();
  ...
}, [navHistory.back, snippetId, jumpToLine, selectSnippet, setPendingJumpStore]);
```

Or better, memoize `navHistory` inside `useNavHistory` itself by returning a stable object that only changes when `entries` changes.

---

### 5. GlobalSearch — `handleLinkConfirm` does not re-throw on error, dialog never sees the failure — **Minor**

**File:** `ui/src/components/layout/GlobalSearch.tsx` lines 231-246

**Problem:** `handleLinkConfirm` (passed as `onConfirm` to `LinkAndNavigateDialog`) is an async function with no try/catch. If `linkFile` throws, the rejection propagates up through `LinkAndNavigateDialog.handleConfirm`, which does catch it and display the error — this part works. However, if `linkFile` succeeds but `selectSnippet` or the pending-jump handoff throws (unlikely), the dialog state machine gets inconsistent because `setLinkDialogOpen(false)` only runs on the success branch after `linkFile`, and the pending-jump setter runs before the close.

More importantly, on success this function calls `closeOverlay()` which clears `linkCandidate` etc. Combined with bug #1 (`isProcessing` stuck), the UX on a second Cmd+K pseudo-link flow is broken.

**Fix:** Primarily by fixing bug #1. Defensive: wrap `handleLinkConfirm` body in try/catch and re-throw so the dialog's error branch is explicit.

---

### 6. GlobalSearch — cross-artifact navigation does not push onto nav history — **Minor (UX gap, not a bug)**

**File:** `ui/src/components/layout/GlobalSearch.tsx` — `jumpToSnippet`, `handleLinkConfirm`

**Problem:** When the user navigates via Cmd+K, no entry is pushed onto `useNavHistory`. "Back" after a Cmd+K jump won't return to the previous location. This is because `useNavHistory` is instantiated inside `CodeEditor`, so `GlobalSearch` (mounted at `App` level) has no handle on it.

This is a design gap, not a correctness bug — but users will likely expect Cmd+K jumps to participate in history. If nav history needs to survive across `CodeEditor` remounts and be shared with `GlobalSearch`, it probably belongs in a zustand store, not a local hook.

Flagging for awareness.

---

## Items Checked And Found Clean

- **SQL injection in `getMethodLocation`** — parameters bound via `.get(filePath, methodName)`. Safe.
- **`htmlEscape`** — covers `&`, `<`, `>`, `"`, `'`. Complete.
- **Off-by-one line number (code branch)** — `(code.substring(0, matchIdx).match(/\n/g) || []).length + 1` is correct (0 newlines → line 1).
- **`resolveDefinition` multi-candidate same-path** — correctly routes to `found-linked` when any linked snippet matches, else `needs-link`. Tests cover all four decision branches.
- **`resolveDefinition` empty and null candidates** — guarded.
- **`resolveDefinition` candidates array mutation** — not mutated; only `map`/`Set` reads.
- **`useNavHistory` `maxEntries=0` edge case** — no infinite loop; the while-shift drains to empty.
- **`useNavHistory.back()` ref mirror** — correctly mutates ref synchronously for rapid back-back-back.
- **GlobalSearch `reqIdRef` stale-response guard** — checked in try/catch/finally branches.
- **GlobalSearch debounce cleanup** — cleared on query change, on `closeOverlay`, and on effect cleanup. On unmount, effect cleanup fires.
- **GlobalSearch Cmd+K toggle** — open → close on repeat press.
- **GlobalSearch autofocus** — cleanup clears pending setTimeout.
- **GlobalSearch `findLinkedSnippetForFile`** — `extractSnippetFilePath` and `isLinkedSnippet` both tolerate non-JSON content via try/catch.
- **GlobalSearch `handleResultClick` null snippetId guard** for `kind==='code'`.
- **DefinitionPickerPopover cleanup** — all three effects (click, Escape, scroll) correctly return removeEventListener cleanups.
- **DefinitionPickerPopover key uniqueness** — includes `idx` fallback.
- **LinkAndNavigateDialog rapid double-click** — guarded by `isProcessing` at top of `handleConfirm`.
- **LinkAndNavigateDialog candidate null guard** — `if (!open || !candidate) return null` at line 63.
- **CodeMirrorWrapper Phase 4 click handler guard** — `if (event.metaKey || event.ctrlKey) return false` correctly defers cmd-click to the Go-to-Def extension.
- **CodeEditor `handleGoToDefinition` stable ref pattern** — all mutable reads via refs (`currentSessionRef`, `snippetsRef`, `snippetIdRef`, `envelopeFilePathRef`, `jumpToLineRef`, `navPushRef`).
- **CodeEditor `editorReady` + pending-jump consumption** — effect gated on `editorReady`, and `jumpToLine` is stable (empty deps). `consumePendingJump` only fires when the newly-mounted snippetId matches a pending entry, correctly handling the selectSnippet → remount handoff.
- **`pendingJump.consume` with mismatched snippetId** — returns null, leaves pending in place for the next matching mount.
- **Test correctness:**
  - `definition-resolver.test.ts` covers all 4 decision branches plus edge cases.
  - `useNavHistory.test.ts` uses `renderHook` + `act` correctly.
  - `code-api.test.ts /search` HTML-escape test asserts `&lt;script&gt;` and absence of raw `<script>`.
  - Tests for code branch also assert `<mark>` wrapping is preserved.

---

## Summary

**4 actionable bugs (1 Important UX, 1 Important XSS-adjacent, 2 Minor), 2 design-level notes.**

Priority fix order:
1. Bug #1 (`isProcessing` stuck) — affects every second use of Link and Navigate dialog.
2. Bug #2 (pseudo excerpt not HTML-escaped) — inconsistent and breaks rendering for `.pseudo` files containing angle brackets.
3. Bug #3 (`push` ref sync) — latent but undermines the stated contract.
4. Bug #4 (`handleBack` memoization) — perf only.
