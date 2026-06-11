# Bug Review — Phase 4 (Navigation Features)

Reviewed uncommitted changes to pseudo-db / pseudo-api backend, extract-functions lib, CodeMirrorWrapper click extension, FunctionJumpDropdown, ReferencesPopover, CodeEditor wiring, and SnippetEditor pass-through.

## Summary

- No critical or correctness-breaking bugs found.
- 2 Important performance/correctness concerns.
- 4 Minor concerns (edge cases, dead code, stale rect).
- Test coverage and backend additions look correct.

---

## Important

### I1. Load effect re-fetches Tier 1 on every keystroke
**File:** `ui/src/components/editors/CodeEditor.tsx`
**Location:** useEffect deps `[envelope?.filePath, envelope?.code, envelope?.language, currentSession?.project]`

**Problem:** `envelope?.code` is in the dep array, so every keystroke re-triggers the function-lookup effect. That fires a new `/api/pseudo/functions-for-source` network request per keystroke, and on success replaces the `functions` state — causing the FunctionJumpDropdown count/list to flicker and generating avoidable backend load. The pseudo-db index does not change until push, so re-fetching on code edits adds no value.

The Tier 2 fallback (regex) IS code-dependent, but that is a local in-memory call and can stay.

**Fix:** Split into two effects — (a) Tier 1 fetch keyed on `[envelope?.filePath, currentSession?.project]`; (b) Tier 2 fallback keyed on code/language, only running when Tier 1 returned empty. Or debounce the code dep.

---

### I2. `handleSymbolClick` useCallback depends on whole `envelope`, rebuilding click extension every keystroke
**File:** `ui/src/components/editors/CodeEditor.tsx`
**Location:** `const handleSymbolClick = useCallback(..., [currentSession, envelope]);`

**Problem:** `envelope` is re-created via `useMemo` whenever `snippet?.content` changes (i.e. every keystroke). Therefore `handleSymbolClick` gets a new identity every keystroke. That cascades:

1. `SnippetEditor` receives a new `onSymbolClick` prop → `CodeMirrorWrapper`'s `symbolClickExtension = useMemo(..., [onSymbolClick])` rebuilds → `extensions` array is new → CodeMirror reconfigures its extension set on every keystroke.

Even with `@uiw/react-codemirror`'s Compartment-based updates this is wasteful and can interfere with other stateful extensions.

The callback only reads `envelope.filePath`, not `envelope.code`, so the dependency is over-specified.

**Fix:** Change deps to `[currentSession?.project, envelope?.filePath]` (or hold `envelope` in a ref and keep the callback identity stable).

---

## Minor

### M1. ReferencesPopover `anchorRect` goes stale on editor scroll
**File:** `ui/src/components/editors/ReferencesPopover.tsx`
**Location:** `position = useMemo(() => ({top: anchorRect.bottom+8, left: anchorRect.left}), [anchorRect])`

**Problem:** Unlike `FunctionJumpDropdown`, the popover does not re-query the anchor on scroll/resize. If the user scrolls the editor while the popover is open, the popover stays pinned to the old screen coordinates and can visually detach from the symbol.

**Fix:** Either (a) close popover on scroll, or (b) add a window scroll listener with `capture:true` that calls `onClose`, or (c) stash a live position function (CodeMirror `coordsAtPos`) and recompute.

---

### M2. Dead `references.length === 0` branch in ReferencesPopover
**File:** `ui/src/components/editors/ReferencesPopover.tsx` lines 119–122
**Problem:** `CodeEditor.handleSymbolClick` only sets `popover` state when `refs.length > 0`, so the popover is never rendered with an empty array. The "No references found" branch is dead code today.

**Fix:** Either remove the branch or remove the `refs.length > 0` guard in CodeEditor so the popover can show an explicit empty state for discoverability.

---

### M3. `handleSymbolClick` zero-result silent path
**File:** `ui/src/components/editors/CodeEditor.tsx`
**Problem:** When the clicked symbol is an identifier but has zero references (e.g. a local variable), the click is silently ignored. This is by design per the comment, but combined with M2 it means the user gets no feedback whatsoever between "not an identifier" and "valid identifier with no refs". Consider making this behavior explicit in docs/UX, or wire the empty state through.

(Not a correctness bug — flagged for design awareness only.)

---

### M4. `findMatchingBraceLineIndex` does not track template-literal interpolation or nested backticks
**File:** `ui/src/lib/extract-functions.ts`
**Problem:** Strings are tracked via a single quote char. Template literals like `` `${`inner`}` `` (nested backticks) will prematurely exit string mode, and interpolation braces `${...}` are treated as ordinary-inside-string (safe because the `{` and `}` both get ignored inside the string — but nested-backtick strings break it).

In practice this only affects `sourceLineEnd` computation; the function is still detected. Test coverage does not include nested backticks.

**Fix:** Acceptable as-is for Tier 2. If strictness matters later, add a `${` depth tracker and a backtick stack.

---

## Verified (no bug)

- **`fileStemFromPath` edge cases:** handles empty string (→`""`), no extension (→basename), multiple dots (→strips last), and leading-dot files like `.bashrc` (→`.bashrc`) correctly because of the `dot > 0` guard. Consistent with `getBaseStem` in ReferencesPopover.
- **`jumpToLine` clamping:** `Math.max(1, Math.min(line, totalLines))` correctly handles out-of-range input. Reads `editorViewRef.current` freshly (no stale closure).
- **Load-effect cancellation:** `cancelled` flag is checked after the `await` and before `setFunctions`, correctly preventing state updates on unmounted / superseded fetches.
- **`fetchFunctionsForSource` URL encoding:** `URLSearchParams` handles special chars in `sourcePath` correctly.
- **Click extension `return false`:** both no-op and handled paths return `false`, so CodeMirror's normal click handling (cursor placement, focus) still runs.
- **FunctionJumpDropdown scroll listener:** uses `capture:true` on both add and remove — symmetric, no leak.
- **`findSymbolAtPos`** `as any` cast: parent walk is null-checked inside the loop via `if (!node) break`.
- **`currentFilePath` stem match (item 9):** passing `filePath` (source path) works because by convention `foo.ts` and `foo.pseudo` share stem `foo`. `getBaseStem` strips the extension uniformly. Would silently fail only if pseudo and source basenames diverge — not an issue given the project convention enforced elsewhere.
- **ExtractedFunction → FunctionJumpItem cast:** ExtractedFunction is a structural superset (has all required fields plus `sourceLineEnd`, `returnType`, `isAsync`). The `as unknown as` cast in Tier 2 is safe; `handleSelect` null-guards `sourceLine` either way.
- **Backend `getFunctionsForSource` ordering:** `ORDER BY CASE WHEN source_line IS NULL THEN 1 ELSE 0 END, source_line ASC, sort_order ASC` correctly pushes null lines to the end and ties-breaks deterministically.
- **`getReferences` source_line null handling:** `r.source_line ?? null` is correct; the type is widened appropriately.
- **Test `'haskell' language trick`:** backend tests correctly use `language: 'haskell'` so `scanSourceFileForLines` skips and preset `sourceLine`/`sourceLineEnd` are preserved. Matches Phase 3 scanner behavior.
- **extract-functions tests:** 13 tests cover all three regex branches, malformed input, empty/null code, non-TS languages, multi-line body tracking, and string/comment brace disambiguation. `findSymbolAtPos` is not covered (documented as integration-only).
- **FunctionJumpDropdown empty-filtered Enter:** `filtered[highlightedIndex]` can be undefined when list is empty; guarded by `if (fn)`.
- **FunctionJumpDropdown disabled-when-empty:** correctly wires `disabled={isEmpty}` on the button and short-circuits `handleToggle`.
- **`editorViewRef` lifecycle:** CodeMirrorWrapper's `onEditorReady` effect calls the setter on mount and `(null)` on cleanup. React's unmount-before-new-mount ordering keeps the ref in sync across `showPseudo` toggles and PseudoSideBySideView swaps.
