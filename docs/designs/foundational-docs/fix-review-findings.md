# Review Fixes — Code Browser Revamp

Implements all bugs from `review-bugs-code-browser` and all missing test files from `review-completeness-code-browser`.

## Bugs Fixed

### Important (3)

**I1 — `linkFile` cache race creates duplicate snippets**
- **File:** `ui/src/lib/link-file.ts`
- **Change:** Added module-level `inflight = new Map<string, Promise<string>>()` keyed by `${project}::${session}::${filePath}`. First caller installs the promise; concurrent callers reuse it. Promise cleans itself from the map in `.finally()`.

**I2 — `linkFile` cache does not validate session scope**
- **File:** `ui/src/lib/link-file.ts`
- **Change:** Before consulting the snippets cache, compare passed `project`/`session` args against `useSessionStore.getState().currentSession`. If they don't match, skip the cache entirely and fall through to `createSnippet`.

**I3 — `CodeFileView` fetch race on `allowLarge` / reload**
- **File:** `ui/src/components/editors/CodeFileView.tsx:47-65`
- **Change:** Added `if (controller.signal.aborted) return;` at the top of `.then` and `.catch`, and guarded `setLoading(false)` in `.finally` with `if (!controller.signal.aborted)`. Prevents the old aborted effect from clobbering the new effect's `setLoading(true)`.

### Minor (4 fixed, 1 skipped)

**Bug 4 — "Close All" crosses pinned/regular categories**
- **File:** `ui/src/components/layout/tabs/TabBar.tsx:175-178`
- **Change:** `handleCloseAll` now iterates `regularOrdered` (non-pinned, ordered) instead of `tabs` (full list).
- **File:** `ui/src/components/layout/tabs/PinnedTabBar.tsx:56-60`
- **Change:** `handleCloseAll` now iterates `pinned` instead of `tabs`.

**Bug 5 — Drift calc silently false on unparseable `syncedAt`**
- **File:** `ui/src/components/editors/CodeFileView.tsx:77-86`
- **Change:** Wrapped drift calc in `useMemo` with `Number.isFinite(syncedMs)` guard before comparison. Malformed `syncedAt` no longer silently suppresses the stale badge.

**Bug 6 — `peekPseudoFile` unmemoized**
- **File:** `ui/src/components/editors/CodeFileView.tsx:77-80`
- **Change:** Wrapped `peekPseudoFile(project, path)` in `useMemo` keyed on `[project, path, data?.kind]`.

**Bug 8 — TabBar menu inconsistent `getState` vs hook**
- **File:** `ui/src/components/layout/tabs/TabBar.tsx:73,241-243`
- **Change:** Added `const unpinTab = useTabsStore((s) => s.unpinTab);` at the top alongside `pinTab`; replaced inline `useTabsStore.getState().unpinTab(...)` with the hooked version.

**Bug 9 — Dead `group` class in PseudoFileTree**
- **File:** `ui/src/pages/pseudo/PseudoFileTree.tsx:94`
- **Change:** Removed leading `group ` from the row's className — no descendants use `group-hover:` anymore.

**Bug 7 — POSIX-only path in `promote-code-file.ts`**
- **Skipped** per instructions. This project is POSIX-only.

## Tests Added (4 files, 23 tests)

### 1. `ui/src/lib/__tests__/promote-code-file.test.ts` (3 tests)
- Happy path: no matching snippet → `linkFile` called once, `closeTab` + `openPermanent` with returned id.
- Dedupe: snippet envelope with matching `filePath` → `linkFile` NOT called; existing id used.
- Non-code-file tab: falls through to `promoteToPermanent`.

### 2. `ui/src/components/editors/__tests__/CodeFileView.test.tsx` (6 tests)
- Renders CodeMirror on text success.
- Renders "Loading..." while fetching.
- Renders "File not found." on `CodeFileNotFoundError`.
- Renders "Fetch anyway" on truncated text and refetches with `allowLarge`.
- Renders binary placeholder with formatted size.
- Renders image with correct dataUrl src.

### 3. `ui/src/lib/__tests__/pseudo-api.test.ts` (8 tests)
- `fetchCodeFile`: happy text, 404 → `CodeFileNotFoundError`, 400 → `CodeFilePathError`, `allowLarge` appends to URL, default does not.
- `peekPseudoFile`: returns null when not cached.
- `prefetchPseudoFile`: no-op when cached; fire-and-forget error swallowing.

### 4. `ui/src/lib/__tests__/perf-bus.test.ts` (6 tests)
- `mark()` calls `performance.mark` when available.
- `mark()` is no-op when `performance.mark` unavailable.
- `mark()` swallows errors.
- `measureBetween()` calls `performance.measure`.
- `measureBetween()` swallows errors (missing start mark, etc.).
- `measureBetween()` is no-op when `performance.measure` unavailable.

## Existing test updated

- `ui/src/lib/__tests__/link-file.test.ts` — updated both mocks to include `currentSession` so the new session-scope guard (I2) passes. Both existing assertions still pass.

## Verification

- **TypeScript:** `cd ui && npx tsc --noEmit` — no new errors introduced. All errors in output match pre-existing files whitelisted for this review (Section.tsx, Collapsible*, DocumentEditor.legacy.tsx, MarkdownPreview.tsx, SplitPane.tsx, onboarding/*, pseudo/CallsLink|CallsPopover|FunctionJumpPanel|PseudoBlock|PseudoPage, useDesignCanvas.ts).
- **Tests:** `npm run test:ci -- src/lib/__tests__/link-file src/lib/__tests__/promote-code-file src/lib/__tests__/pseudo-api src/lib/__tests__/perf-bus src/components/editors/__tests__/CodeFileView` — **5 files, 25 tests, all passing.**
