# Design: Code Browser Revamp (standalone, deep)

Supersedes Part 1 of `design-code-browser-and-pair-mode`. Pair-mode content is out of scope here.

---

## Summary

- The "code" tab in the sidebar treats every click as a permanent tab insert rendering **pseudo prose** via `PseudoViewer` — not the source file. The click→paint path is a waterfall (click → persist-write → mount → fetch → parse → render N un-memoized blocks) with no prefetch and a full-pane spinner that swaps content.
- Top three bottlenecks ranked by ROI: (1) `openPermanent` instead of `openPreview` at `ArtifactTree.tsx:1182` causes cascading zustand persist writes + tab-bar growth per click, (2) `PseudoViewer` remounts and refetches with no SWR / cached-render at `PseudoViewer.tsx:41-71`, (3) no hover prefetch on tree rows (`PseudoFileTree.tsx:142-144`) so the fetch starts only *after* the click.
- New default view: **raw source with CodeMirror syntax highlighting** (new `CodeFileView` component); prose becomes a toggle. Pseudo-db is not needed for initial code paint — it is a lazy enrichment.
- Remove the chain-link "link" button (`PseudoFileTree.tsx:165-187`) + its handler (`:93-115`). The promote-to-permanent flow subsumes its only meaningful UX.
- Promote-to-link wiring: extend `useEditorAutoPromote` + `TabBar.tsx` double-click handler via a new thunk `promoteCodeFile(tabId)` that (a) dedupes against existing linked snippet by `envelope.filePath`, (b) calls `linkFile`, (c) swaps the `code-file` preview tab for the resulting `snippet` permanent tab.

---

## Current state (file:line pointers)

### Entry points / click path

- Sidebar "code" tab click handler: `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:1175-1191`. `onNavigate` calls `openPermanent({ id: 'pseudo::<stem>', kind: 'code-file', artifactId: stem, name: basename })`.
- Tree row renderer: `ui/src/pages/pseudo/PseudoFileTree.tsx:73-209`. `TreeNodeRendererImpl` is memoized (`:211`), row click fires `onNavigate(node.path)` at `:144`, hover chain-link button at `:165-187` fires `handleLinkAndOpen` at `:93-115`.
- Sidebar body variant: `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx` wraps `TreeNodeRenderer` from `PseudoFileTree`.
- Pseudo file list fetch: `ArtifactTree.tsx:381-390` → `fetchPseudoFiles(project)` + `api.listAllProjectFiles(project)` joined client-side.

### Center pane dispatch

- `ui/src/components/layout/editor/PaneContent.tsx:179-184` — `case 'code-file'` → `<PseudoViewer path={tab.artifactId} project={project} />`. No raw-code branch exists.

### Pseudo viewer render path

- `ui/src/pages/pseudo/PseudoViewer.tsx:30-176`.
  - `useEffect` at `:41-71` triggers `fetchPseudoFile` with `AbortController` on every `(path, project)` change.
  - Loading spinner at `:102-107` replaces the entire pane.
  - `onFunctionsChange` side-effect at `:74-78` re-fires on every fetch completion.
  - `methods.map(PseudoBlock …)` at `:157-167` has **no** memoization around `PseudoBlock`; each instance calls `fetchPseudoReferences` lazily on expand.

### Pseudo API client + cache

- `ui/src/lib/pseudo-api.ts:96-139`. 32-entry LRU of `PseudoFileWithMethods` keyed by `project\0file`. Strict cache hit — no stale-while-revalidate. Cache invalidated wholesale via `invalidatePseudoFileCache()` from the files-list fetcher on rescan.

### Link-file helper + existing tab-promote plumbing

- `ui/src/lib/link-file.ts:18-42` — creates an empty envelope snippet (`linked: true`), then calls `api.syncCodeFromDisk`. Two HTTP calls per link.
- `ui/src/stores/tabsStore.ts`:
  - `openPreview` (`:128-186`) reuses the single preview slot.
  - `openPermanent` (`:188-227`) unconditionally appends.
  - `promoteToPermanent` (`:229-244`) flips `isPreview` only — no side effects.
  - persist key `collab.tabs.v3` (`:417`) — whole `bySession` serialized per mutation.
- `ui/src/hooks/useEditorAutoPromote.ts` — `editorDirtyBus` → `promoteToPermanent(tabId)` on first dirty signal per tab.
- `ui/src/components/layout/tabs/TabBar.tsx:67,156,171` wires `promoteToPermanent` to double-click / keyboard.
- `ui/src/components/layout/tabs/PinnedTabBar.tsx:16,87` — right-click "Keep" reveals via `promoteToPermanent`.

### Server surfaces touched

- `GET /api/pseudo/file` — `src/routes/pseudo-api.ts` (JSON `PseudoFileWithMethods`). Used by `fetchPseudoFile`.
- `GET /api/code/files` / `?recursive=true` — `src/routes/code-api.ts:44-51`. **Currently no `GET /api/code/file?path=` endpoint** for reading raw source content. Raw text is only available via the linked-snippet envelope path (`syncCodeFromDisk` at `:522`).
- `linkFile` call path: `api.createSnippet` → `api.syncCodeFromDisk` (two roundtrips).

### Other linkFile consumers (must still work after removal)

- `ui/src/components/editors/CodeEditor.tsx:25,261` — "link and navigate" on Go-to-Definition.
- `ui/src/components/layout/GlobalSearch.tsx:20,238` — Cmd-K search result selection.

---

## Bottleneck analysis (ordered by impact)

### B1. Every code-file click appends a permanent tab — MAJOR

- **Symptom:** Tab bar grows with each file click; persist write serializes the entire `bySession` map each time; no in-place swap.
- **Root cause:** `ArtifactTree.tsx:1182` calls `openPermanent`. Contrast: other artifact kinds path through `openPreview` (`ArtifactTree.tsx:638`-ish).
- **Fix:** call `openPreview` for code rows. If user wants persistence, promotion flow (section "Proposed changes → Req 4") handles it.
- **Effort:** ~5 lines.
- **Expected impact:** Eliminates redundant zustand persist writes, visually snappier (preview slot reused), and is the hinge for Req 4.

### B2. `PseudoViewer` does not render cached payload synchronously — MAJOR

- **Symptom:** Revisiting a file flashes the full-pane spinner even when the LRU has the data.
- **Root cause:** `PseudoViewer.tsx:41-71` always `setLoading(true)` then awaits `fetchPseudoFile`. `fetchPseudoFile` returns synchronously-resolved promise for cache hits, but the effect still yields a microtask and the `loading` state still flips.
- **Fix (SWR-ish):** Inspect the cache synchronously on first render (expose a `peekPseudoFile` from `pseudo-api.ts`). If present, initialize `fileData` with it and skip `setLoading(true)`. Then revalidate in background.
- **Effort:** ~15 lines across `pseudo-api.ts` + `PseudoViewer.tsx`.
- **Expected impact:** Revisit = 0 ms perceived; first-visit unchanged.

### B3. No prefetch on hover — MAJOR

- **Symptom:** Click→content painted only after network roundtrip.
- **Root cause:** `PseudoFileTree.tsx:142-144` only attaches `onClick`.
- **Fix:** Attach `onMouseEnter` that calls `fetchPseudoFile(project, relPath)` (fire-and-forget; LRU absorbs it). Consider a small debounce (50 ms) to avoid prefetching the whole tree when the pointer travels over it.
- **Effort:** ~10 lines.
- **Expected impact:** 50–200 ms saved on common navigation (pointer travel covers the fetch).

### B4. No raw-source endpoint → code-first default is not free — MEDIUM

- **Symptom:** Switching default to raw code requires either piggybacking on pseudo-db's stored source (may be stale / may not be stored) or adding an endpoint.
- **Root cause:** `src/routes/code-api.ts` exposes list, push, sync, diff, proposed-edit — **but no plain read**. `syncCodeFromDisk` reads disk, but only through an existing linked-snippet envelope.
- **Fix:** Add `GET /api/code/file?project=&path=` that reads from disk with `validatePathUnderRoot` guarding. Small, isolated.
- **Effort:** ~40 lines server + ~20 lines client.
- **Expected impact:** Unlocks Req 2 cleanly; no coupling to pseudo-db freshness.

### B5. `PseudoBlock` not memoized; map-render cost scales with method count — MEDIUM

- **Symptom:** Files with 30+ methods have visible jank on scroll / expand.
- **Root cause:** `PseudoViewer.tsx:157-167` — `<PseudoBlock />` rendered in `.map` with no `React.memo` on the block itself. Props are stable (method object + stable `onNavigate`), so memoization would reliably skip re-renders.
- **Fix:** `export default React.memo(PseudoBlock)` in `PseudoBlock.tsx`. Double-check the `tokenizeLine` regex has `lastIndex` reset (it does, `:33`).
- **Effort:** 1 line.
- **Expected impact:** Smooth interaction on dense files.

### B6. Full-pane loading spinner — MEDIUM (perceived)

- **Symptom:** User perceives a content swap even when data arrives quickly.
- **Root cause:** `PseudoViewer.tsx:102-107`.
- **Fix:** Replace with a skeleton showing the file header (already known: `path` prop) + three ghost method cards. Cheap perceived-latency win; orthogonal to everything else.
- **Effort:** ~25 lines.
- **Expected impact:** Subjective snappiness, even on cold cache.

### B7. `onFunctionsChange` re-fires parent on every fetch — MINOR

- **Symptom:** Upstream re-renders on each load; may cascade into tab bar.
- **Root cause:** `PseudoViewer.tsx:74-78`. Dependency is `fileData?.methods`, but reference identity changes every fetch even if content is equal.
- **Fix:** Gate with a shallow-equal check or drop the callback entirely if the only consumer is a sidebar list that can subscribe to cache directly.
- **Effort:** ~5 lines.
- **Expected impact:** Small; worth doing once (B1-B3) land.

### B8. `ArtifactTree` full re-render per tab mutation — MINOR

- **Symptom:** Sidebar re-renders when any tab state flips.
- **Root cause:** likely broad zustand selectors (needs audit; outside this doc's scope but flag for a follow-up with `useShallow`).
- **Fix:** Audit `useTabsStore` selectors in `ArtifactTree.tsx`; migrate to `useShallow({ ... })` where appropriate.
- **Effort:** investigation + ~30 lines.
- **Expected impact:** Secondary; only visible once B1 is in.

### B9. Linked-file duplicate creation on repeat promote — MEDIUM correctness

- **Symptom:** User previews the same file twice, edits both, gets two snippets.
- **Root cause:** `linkFile` (`ui/src/lib/link-file.ts:18`) unconditionally creates a snippet. No lookup-first.
- **Fix:** Before creating, scan `sessionStore.snippets` for an envelope whose `filePath` matches; reuse its id.
- **Effort:** ~15 lines.
- **Expected impact:** Correctness (prevents dupes) + avoids a createSnippet+sync roundtrip on repeat.

---

## Proposed changes per requirement

### Req 1 — Snappiness

Apply B1 → B3 → B5 → B2 → B6 in order. Pseudo-diffs:

**B1 (ArtifactTree.tsx:1180-1188):**
```diff
- onNavigate={(stem) => {
-   const basename = stem.split('/').pop() || stem;
-   openPermanent({
-     id: `pseudo::${stem}`, kind: 'code-file',
-     artifactId: stem, name: basename,
-   });
- }}
+ onNavigate={(stem) => {
+   const basename = stem.split('/').pop() || stem;
+   openPreview({
+     id: `pseudo::${stem}`, kind: 'code-file',
+     artifactId: stem, name: basename,
+   });
+ }}
```

**B3 (PseudoFileTree.tsx:142-144):** attach `onMouseEnter={() => !node.isDir && prefetchPseudoFile(project, node.path)}`. Add `prefetchPseudoFile` in `pseudo-api.ts` that no-ops if cached and otherwise triggers a background fetch (no error toast on fail).

**B2 (pseudo-api.ts):**
```ts
export function peekPseudoFile(project: string, file: string): PseudoFileWithMethods | null {
  return pseudoFileCache.get(pseudoFileCacheKey(project, file)) ?? null;
}
```
**(PseudoViewer.tsx):**
```ts
const initial = peekPseudoFile(project, path);
const [fileData, setFileData] = useState<PseudoFileWithMethods | null>(initial);
const [loading, setLoading] = useState(initial == null);
// …keep the existing effect, but if initial != null, treat fetch as revalidation
// (do not flip loading back to true).
```

**B5 (PseudoBlock.tsx):** `export default React.memo(PseudoBlock)`.

### Req 2 — Default to CODE, not pseudo prose

New component `ui/src/components/editors/CodeFileView.tsx`:

- Props: `path: string` (absolute), `project: string`, `editMode: boolean`.
- Data: calls a new `fetchCodeFile(project, path)` → `GET /api/code/file?project=&path=` returning `{ content: string, language: string | null, sizeBytes: number, truncated: boolean }`.
- Renders `<CodeMirrorWrapper value={content} language={lang} readOnly={!editMode} />` with the existing language-detection in `CodeMirrorWrapper`.
- Toolbar: file path (breadcrumb) + **"Prose"** toggle button (label not icon — discoverability) + **"Edit"** button that (a) flips editMode, (b) fires `reportEditorDirty(tabId)` to engage auto-promote.
- Prose toggle states persisted in `uiStore` as `codeFileViewMode: 'code' | 'prose' | 'split'`. Default `'code'`. Shortcut: `Cmd+Shift+.` to cycle.

**PaneContent.tsx:179-184 diff:**
```diff
- case 'code-file': {
-   if (!project) return <NotFound message="Code file requires a project" />;
-   return <PseudoViewer path={tab.artifactId} project={project} />;
- }
+ case 'code-file': {
+   if (!project) return <NotFound message="Code file requires a project" />;
+   return <CodeFileView
+     path={tab.artifactId} project={project}
+     editMode={editMode} tabId={tab.id}
+   />;
+ }
```

**Prose lazy-loads:** When toggle flips to `'prose'` or `'split'`, only then mount `<PseudoViewer />`. First code paint never touches the pseudo-db.

**Component fate:**
- Keep `PseudoViewer` (still used by `/pseudo/:stem` route and the prose toggle in `CodeFileView`).
- Keep `PseudoBlock`.
- Do NOT delete; demote from default center-pane dispatch only.

### Req 3 — Remove the link button

- Delete `PseudoFileTree.tsx:165-187` (hover chain-link button JSX).
- Delete `handleLinkAndOpen` at `:93-115`.
- Remove `import { linkFile } from '@/lib/link-file'` at `:15` (no other usages in this file).
- Remove `openPermanent`, `selectSnippet`, `currentSession` stores/refs from `TreeNodeRendererImpl` if they become unused after the deletion (they do).
- Call-site audit: `linkFile` still used by `CodeEditor.tsx:261` and `GlobalSearch.tsx:238` — leave those untouched. New promote-thunk (Req 4) becomes the fourth caller.
- Behavior lost: the ability to link-without-opening. Subsumed because a single click now opens as preview; editing or double-click promotes → links.

### Req 4 — Temp tab + promote-to-link

**Model:**
- `kind: 'code-file'` + `isPreview: true` → ephemeral; artifactId is the relative file stem; no snippet exists.
- Promotion triggers (all route to `promoteCodeFile(tabId)` thunk):
  1. Double-click tab title — already wired via `TabBar.tsx:156` / `:171` → `promoteToPermanent`. Redirect to the thunk when `tab.kind === 'code-file'`.
  2. Editing — `useEditorAutoPromote` already listens; `CodeFileView` calls `reportEditorDirty(tab.id)` on first keystroke. Same redirect logic inside the hook.
  3. Explicit "Pin" / right-click "Keep" — `PinnedTabBar.tsx:87` path, same redirect.

**New thunk `ui/src/lib/promote-code-file.ts`:**
```ts
export async function promoteCodeFile(tabId: string): Promise<void> {
  const tab = useTabsStore.getState()
    .getSessionTabs(currentKey()!).tabs.find(t => t.id === tabId);
  if (!tab || tab.kind !== 'code-file') {
    useTabsStore.getState().promoteToPermanent(tabId);
    return;
  }
  const session = useSessionStore.getState().currentSession!;
  const absPath = /* resolve via fileMeta registry or tab.artifactId if already abs */;

  // Idempotent: reuse existing linked snippet if present
  const existing = useSessionStore.getState().snippets.find(s => {
    try { return JSON.parse(s.content).filePath === absPath; } catch { return false; }
  });
  const snippetId = existing?.id
    ?? await linkFile(session.project, session.name, absPath);

  // Swap the preview tab for the linked-snippet permanent tab
  const { closeTab, openPermanent } = useTabsStore.getState();
  closeTab(tab.id);
  openPermanent({
    id: snippetId, kind: 'artifact', artifactType: 'snippet',
    artifactId: snippetId, name: tab.name,
  });
}
```

**Hook-point diffs:**
- `useEditorAutoPromote.ts:38`:
  ```diff
  - useTabsStore.getState().promoteToPermanent(tabId);
  + if (tab.kind === 'code-file') void promoteCodeFile(tabId);
  + else useTabsStore.getState().promoteToPermanent(tabId);
  ```
- `TabBar.tsx:156,171`: same branch.
- `PinnedTabBar.tsx:87`: same branch.

**Idempotency:** lookup-first snippet search above; dedupe is client-side using the already-loaded `sessionStore.snippets`. If that list is stale, the subsequent `linkFile` will still create a snippet; the server could be hardened later with a `link_or_reuse` endpoint, but out of scope for v1.

**Error handling:**
- `linkFile` fails after the user edited: keep the preview tab open with a toast ("Could not link file — retry?"). The unsaved edit is held in CodeMirror state; user keeps working. Add a retry button in the toast that re-invokes the thunk.
- Edit hit `reportEditorDirty` first, link failed: we **do not** drop their edit. If the user closes the tab while unlinked-with-edits, show a "Discard unsaved edits?" confirm.

**Undo/close:**
- Close a preview tab with no edits → nothing persisted anywhere, no cleanup needed. The `pseudo::<stem>` id was ephemeral.
- Close after a successful promote → a snippet exists in the session (same behavior as any linked snippet today; user can delete from the artifacts panel).

---

## Edge cases

### Large files (>10k lines)

- Raw CodeMirror handles big files up to ~1–2 MB reasonably but highlighting large TSX is slow. Strategy:
  1. Server caps at, say, 2 MB; over that returns `{ truncated: true, content: "" }` and the client shows a "File too large — open in editor" panel with a "Fetch anyway" button that bypasses the cap.
  2. For 2–10k line range, rely on CodeMirror viewport rendering (already virtualized by default).
  3. Syntax-highlight gated behind a `startTransition` wrapper so the initial render is fast even on slow parse.
  4. `highlightLines`/annotations should not force full re-render; current `CodeMirrorWrapper` is fine but verify.

### Binary / unknown file types

- `fetchCodeFile` server-side sniffs: if extension in `{png,jpg,jpeg,gif,webp,svg,ico}` → respond `{ kind: 'image', url: '/api/code/raw?path=…' }`; `CodeFileView` renders `<img>`.
- `{pdf}` → `{ kind: 'pdf', url }`; render `<iframe>` (fallback).
- Anything else binary (detect via NUL-byte scan in first 4 KB) → `{ kind: 'binary', sizeBytes }`; render a placeholder "Binary file — N bytes, cannot display".
- Unknown text extensions → fall through to `language: null` → plain-text CodeMirror.

### Pseudo prose drift

- If user is viewing **code** and pseudo prose exists with a stale `syncedAt`, surface a subtle badge in the prose toggle: "Prose (stale)". `fileData.syncedAt` vs disk mtime (expose mtime from `fetchCodeFile`) → if disk is newer than `syncedAt` by > 1 day or by content hash, show the badge.
- Do not block the view; do not auto-re-pseudocode. Link the badge to `/pseudo/…` so user can manually regenerate via the existing flow.
- If no pseudo exists at all, the toggle shows "Prose (none)" + disabled, or "Generate prose" calling the `pseudocode` skill flow (out of scope for v1, place a stub).

### Missing files

- Disk-read `ENOENT` on `/api/code/file` → 404; client shows "File not found — may have been moved or deleted. Close tab."
- If it was a linked snippet, existing sync flow already surfaces this (`handleSyncFromDisk` fileDeleted branch).

### Offline pseudo-db / unindexed files

- `fetchPseudoFiles` already catches and returns `[]` (`ArtifactTree.tsx:387`). Combined tree merge uses `api.listAllProjectFiles` as the source of truth; pseudo meta is decoration only. **No change needed** — this is already good.
- In `CodeFileView`, prose toggle for a file with no pseudo row should say "No prose for this file" + suggest generating via skill.

### Symlink / outside-project paths

- Already handled by `validatePathUnderRoot` (`src/utils/path-security.ts`). New `/api/code/file` endpoint must call it.

---

## Testing + telemetry plan

### New tests

- **Unit (tabsStore):**
  - openPreview → openPreview same id = no-op (exists).
  - code-file preview → promoteCodeFile calls linkFile once, closes preview, opens permanent snippet tab (new).
  - promoteCodeFile with existing linked snippet for same filePath dedupes — no linkFile call (new).
  - promoteCodeFile when linkFile throws: preview tab stays open, error bubbles (new).
- **Unit (pseudo-api):**
  - `peekPseudoFile` returns cached entry without network (new).
  - `prefetchPseudoFile` is fire-and-forget, doesn't throw (new).
- **Component (CodeFileView):**
  - Renders CodeMirror with fetched content (new).
  - Prose toggle mounts `PseudoViewer` only on toggle (assert via mock counts) (new).
  - Binary response renders placeholder (new).
  - Truncated response renders "too large" UI (new).
- **Integration (existing PseudoPage.test.tsx):**
  - Replace assertion that clicking a tree row opens permanent tab with: opens preview tab, double-click promotes to snippet tab.
- **Server (code-api.test.ts):**
  - New test file for `GET /api/code/file`: 200, 404 ENOENT, 400 path-escape, binary detection, truncation.

### Regression fences

- Snapshot the tab-list length before/after N clicks in the sidebar — should stay ≤ 1 (the preview slot) when no promotion happens.
- Playwright smoke: click 5 code files, verify only one tab exists, it is italic, double-click promotes and pane shows CodeMirror (not PseudoViewer prose layout).

### Telemetry (minimum to verify snappiness)

Add a thin `perf` bus (client-only) with marks:
- `code-click` (tree row `onClick`)
- `code-tab-mounted` (`CodeFileView` first effect)
- `code-fetch-start`, `code-fetch-end`
- `code-first-paint` (`requestAnimationFrame` after content set)
- `prose-toggle`, `prose-mounted`

Log median + p95 per session to the existing websocket telemetry channel (or `console.log` gated behind `?perf=1` until we have a real sink). Target post-fix: `click → first-paint` p95 < 50 ms for cache hits, < 250 ms for cold fetch.

---

## Rollout plan

Order of PRs (each independently shippable):

1. **PR1 — preview-slot click + hover prefetch + memoize PseudoBlock.** Low-risk perf wins. Flag-free. (B1 + B3 + B5.)
2. **PR2 — SWR peek in PseudoViewer + skeleton loader.** Flag-free. (B2 + B6.)
3. **PR3 — `GET /api/code/file` endpoint + tests.** Pure additive server change. (B4 prerequisite.)
4. **PR4 — `CodeFileView` + prose toggle + `uiStore.codeFileViewMode`.** Behind flag `codeFirstView` (default ON in dev, OFF in prod until burn-in). Swaps default in `PaneContent.tsx:179-184`. Leaves `PseudoViewer` untouched as fallback.
5. **PR5 — Remove link button + handler from `PseudoFileTree.tsx`.** Depends on PR4 being live (promote flow replaces its function).
6. **PR6 — `promoteCodeFile` thunk + rewire `useEditorAutoPromote` / `TabBar` / `PinnedTabBar`.** Depends on PR4. Includes dedupe-by-filePath in `linkFile` (B9).
7. **PR7 — Drift badge + missing-file + binary handling polish.** (Edge cases.)
8. **PR8 — Telemetry marks + perf dashboard.**

Flag lifecycle: remove `codeFirstView` after 2 weeks of dogfooding with zero complaints.

---

## Open questions (need user decision)

1. **Raw-code endpoint or pseudo-db source text?** Prior doc and this one both recommend a new `GET /api/code/file`. Confirm this is the preferred path (vs. exposing pseudo-db's stored source for a single roundtrip but tolerating freshness lag). Recommendation: new endpoint.
2. **Prose toggle persistence scope.** Should `codeFileViewMode` be global (one toggle for all code tabs) or per-tab (user can have file A in code, file B in split)? Global is simpler and matches typical editor UX; per-tab is more flexible. Recommendation: global with a per-tab override in memory only (not persisted).
3. **Should editing a `code-file` preview auto-link immediately or only on explicit promote?** Auto-link on first keystroke is what `useEditorAutoPromote` already enforces for other kinds. If the user hates the implicit link, we need a "don't auto-link" pref. Recommendation: match existing behavior (auto-link on first keystroke).
4. **Split view (code + prose side-by-side) — v1 or v2?** The `codeFileViewMode: 'split'` above assumes we ship it. Splits add layout complexity. Recommendation: v2 — ship `'code' | 'prose'` first.
5. **Do we deprecate the standalone `/pseudo/:stem` route** now that the sidebar is the primary entry? Recommendation: keep the route for deep linking.
6. **Large-file cap value.** 2 MB feels safe; some generated files (`package-lock.json`) blow past that. Accept cap + "fetch anyway" button? Recommendation: 2 MB default, configurable via env.
7. **Telemetry sink.** Do we already have a destination for client perf marks or do we need to build one? If none, PR8 becomes a longer build.
