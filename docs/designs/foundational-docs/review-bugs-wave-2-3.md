# Wave 2 + Wave 3 Milkdown Parity — Bug Review

Scope: new files under `ui/src/components/editors/milkdown/`, `DocumentEditor.wysiwyg.tsx`, `CollapsibleSection.tsx`, `resolveImageSrc.ts`, `src/services/document-metadata.ts`.

All scope files except `CollapsibleSection.tsx` (which has a single-line tweak vs HEAD) are untracked new files. Reviewed their content directly.

---

## Critical

### 1. `imageResolver.tsx:39` — `stopEvent: () => true` breaks all image interaction
**File:** `ui/src/components/editors/milkdown/plugins/imageResolver.tsx:37-41`
**What's wrong:** The image NodeView is registered with `stopEvent: () => true`, which instructs ProseMirror to stop *every* DOM event originating in the NodeView. This prevents selection, cursor-positioning clicks, drag, and keyboard navigation involving images. For non-interactive `<img>` content that's a regression from the legacy renderer.
**Why it matters:** Users cannot select/delete images or position the cursor via clicking near them once any image is rendered.
**Fix:** Remove `stopEvent: () => true` (default behavior is correct for a passive `<img>` view). If a specific event needs swallowing, narrow the predicate (e.g. return true only for `dragstart` if that's the intent).

---

## Important

### 2. `DocumentEditor.wysiwyg.tsx:343` — AnnotationToolbar sees `editorView=null` on first mount
**File:** `ui/src/components/editors/DocumentEditor.wysiwyg.tsx:342-346`
**What's wrong:** `editorView={milkdownHandleRef.current?.getView() ?? null}` reads a ref during render. On first render the inner `<MilkdownEditor>` hasn't attached the imperative handle yet, so `.current` is null. React does NOT re-render when refs populate, so the toolbar keeps `editorView=null` until some unrelated state change forces a re-render. Every annotation button short-circuits on `if (!editorView) return`.
**Why it matters:** Clicking Comment/Propose/Approve/Reject immediately after opening a doc silently does nothing.
**Fix:** Track the view in state, not a ref (e.g. `const [view, setView] = useState<EditorView|null>(null)` and set it from a `useEffect` that polls `getView()` after the editor mounts, or expose an `onReady(view)` callback on `MilkdownEditor`).

### 3. `DocumentEditor.wysiwyg.tsx:128-192` — Annotations are not persisted on save
**File:** `ui/src/components/editors/DocumentEditor.wysiwyg.tsx:128-139,150-192`
**What's wrong:** `stashPendingAnnotations` writes the annotation list to `window.__pendingAnnotations` but `handleSave` only passes `{ content, lastModified }` to `updateDocument` — the annotations are never read back or persisted. Comment acknowledges this as a stub, but the toolbar is wired and writing to `handleAnnotationsChange`, so end users creating annotations will lose them on refresh.
**Why it matters:** Annotation data loss; also `hasChanges` flips on each annotation change, tricking the user into thinking save will persist them.
**Fix:** Thread the metadata through `updateDocument` (the server-side schema in `src/services/document-metadata.ts` already exists). At minimum, suppress `hasChanges` from annotation-only edits until wiring is complete to avoid the "Save does nothing" UX trap.

### 4. `annotations/anchor.ts:88-116` — `mapTextOffsetToPos` doesn't account for block separators
**File:** `ui/src/components/editors/milkdown/plugins/annotations/anchor.ts:70-116`
**What's wrong:** The fallback anchor resolver uses `doc.textBetween(0, docSize, '\n', '\n')` to compute `fullText`, so every block boundary contributes a `\n` character to offsets. But `mapTextOffsetToPos` only sums `node.text?.length` of text nodes and explicitly skips the `isBlock && !isTextblock` branch without incrementing `consumed`. Any anchor text whose location is beyond the first block will map to a PM position that is off by exactly N (N = number of inter-block `\n` separators before the match). Off-by-one at every paragraph.
**Why it matters:** When the primary range+checksum check fails (the whole point of the fallback — doc drifted), the fallback computes the wrong PM positions, so decorations render in the wrong place or fail `resolved.from === resolved.to` guard.
**Fix:** Increment `consumed` by 1 for each block separator `textBetween` injects. Mirror `textBetween`'s traversal exactly, or use a helper that walks `doc` identically to how `textBetween` assembles its string.

### 5. `MilkdownEditor.tsx:308-312` — `setAnnotationsMeta` dispatch is a no-op while editor is loading
**File:** `ui/src/components/editors/milkdown/MilkdownEditor.tsx:308-312`
**What's wrong:** The effect dispatches `setAnnotationsMeta` only when `props.annotations` changes, and silently no-ops if `getView()` returns null. On first mount the plugin's `init` reads from `annotationsRef` (fine), but if `props.annotations` is updated *between* the first render and the editor finishing initialization, the meta dispatch is dropped and the ref-based `init` already ran with the earlier value. Since the plugin only rebuilds decorations via `setAnnotations` meta or `docChanged`, stale decorations persist until the user types.
**Why it matters:** Annotation list updates that happen immediately after doc open (e.g. migration, async metadata fetch) may not render until the user edits.
**Fix:** Add a loading-complete effect that dispatches the current `props.annotations` once the editor view is available. Easiest: depend on both `props.annotations` *and* the loading flag; retry dispatch after `loading` flips to false.

---

## Minor

### 6. `headingCollapse.ts:122-123` — `collapseStateRef.allSections` dead-write
**File:** `ui/src/components/editors/milkdown/plugins/headingCollapse.ts:122-123`
**What's wrong:** `buildDecorations` publishes `collapseStateRef.allSections = new Set(...)` but no code reads from `collapseStateRef.allSections`. The CollapsibleSectionsProvider maintains its own `allSections` via `registerSection` calls from the NodeView. Comment claims it is "so the context can know the full set" — but the context never consults the ref.
**Fix:** Either remove the dead assignment or bridge it into the context (e.g. via the existing bump-meta path plus a React subscription).

### 7. `headingCollapse.ts:96-116` — inner `doc.forEach` has no early exit
**File:** `ui/src/components/editors/milkdown/plugins/headingCollapse.ts:96-116`
**What's wrong:** After finding the next same-or-higher heading and setting `started = false`, the forEach continues iterating over all remaining top-level children. Logic is safe (no decos added when `!started`) but each outer heading iteration is O(doc-children) — full pass is O(headings × children). Not a bug per se, just wasteful on large docs.
**Fix:** Replace `doc.forEach` with an index-based loop that can `break`.

### 8. `rawDetails.ts:11-14` — `hasOpenAttr` false-positive on attrs containing "open"
**File:** `ui/src/components/editors/milkdown/plugins/rawDetails.ts:11-14`
**What's wrong:** `/\bopen\b/i` matches `open` within e.g. `class="open-shut"` because `-` is a word boundary. A `<details class="open-shut">` (no `open` boolean attr) would be reported as open.
**Fix:** Match attribute form explicitly: `/(^|\s)open(\s|=|$)/i`.

### 9. `annotations/migrator.ts:83` — reject-start reason cannot begin with `-`
**File:** `ui/src/components/editors/milkdown/plugins/annotations/migrator.ts:83`
**What's wrong:** `<!--\s*reject-start:([^-][^>]*?)-->` requires the first char of the reason to not be `-`, so reasons like `"- out of scope"` are skipped entirely, leaving the marker in the markdown.
**Fix:** Drop the `[^-]` anchor: `<!--\s*reject-start:([\s\S]*?)-->`, and trim in the handler.

### 10. `annotations/toolbar.tsx:112-128` — Clear wipes all annotations on collapsed selection
**File:** `ui/src/components/editors/milkdown/plugins/annotations/toolbar.tsx:112-128`
**What's wrong:** If the user clicks Clear with a collapsed selection, ALL annotations on the document are deleted with no confirmation. Title just says "Clear annotations".
**Fix:** Prompt `window.confirm` before clearing all, or require a selection.

### 11. `rawDetails.ts:36-69` — self-contained `<details>…</details>` in a single html node is not matched
**File:** `ui/src/components/editors/milkdown/plugins/rawDetails.ts:36-69`
**What's wrong:** If remark emits one html node whose value contains both `<details ...>` and `</details>`, the matcher starts depth=1 and scans siblings from `i+1`, never finding a closer, so the node is left untouched (rendered as raw HTML in the doc).
**Fix:** Before sibling scan, check whether the opener's own value contains a balanced closer (respecting depth), and if so treat it as self-contained.

### 12. `serializerConfig.ts:296-303` — list_item label ignores ordered-list `start`
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:296-303`
**What's wrong:** Labels for ordered items are computed as `${idx+1}.`, ignoring the parent's `start` attr. If a user writes `5.\n6.\n7.` the attrs become `1.`, `2.`, `3.`. Cosmetic only (label isn't round-tripped to markdown — `start` is), but UI components reading `label` will be misleading.
**Fix:** Use `start + idx` when the parent is ordered.

### 13. `rawPositions.ts:51-53` — break-style detection precedence
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:44-53`
**What's wrong:** If the ±2 window contains both `\\\n` and `  ` (unlikely but possible in pathological docs) backslash wins; then the `spaces` branch is unreachable by an else-if sequence that relies on mutual exclusivity. The check `src[startOffset - 1] === '\\'` also treats a literal backslash followed by any char as backslash-break, potentially mis-classifying lines like `\*text`.
**Fix:** Scan backwards to first non-space/non-backslash char and decide deterministically from that prefix.

### 14. `DocumentEditor.wysiwyg.tsx:71-96` — migration runs at most once but sets `hasChanges=true` without saving
**File:** `ui/src/components/editors/DocumentEditor.wysiwyg.tsx:71-96`
**What's wrong:** After migrating legacy markers, `hasChanges` is set so user knows to save. But if user navigates away without saving, next open re-migrates (cheap) but each session also tries to stash annotations into `window.__pendingAnnotations` that is never persisted (see bug #3). Net effect: forever-dirty doc that can't actually persist migration.
**Fix:** Gated on bug #3 — once annotations persist, this is benign.

---

## Not-a-bug but worth noting
- `useHeadingCollapseBridge` in `MilkdownEditor.tsx` is called unconditionally even when no provider is mounted — it uses `useCollapsibleSectionsSafe` and no-ops when context is null. OK.
- `autosaveDelayInitial = useRef(autosaveDelay).current` correctly captures at mount (I4 pattern). OK.
- Plugin ordering (rawPositions → commonmark/gfm → fidelityPlugins → autosave → annotations → headingCollapse → views) looks correct. `$remark` plugins must register before schema runners consume their `data.*` fields, and they do.

---

## Summary of counts
- Critical: 1
- Important: 4
- Minor: 9
- Total: 14
