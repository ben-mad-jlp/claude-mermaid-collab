# Bug Review — Milkdown Parity

Scope: uncommitted milkdown-parity changes. Checked for logic/null/async/data/resource/edge bugs only (not design compliance).

## Important

### 1. Annotation toolbar receives stale null editorView on first render
**File:** `ui/src/components/editors/DocumentEditor.wysiwyg.tsx:343`
```tsx
editorView={milkdownHandleRef.current?.getView() ?? null}
```
`milkdownHandleRef` is a ref; reading it during render doesn't cause a re-render when it mutates. On the very first render (and any render where the handle hasn't yet been assigned by `setRefs` in `MilkdownEditor`) this is `null`, and nothing forces React to re-render the parent once the handle becomes available. Result: every click on Comment/Propose/Approve/Reject silently no-ops because `addAnnotation` early-returns on `!editorView` (see `toolbar.tsx:74`).
**Fix:** store the view in state (e.g. `useState<EditorView | null>(null)`), and have `MilkdownEditor` call an `onReady(view)` callback after mount (or use a forceUpdate triggered when the handle is installed), so the toolbar re-renders with a real view.

### 2. `mapTextOffsetToPos` fallback computes wrong PM positions when anchor spans blocks
**File:** `ui/src/components/editors/milkdown/plugins/annotations/anchor.ts:72-80, 88-116`
`fullText = doc.textBetween(0, docSize, '\n', '\n')` inserts `\n` separators between blocks, so string offsets from `indexOf` include those separators in their counts. `mapTextOffsetToPos` only accumulates `node.isText` lengths and skips the synthetic separators, so the computed PM position is shifted by N for every block boundary crossed before the target. Any anchor that drifts such that the text-scan fallback runs — and whose containing paragraph comes after any other block — will resolve to a wrong range.
**Fix:** increment `consumed` by 1 at each block-boundary crossing that `textBetween` would have inserted a `\n` for (i.e., when moving between sibling block nodes), mirroring the separator logic.

### 3. Stale annotations used to rebuild decorations when `setAnnotations` meta fires while view is unavailable
**File:** `ui/src/components/editors/milkdown/plugins/annotations/decoration.ts:58-73` combined with `MilkdownEditor.tsx:308-312`
The dispatch effect `view?.dispatch(setAnnotationsMeta(...))` no-ops silently when `innerHandleRef.current?.getView()` returns `null` (editor still loading). The PM plugin's `apply` only updates its `value.annotations` on the `SET_ANNOTATIONS_META` meta; on plain `docChanged` it rebuilds decorations from `value.annotations` (the captured state), not from the `getAnnotations` ref. So if `props.annotations` changes before the editor mounts, the update is dropped and subsequent doc edits decorate with the initial annotation list forever.
**Fix:** in `apply`, when no meta is present but `docChanged`, re-read `getAnnotations()` (close over it via plugin factory) so state stays in sync with the ref; or queue the pending annotations and re-dispatch on first successful `getView()`.

### 4. HistoryModal version-select handler is dead code
**File:** `ui/src/components/editors/DocumentEditor.wysiwyg.tsx:210-221, 277, 365-372`
`handleHistoryVersionSelect` is defined, then explicitly silenced with `void handleHistoryVersionSelect;`. `HistoryModal` is rendered without any prop that would invoke it, so selecting a historical version never updates `selectedHistoryContent`/`selectedHistoryTimestamp`. The history "view" flow is non-functional in the WYSIWYG variant.
**Fix:** pass the callback to `HistoryModal` via its version-select prop (match the legacy wiring), or remove the unused callback if history selection is intentionally out-of-scope.

## Minor

### 5. Text unescape handler can corrupt literal backslash sequences
**File:** `ui/src/components/editors/milkdown/serializerConfig.ts:22-27`
The post-process runs `replace(/\\\*/g, '*')` etc. on every text-run serialization. For a text node whose source was `\\*` (literal backslash + asterisk, which remark would stringify as `\\\*`), this collapses to `\*` on the first pass — data drift on round-trip. Real but narrow (user-authored literal backslashes immediately before `*_~#`).
**Fix:** only strip escapes that are provably unnecessary in context, or run the unescape against a whitelist of "definitely-safe" positions rather than globally.

### 6. Reject-start reason regex rejects reasons starting with `-`
**File:** `ui/src/components/editors/milkdown/plugins/annotations/migrator.ts:83`
`reject-start:([^-][^>]*?)-->` requires the first char of the reason to not be `-`. A legacy marker like `<!-- reject-start:-wrong tone --> ... <!-- reject-end -->` wouldn't match and would be left as-is in the cleaned markdown, breaking the one-shot migration invariant.
**Fix:** change first char class to `[^>]` (or `\s*`) so any reason is accepted: `reject-start:\s*([^>]*?)-->`.

### 7. `rawPositions` pass 1 assigns `rawTrailing` to listItem using next-sibling offset — last item gets the trailing space after the whole list
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:24-34`
For the last `listItem` in a list, `next` is `undefined`, so `nextStart = src.length`; the rawTrailing then contains everything after the list (blank lines, subsequent blocks). When that gets consumed by the `join` handler for the inner list, it will over-count blank lines between that listItem and the following list item (there is none) — benign since `state.next` stops at end of list. But the same math applied to the last top-level block means the final heading/paragraph rawTrailing includes trailing EOF whitespace; `join` subtracts 1 and clamps, so it's usually 0. Edge case: a document ending with multiple trailing newlines will over-report blank lines if the last block is followed by another via later insertion.
**Fix:** cap `nextStart` to `parent.position?.end?.offset ?? src.length` to keep the slice scoped to the parent's span.

### 8. `break` style detection heuristic can misclassify `backslash` style
**File:** `ui/src/components/editors/milkdown/plugins/rawPositions.ts:49`
`window2.includes('\\\n') || src[startOffset - 1] === '\\'` will flag any backslash immediately preceding the break offset as "backslash style", even when the backslash is escaping a different char within text that happens to abut the break. The `  ` (two-space) check is done after, so spaces-style can be overridden. Narrow in practice but a correctness hazard.
**Fix:** require the backslash to be at column-end immediately followed by `\n` (e.g. `src.slice(startOffset-1, startOffset+1) === '\\\n'`) rather than either-or with a nearby-match.

### 9. `autosaveDelay` initial capture may lock in `undefined`
**File:** `ui/src/components/editors/milkdown/MilkdownEditor.tsx:117`
`useRef(autosaveDelay).current` captures the prop at first render. If callers pass `autosaveDelay` lazily (e.g. after an async config load), the plugins array is memoized with the stale `undefined` and the comment explicitly says later changes won't recreate the editor. Not a bug if the prop is always eager, but surprising.
**Fix:** document the constraint on the prop (currently only commented inline), or accept the latest via a ref-read inside the autosave plugin.

### 10. `ImageResolverView` does not re-render when `project`/`session` context changes for a mounted node
**File:** `ui/src/components/editors/milkdown/plugins/imageResolver.tsx:11-35`
`useProjectSession()` is a context consumer, so React will re-render on context change. However the underlying ProseMirror node view is created once by `nodeViewFactory({ ... stopEvent: () => true })` and the component re-reads `node.attrs.src`, which won't change on context shifts. Re-rendering on context is fine for the resolved URL, so this is likely OK — flagging only because `stopEvent: () => true` also stops selection clicks; if a user expects to click an image to position the cursor, it won't work (legacy parity risk, not a crash).

## Not a bug / verified OK

- `MilkdownEditor.tsx` `setRefs` bridges forwarded refs correctly for both callback and object refs.
- `headingCollapse.ts` `doc.forEach` stop logic with `started = false` is correct (iteration continues but does nothing after stop; outer loop handles next heading).
- `rawDetails.ts` nesting depth tracking in `processChildren` correctly pairs nested `<details>` via `depth` increments.
- `decoration.ts` empty-range skip (`resolved.from === resolved.to`) prevents PM "inline decoration range must be non-empty" errors.
- `telemetry.ts` sink fallback and try/catch around sink invocation are safe.
- `document-metadata.ts` `validateDocumentMetadata` drops malformed annotations without throwing.
