# Blueprint: Code Browser Revamp

## Source Artifacts
- `design-code-browser-revamp` (standalone deep design doc; supersedes Part 1 of `design-code-browser-and-pair-mode`)

---

## 1. Structure Summary

### Files

**Created**
- [ ] `ui/src/components/editors/CodeFileView.tsx` — new code-first artifact view; mounts CodeMirror on raw source, toggles prose lazily.
- [ ] `ui/src/lib/promote-code-file.ts` — thunk that dedupes + links + swaps preview tab for linked snippet tab.
- [ ] `src/routes/__tests__/code-api.test.ts` — server tests for `GET /api/code/file` (create if missing).
- [ ] `ui/src/components/editors/__tests__/CodeFileView.test.tsx` — component tests (render, prose toggle mount, binary placeholder, truncation UI).

**Modified**
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — `openPermanent` → `openPreview` at the `PseudoTreeBody.onNavigate` callsite (~line 1180-1188). **[PR1]**
- [ ] `ui/src/lib/pseudo-api.ts` — add `peekPseudoFile`, `prefetchPseudoFile`, and a `fetchCodeFile` client. **[PR1/PR2/PR3]**
- [ ] `ui/src/pages/pseudo/PseudoFileTree.tsx` — attach `onMouseEnter` prefetch at ~line 142-144; **[PR1]** remove chain-link button JSX ~165-187 + handler ~93-115. **[PR5]**
- [ ] `ui/src/pages/pseudo/PseudoBlock.tsx` — wrap default export in `React.memo`. **[PR1]**
- [ ] `ui/src/pages/pseudo/PseudoViewer.tsx` — seed state from `peekPseudoFile`; skip `loading=true` on cache hit; replace full-pane spinner with skeleton. **[PR2]**
- [ ] `src/routes/code-api.ts` — new `GET /api/code/file` route with path-security, binary sniff, 2 MB text cap, 1 MB image data-URL cap. **[PR3]**
- [ ] `ui/src/stores/uiStore.ts` — add `codeFileViewMode: 'code' | 'prose'` (default `'code'`, persisted). **[PR4]**
- [ ] `ui/src/components/layout/editor/PaneContent.tsx` — swap `'code-file'` dispatch to `CodeFileView` behind a `codeFirstView` flag; `PseudoViewer` remains fallback. **[PR4]**
- [ ] `ui/src/lib/link-file.ts` — lookup-first snippet dedupe by `envelope.filePath` (B9). **[PR6]**
- [ ] `ui/src/hooks/useEditorAutoPromote.ts` — branch on `tab.kind === 'code-file'` → call `promoteCodeFile`. **[PR6]**
- [ ] `ui/src/components/layout/tabs/TabBar.tsx` — same branch at existing `promoteToPermanent` callsites (~156, ~171). **[PR6]**
- [ ] `ui/src/components/layout/tabs/PinnedTabBar.tsx` — same branch (~87). **[PR6]**
- [ ] `ui/src/lib/perf-bus.ts` — new tiny mark bus (`code-click`, `code-fetch-start/end`, `code-first-paint`, `prose-toggle`, `prose-mounted`). **[PR8]**

### Type Definitions

```ts
// pseudo-api.ts / code-api client additions
export function peekPseudoFile(project: string, file: string): PseudoFileWithMethods | null;
export function prefetchPseudoFile(project: string, file: string): void;

export type CodeFileResponse =
  | { kind: 'text'; content: string; language: string | null; sizeBytes: number; truncated: boolean; mtimeMs: number }
  | { kind: 'image'; sizeBytes: number; mimeType: string; dataUrl: string }
  | { kind: 'binary'; sizeBytes: number };

export async function fetchCodeFile(project: string, path: string): Promise<CodeFileResponse>;

// uiStore additions
codeFileViewMode: 'code' | 'prose';
setCodeFileViewMode(mode: 'code' | 'prose'): void;

// new thunk
export async function promoteCodeFile(tabId: string): Promise<void>;
```

### Component Interactions

```
Sidebar click (ArtifactTree PseudoTreeBody)
  → openPreview({ kind: 'code-file', artifactId: stem, id: 'pseudo::'+stem })
  → tabsStore preview slot mutation (single slot reused)
  → PaneContent dispatch on kind='code-file'
     → (flag ON)  <CodeFileView path project editMode tabId />
                    → fetchCodeFile(project,path) → CodeMirror
                    → prose toggle mounts <PseudoViewer> lazily
     → (flag OFF) <PseudoViewer path project /> (legacy)

Promote path (double-click OR first edit OR explicit pin):
  promoteToPermanent(tabId) call redirected if tab.kind==='code-file' →
  promoteCodeFile(tabId):
    1. Dedupe: find existing snippet with envelope.filePath === path
    2. If none: linkFile(project,session,path) → snippetId
    3. closeTab(tabId) + openPermanent({ kind: 'artifact', artifactType: 'snippet', id: snippetId })
    4. On failure: keep preview tab, emit toast with Retry
```

---

## 2. Function Blueprints

### `peekPseudoFile(project, file): PseudoFileWithMethods | null`

**Pseudocode:**
1. Compute `pseudoFileCacheKey(project, file)`.
2. Return `pseudoFileCache.get(key) ?? null`.

**Error handling:** none — pure accessor.
**Edge cases:** cache evicted → null (caller handles).
**Test strategy:** seed cache via `fetchPseudoFile` with a mocked network response; assert `peekPseudoFile` returns the same object reference.

---

### `prefetchPseudoFile(project, file): void`

**Pseudocode:**
1. If `peekPseudoFile` returns non-null, return immediately.
2. Call `fetchPseudoFile(project, file)` in a fire-and-forget way — chain `.catch(() => {})` to swallow.

**Error handling:** swallow all errors.
**Edge cases:** directories → caller filters `!node.isDir` before calling.
**Test strategy:** network mock; assert fetch called once on cold, zero times on warm.

---

### `fetchCodeFile(project, path): Promise<CodeFileResponse>`

**Pseudocode:**
1. Build `GET /api/code/file?project=<enc>&path=<enc>`.
2. Parse JSON; runtime-validate discriminant `kind`.
3. Return typed payload.

**Error handling:** network errors throw; 404 throws `CodeFileNotFoundError`; 400 throws `CodeFilePathError`.
**Edge cases:** mtimeMs may be 0 on some filesystems — keep as-is.
**Test strategy:** mocked fetch for each `kind`.

---

### Server: `GET /api/code/file` handler

**Pseudocode:**
1. Parse `project`, `path` query params; require both.
2. `validatePathUnderRoot(project, path)` → resolved absolute; throw 400 on escape.
3. `stat()` the file; 404 if `ENOENT`.
4. Read first 4 KB; scan for NUL byte.
5. If NUL and extension in IMAGE_EXTS and size ≤ 1 MB: read full, base64-encode, return `{ kind: 'image', dataUrl, mimeType, sizeBytes }`.
6. Else if NUL (or unknown binary > 1 MB): return `{ kind: 'binary', sizeBytes }`.
7. Else (text): if size > 2 MB, return `{ kind: 'text', content: '', sizeBytes, truncated: true, mtimeMs, language }`.
8. Else: read full as utf-8; infer `language` from extension map; return `{ kind: 'text', content, language, sizeBytes, truncated: false, mtimeMs }`.

**Error handling:**
- Path escape → 400 `{ error: 'invalid path' }`.
- ENOENT → 404 `{ error: 'not found' }`.
- Other fs errors → 500 `{ error: message }`.

**Edge cases:**
- Symlink to outside-project target: `validatePathUnderRoot` uses realpath internally — verify it does; if not, add a realpath check.
- Zero-byte file → `{ kind: 'text', content: '', truncated: false, … }`.
- Non-UTF-8 bytes in "text" file → server returns buffer.toString('utf-8') (lossy); acceptable for v1.

**Test strategy:**
- 200 text small file.
- 200 text 2 MB+1 byte → truncated.
- 200 binary (png) under 1 MB → image dataUrl.
- 200 binary over 1 MB → `{ kind: 'binary' }`.
- 404 ENOENT.
- 400 `../../../etc/passwd`.

---

### `CodeFileView({ path, project, editMode, tabId })` component

**Pseudocode:**
1. `useUIStore(s => [s.codeFileViewMode, s.setCodeFileViewMode])`.
2. `useEffect` on `(path, project)`: mark `perf-bus.code-fetch-start`; call `fetchCodeFile`; set `data`; mark `code-fetch-end`.
3. `useLayoutEffect` after `data` set: `requestAnimationFrame(() => perf-bus.code-first-paint)`.
4. Render toolbar: breadcrumb (path) | **Code / Prose** toggle | Edit button.
5. Body dispatch on `data.kind` + `codeFileViewMode`:
   - `text` + `code` → `<CodeMirrorWrapper value=data.content language=data.language readOnly=!editMode onDirty=reportEditorDirty(tabId) />`.
   - `text` + `prose` → lazy-mount `<PseudoViewer path project />`.
   - `text` truncated → "File too large ({sizeBytes}) — [Fetch anyway]" button that refetches with `?allowLarge=1`.
   - `image` → `<img src=dataUrl alt=path />`.
   - `binary` → placeholder "Binary file — {sizeBytes} bytes — cannot display".
6. Edit button: flips `editMode` via existing UnifiedEditor conventions; fires `reportEditorDirty(tabId)` to kick auto-promote.

**Error handling:**
- Fetch throw → "Failed to load. [Retry]".
- CodeFileNotFoundError → "File not found. Close tab."
- On Prose-toggle with no pseudo row, render "No prose for this file" from `PseudoViewer` itself (it already handles empty).

**Edge cases:**
- File mtime newer than pseudo `syncedAt` by > 1 day → badge on Prose toggle: "Prose (stale)".
- `codeFileViewMode === 'prose'` but file is binary → auto-fall-back to binary placeholder; show toast "No prose for binary files".

**Test strategy:** see component tests list above.

---

### `promoteCodeFile(tabId): Promise<void>`

**Pseudocode:**
1. Resolve current session key; get tab from `tabsStore`.
2. If `tab.kind !== 'code-file'` → fall through to `promoteToPermanent(tabId)` and return.
3. Resolve absolute path from `tab.artifactId` (relative stem) + `session.project`.
4. Scan `sessionStore.snippets` for an envelope whose parsed `filePath === absPath`; capture `existingId`.
5. `const snippetId = existingId ?? await linkFile(project, session, absPath);`
6. `closeTab(tabId)`.
7. `openPermanent({ id: snippetId, kind: 'artifact', artifactType: 'snippet', artifactId: snippetId, name: tab.name })`.

**Error handling:**
- `linkFile` throws → leave preview tab open, emit toast with Retry button (the preview's CodeMirror state still holds unsaved edits).
- Double-dispatch protection: if `useEditorAutoPromote` already ran once for this tab, its own `promoted` Set guards re-entry.

**Edge cases:**
- Stale `sessionStore.snippets` → may skip dedupe and create a duplicate; acceptable for v1 (documented in design doc).
- User closes tab mid-flight → the async link call still completes but its `openPermanent` will just open a new tab; acceptable.

**Test strategy:**
- Happy path: no existing snippet → linkFile called once, preview closed, permanent snippet tab opened.
- Dedupe: existing snippet with matching `filePath` → linkFile NOT called, preview closed, permanent tab opened with existing id.
- Failure: linkFile rejects → preview tab still present, toast emitted (mock).

---

### `linkFile` (modified): dedupe by filePath

**Pseudocode (new):**
1. Read `sessionStore.snippets`; find snippet where `JSON.parse(content).filePath === path`.
2. If found → return its id (no server call).
3. Else → existing `createSnippet` + `syncCodeFromDisk` path.

**Error handling:** unchanged from current; JSON.parse errors swallowed (skip).
**Edge cases:** snippet content not valid JSON → skip.
**Test strategy:** unit test with stores in both states.

---

### `useEditorAutoPromote` (modified)

**Pseudocode (diff at line 38):**
```ts
if (tab.isPreview) {
  if (tab.kind === 'code-file') void promoteCodeFile(tabId);
  else useTabsStore.getState().promoteToPermanent(tabId);
}
```

**Test strategy:** fire `reportEditorDirty` for a code-file preview tab with and without a matching snippet; assert linkFile call counts.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  # ────────── PR1 (parallel, low-risk perf) ──────────
  - id: pr1-preview-slot
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.clicks.test.tsx]
    description: "Code-row click uses openPreview instead of openPermanent (B1)."
    parallel: true
    depends-on: []
  - id: pr1-hover-prefetch
    files:
      - ui/src/lib/pseudo-api.ts
      - ui/src/pages/pseudo/PseudoFileTree.tsx
    tests: [ui/src/lib/__tests__/pseudo-api.test.ts]
    description: "Add prefetchPseudoFile + onMouseEnter hook on tree rows (B3)."
    parallel: true
    depends-on: []
  - id: pr1-memoize-pseudoblock
    files: [ui/src/pages/pseudo/PseudoBlock.tsx]
    tests: []
    description: "React.memo default export of PseudoBlock (B5)."
    parallel: true
    depends-on: []

  # ────────── PR2 (SWR + skeleton) ──────────
  - id: pr2-peek-and-skeleton
    files:
      - ui/src/lib/pseudo-api.ts
      - ui/src/pages/pseudo/PseudoViewer.tsx
    tests: [ui/src/lib/__tests__/pseudo-api.test.ts]
    description: "peekPseudoFile + seed initial state; replace full-pane spinner with skeleton (B2, B6)."
    parallel: true
    depends-on: []

  # ────────── PR3 (server endpoint) ──────────
  - id: pr3-code-file-endpoint
    files: [src/routes/code-api.ts]
    tests: [src/routes/__tests__/code-api.test.ts]
    description: "GET /api/code/file with path-security, binary sniff, 2MB text cap, image data URLs ≤1MB (B4)."
    parallel: true
    depends-on: []

  # ────────── PR4 (CodeFileView + flag-gated default) ──────────
  - id: pr4a-ui-store-view-mode
    files: [ui/src/stores/uiStore.ts]
    tests: [ui/src/stores/__tests__/uiStore.test.ts]
    description: "codeFileViewMode 'code' | 'prose' with persist."
    parallel: false
    depends-on: []
  - id: pr4b-code-file-view
    files:
      - ui/src/components/editors/CodeFileView.tsx
      - ui/src/lib/pseudo-api.ts
    tests: [ui/src/components/editors/__tests__/CodeFileView.test.tsx]
    description: "CodeFileView component with CodeMirror code view + lazy prose toggle + truncation/binary/image handling; fetchCodeFile client."
    parallel: false
    depends-on: [pr3-code-file-endpoint, pr4a-ui-store-view-mode]
  - id: pr4c-pane-content-dispatch
    files: [ui/src/components/layout/editor/PaneContent.tsx]
    tests: [ui/src/components/layout/editor/__tests__/PaneContent.test.tsx]
    description: "Swap 'code-file' dispatch to CodeFileView behind codeFirstView flag (PseudoViewer remains fallback)."
    parallel: false
    depends-on: [pr4b-code-file-view]

  # ────────── PR5 (remove link button) ──────────
  - id: pr5-remove-link-button
    files: [ui/src/pages/pseudo/PseudoFileTree.tsx]
    tests: []
    description: "Delete chain-link button JSX (~165-187) + handleLinkAndOpen (~93-115); prune unused imports."
    parallel: false
    depends-on: [pr4c-pane-content-dispatch]

  # ────────── PR6 (promote-to-link) ──────────
  - id: pr6a-link-file-dedupe
    files: [ui/src/lib/link-file.ts]
    tests: [ui/src/lib/__tests__/link-file.test.ts]
    description: "Lookup-first dedupe by envelope.filePath before createSnippet (B9)."
    parallel: true
    depends-on: []
  - id: pr6b-promote-code-file
    files: [ui/src/lib/promote-code-file.ts]
    tests: [ui/src/lib/__tests__/promote-code-file.test.ts]
    description: "New thunk: dedupe lookup, linkFile, closeTab, openPermanent snippet tab."
    parallel: false
    depends-on: [pr6a-link-file-dedupe]
  - id: pr6c-rewire-promotion
    files:
      - ui/src/hooks/useEditorAutoPromote.ts
      - ui/src/components/layout/tabs/TabBar.tsx
      - ui/src/components/layout/tabs/PinnedTabBar.tsx
    tests:
      - ui/src/hooks/__tests__/useEditorAutoPromote.test.ts
      - ui/src/components/layout/tabs/__tests__/TabBar.test.tsx
    description: "Branch on tab.kind === 'code-file' at every promoteToPermanent callsite → promoteCodeFile."
    parallel: false
    depends-on: [pr6b-promote-code-file]

  # ────────── PR7 (edge cases polish) ──────────
  - id: pr7-edge-cases
    files: [ui/src/components/editors/CodeFileView.tsx]
    tests: [ui/src/components/editors/__tests__/CodeFileView.test.tsx]
    description: "Drift badge on Prose toggle; missing-file UI; binary/image placeholders; 'Fetch anyway' for truncated."
    parallel: false
    depends-on: [pr4c-pane-content-dispatch]

  # ────────── PR8 (telemetry) ──────────
  - id: pr8-perf-bus
    files:
      - ui/src/lib/perf-bus.ts
      - ui/src/components/editors/CodeFileView.tsx
      - ui/src/pages/pseudo/PseudoFileTree.tsx
    tests: [ui/src/lib/__tests__/perf-bus.test.ts]
    description: "Thin perf-mark bus: code-click, code-fetch-start/end, code-first-paint, prose-toggle/mounted."
    parallel: false
    depends-on: [pr4c-pane-content-dispatch]
```

### Execution Waves

**Wave 1 (parallel):**
- `pr1-preview-slot`, `pr1-hover-prefetch`, `pr1-memoize-pseudoblock`, `pr2-peek-and-skeleton`, `pr3-code-file-endpoint`, `pr4a-ui-store-view-mode`, `pr6a-link-file-dedupe`

**Wave 2:**
- `pr4b-code-file-view` (depends on pr3 + pr4a)
- `pr6b-promote-code-file` (depends on pr6a)

**Wave 3:**
- `pr4c-pane-content-dispatch` (depends on pr4b)
- `pr6c-rewire-promotion` (depends on pr6b)

**Wave 4:**
- `pr5-remove-link-button` (depends on pr4c)
- `pr7-edge-cases` (depends on pr4c)
- `pr8-perf-bus` (depends on pr4c)

### Summary
- Total tasks: 14
- Total waves: 4
- Max parallelism: 7 (Wave 1)
