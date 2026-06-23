# Blueprint: Milkdown WYSIWYG Migration — Phase 0 + Phase 1

Scope: spike gate (Phase 0) + editor-behind-flag shippable (Phase 1) per `design-milkdown-migration`. Phases 2–3 (annotations, polish, rollout) are deliberately out of scope and will be planned as follow-on blueprints once the Phase 0 go/no-go gate passes.

## Source Artifacts
- `design-milkdown-migration`
- `research-wysiwyg-markdown`

---

## 1. Structure Summary

### Files

#### New
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` — `<Milkdown/>` host + `useEditor` factory composing plugins
- `ui/src/components/editors/milkdown/plugins/diagramEmbed.ts` — `$nodeSchema` for `{{diagram|design:id}}` block node (parser + serializer)
- `ui/src/components/editors/milkdown/plugins/diagramEmbedView.tsx` — React node view rendering live iframe
- `ui/src/components/editors/milkdown/plugins/autosave.ts` — listener → 500ms debounce → `updateDocument`, exposes `flush()`
- `ui/src/components/editors/milkdown/serializerConfig.ts` — `toMarkdown` overrides for emphasis/list-marker/hardBreak fidelity
- `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts` — fixture-driven golden-master round-trip suite
- `ui/src/components/editors/milkdown/plugins/__tests__/diagramEmbed.test.ts` — embed node parse/serialize/lifecycle tests
- `ui/src/components/editors/milkdown/plugins/__tests__/autosave.test.ts` — debounce, flush, onChange immediate tests
- `ui/src/components/editors/milkdown/__fixtures__/roundtrip/*.md` — 10 corpus docs (5 real + 5 synthetic drift cases)
- `ui/src/components/editors/DocumentEditor.legacy.tsx` — verbatim copy of today's `DocumentEditor.tsx`
- `ui/src/components/editors/DocumentEditor.wysiwyg.tsx` — new Milkdown-backed editor with preserved header/save/cancel/history
- `ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.test.tsx` — ~15 tests for wysiwyg surface
- `ui/src/lib/milkdownEmbedBridge.ts` — shared `EMBED_RE` regex + `resolveEmbedSrc` helper
- `ui/src/config/featureFlags.ts` — minimal flag reader (localStorage in dev) with `wysiwygDocumentEditor` default false

#### Modified
- `ui/package.json` — add 7 Milkdown deps + `prosemirror-view/state` peers
- `ui/src/components/editors/DocumentEditor.tsx` — becomes thin feature-flag router (~30 lines)
- `ui/src/components/editors/__tests__/DocumentEditor.test.tsx` — gate existing assertions to legacy path

### Type Definitions

```ts
// featureFlags.ts
export interface FeatureFlags {
  wysiwygDocumentEditor: boolean;
}
export function useFeatureFlags(): FeatureFlags;

// milkdownEmbedBridge.ts
export const EMBED_RE: RegExp;  // /\{\{(diagram|design):([^}]+)\}\}/
export function resolveEmbedSrc(kind: 'diagram' | 'design', refId: string, project: string, session: string, theme?: string): string;

// diagramEmbed.ts node attrs
interface DiagramEmbedAttrs { kind: 'diagram' | 'design'; refId: string; }
```

### Component Interactions

```
DocumentEditor (router)
  ├─ flag off → DocumentEditor.legacy (unchanged)
  └─ flag on  → DocumentEditor.wysiwyg
                 └─ MilkdownEditor
                      ├─ plugins/autosave → updateDocument(debounced)
                      ├─ plugins/diagramEmbed (schema)
                      │    └─ diagramEmbedView (React iframe)
                      └─ serializerConfig (fidelity overrides)
```

---

## 2. Function Blueprints

### `MilkdownEditor({ initialMarkdown, onChange, onFlushRef, docId })`

**Pseudocode:**
1. Compose plugin list: `commonmark`, `gfm`, `history`, `clipboard`, `listener`, `diagramEmbed`, `autosave({ docId, onChange, onFlushRef })`, `serializerConfig`
2. Call `useEditor` with `defaultValueCtx = initialMarkdown`
3. Register plugins in fixed order so `diagramEmbed` resolves before default paragraph fallback
4. Memoize plugin list (recompose only when `docId` changes)
5. Render `<MilkdownProvider><Milkdown /></MilkdownProvider>`

**Error handling:** Swallow editor-init errors into an error boundary at wysiwyg wrapper; fall back to legacy render on crash.
**Edge cases:** Empty initial markdown; markdown containing only an embed block; very large (>50k char) docs — accept slow first render for Phase 1.
**Tests:** unit via `renderMilkdown(md)` helper; integration in wysiwyg editor test.

### `diagramEmbed` plugin (`$nodeSchema`)

**Pseudocode:**
1. Define node `group: 'block'`, `atom: true`, `selectable: true`, `draggable: true`, `attrs: { kind, refId }`
2. `parseDOM`: match `div[data-diagram-embed]`, read kind/ref attrs
3. `toDOM`: emit `div[data-diagram-embed][data-kind][data-ref]`
4. `parseMarkdown.runner`: on AST node `{ type: 'diagramEmbed', kind, refId }` → `state.addNode(type, attrs)`
5. `toMarkdown.runner`: emit exactly `{{${kind}:${refId}}}` text and `closeBlock`, with NO paragraph wrapping

**Also:** register a remark plugin on Milkdown's remark context that uses `EMBED_RE` from `milkdownEmbedBridge.ts` to convert matching text into `diagramEmbed` MDAST nodes before Milkdown's parser walks the tree.

**Error handling:** malformed `{{...}}` falls through as plain text.
**Edge cases:** embed inside a list item; embed mid-paragraph (must break out to its own block); hyphens in refId.
**Tests:** golden round-trip fixture + dedicated embed unit tests.

### `diagramEmbedView` (React node view)

**Pseudocode:**
1. Read `node.attrs.kind`, `node.attrs.refId`; pull project/session from context
2. Render bordered card: title row `${kind}:${refId}` + edit-out link; body `<iframe src={resolveEmbedSrc(...)}>` at fixed 16:9
3. Click → `view.dispatch(setSelection(NodeSelection.create(doc, pos)))`; Delete/Backspace handled by PM default
4. Double-click → `window.open(`/diagrams/${refId}`)` or `/designs/${refId}`

**Error handling:** missing refId → render "Broken embed" placeholder, keep node in doc.
**Tests:** render with mock context, assert iframe src and click-to-select.

### `autosave` plugin

**Pseudocode:**
1. `debounced = debounce(md => updateDocument(docId, { content: md, lastModified: Date.now() }); onChange?.(md);, 500)`
2. On `listenerCtx.markdownUpdated((_, md, prev) => { if (md === prev) return; setHasChanges(true); debounced(md); })`
3. Expose `debounced.flush()` via `onFlushRef` so `handleSave` can force-sync on Ctrl+S
4. Fire `onChange` synchronously on every keystroke; only the `updateDocument` call is debounced

**Error handling:** `updateDocument` rejection surfaces via the editor's existing error banner.
**Edge cases:** rapid doc-id switch must cancel pending debounce; unmount must flush or cancel (flush on unmount to avoid silent data loss).
**Tests:** fake timers, assert 500ms debounce, flush on Ctrl+S, immediate onChange, flush on unmount.

### `serializerConfig`

**Pseudocode:**
1. Override `emphasis.toMarkdown` / `strong.toMarkdown` to read a `data-marker` attr captured at parse time (fallback `*`)
2. Override `bulletList.toMarkdown` to preserve original bullet char (`-`, `*`, `+`) via node attr
3. Override `hardBreak.toMarkdown` to honor `data-style` attr (`br` vs `two-spaces`)
4. Keep fenced code info string verbatim (no-op; verify)

**Tests:** each override covered by a round-trip fixture.

### `milkdownEmbedBridge.resolveEmbedSrc`

**Pseudocode:** build `/api/render/${refId}?kind=${kind}&project=${project}&session=${session}&theme=${theme ?? 'dark'}`. Mirror `MarkdownPreview.resolveImageSrc` parameter order.

### `DocumentEditor` (new router)

**Pseudocode:**
1. `const { wysiwygDocumentEditor } = useFeatureFlags();`
2. `return wysiwygDocumentEditor ? <DocumentEditorWysiwyg {...props} /> : <DocumentEditorLegacy {...props} />;`

**Tests:** flag on renders wysiwyg testid; flag off renders legacy testid.

### `DocumentEditor.wysiwyg`

**Pseudocode:**
1. Preserve existing header: doc name, save/cancel, unsaved indicator, error banner, history modal trigger
2. Body: render `<MilkdownEditor initialMarkdown={doc.content} onChange={handleContentChange} onFlushRef={flushRef} docId={doc.id} />`
3. `handleSave` calls `flushRef.current?.()` then `updateDocument(id, { content, lastModified })`
4. Ctrl+S → `handleSave`; Escape → no-op (per resolved decision)
5. Annotation toolbar hidden when flag on (Phase 2 re-enables)

**Tests:** ~15 tests covering save/cancel, Ctrl+S flushes debounce, Escape is no-op, unsaved indicator, doc switching, `showButtons=false` hides buttons, className passthrough, error banner on updateDocument rejection.

### `featureFlags.useFeatureFlags`

**Pseudocode:** read `localStorage.getItem('ff.wysiwygDocumentEditor')` in dev; parse `"1"` as true. Return `{ wysiwygDocumentEditor: boolean }`. Staging/prod read from `/api/config/flags` (stub endpoint returns `{}` for now — flag stays false).

**Edge cases:** SSR safety (guard `typeof localStorage`); ignore malformed values.
**Tests:** flag true/false/missing.

### `roundTrip.test.ts` harness

**Pseudocode:**
1. `import.meta.glob('./__fixtures__/roundtrip/*.md', { as: 'raw', eager: true })`
2. For each fixture: `md → parseMarkdown → doc → serializeMarkdown → md2`
3. `expect(md2).toBe(md)` — normalize only trailing newlines
4. Fail the suite if drift occurs outside the acceptable list

**Phase 0 go-criterion:** ≤ 2 of 10 fixtures drift and every drift is in the "acceptable" column of the design doc's drift table.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: deps-install
    files: [ui/package.json]
    tests: []
    description: "Add Milkdown packages (@milkdown/core, react, preset-commonmark, preset-gfm, plugin-listener, plugin-history, plugin-clipboard) + prosemirror-view/prosemirror-state peers to ui/package.json. Run install in ui/ to regenerate lock."
    parallel: true
    depends-on: []

  - id: feature-flags
    files: [ui/src/config/featureFlags.ts]
    tests: []
    description: "New minimal feature-flags hook. Export useFeatureFlags() reading localStorage 'ff.wysiwygDocumentEditor' in dev, returning { wysiwygDocumentEditor: boolean } default false. SSR-safe."
    parallel: true
    depends-on: []

  - id: embed-bridge
    files: [ui/src/lib/milkdownEmbedBridge.ts]
    tests: []
    description: "New shared module exporting EMBED_RE regex /\\{\\{(diagram|design):([^}]+)\\}\\}/ and resolveEmbedSrc(kind, refId, project, session, theme) building /api/render path. Mirrors MarkdownPreview.resolveImageSrc."
    parallel: true
    depends-on: []

  - id: legacy-copy
    files: [ui/src/components/editors/DocumentEditor.legacy.tsx]
    tests: []
    description: "Create DocumentEditor.legacy.tsx as a verbatim copy of current DocumentEditor.tsx. Rename the default export component to DocumentEditorLegacy. No behavior change."
    parallel: true
    depends-on: []

  - id: serializer-config
    files: [ui/src/components/editors/milkdown/serializerConfig.ts]
    tests: []
    description: "toMarkdown overrides for emphasis/strong (preserve marker via data-marker attr), bulletList (preserve bullet char), hardBreak (two-spaces vs <br>). Stub data-marker capture at parse time."
    parallel: true
    depends-on: []

  - id: roundtrip-fixtures
    files:
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/01-plain.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/02-lists.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/03-tables.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/04-code-fences.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/05-emphasis.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/06-embed-isolated.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/07-embed-in-list.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/08-nested-lists.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/09-hardbreaks.md
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/10-real-doc.md
    tests: []
    description: "Create 10 corpus fixtures: 5 synthetic (covering each drift point) + 5 copied from real session docs in this project. Plain, lists, GFM tables, fenced code w/ info string, emphasis markers, isolated embed, embed inside list, nested lists, hard breaks, one real doc."
    parallel: true
    depends-on: []

  - id: diagram-embed-node
    files: [ui/src/components/editors/milkdown/plugins/diagramEmbed.ts]
    tests: [ui/src/components/editors/milkdown/plugins/__tests__/diagramEmbed.test.ts]
    description: "$nodeSchema 'diagramEmbed' (block, atom, selectable, draggable, attrs kind+refId). parseDOM/toDOM for div[data-diagram-embed]. parseMarkdown handles AST diagramEmbed nodes. toMarkdown emits {{kind:refId}} with closeBlock and NO paragraph wrap. Register remark plugin using EMBED_RE from embed-bridge."
    parallel: true
    depends-on: [embed-bridge]

  - id: diagram-embed-view
    files: [ui/src/components/editors/milkdown/plugins/diagramEmbedView.tsx]
    tests: []
    description: "React node view: bordered card, title row with kind:refId + edit-out link, body iframe src={resolveEmbedSrc(...)}. Click → NodeSelection, dbl-click → window.open to artifact route. Render 'Broken embed' on missing refId."
    parallel: true
    depends-on: [embed-bridge]

  - id: autosave-plugin
    files: [ui/src/components/editors/milkdown/plugins/autosave.ts]
    tests: [ui/src/components/editors/milkdown/plugins/__tests__/autosave.test.ts]
    description: "Milkdown plugin factory autosave({ docId, onChange, onFlushRef, delay=500 }). Wires listenerCtx.markdownUpdated → debounced updateDocument. onChange fires immediate; only the store write debounces. Expose flush() via onFlushRef. Flush on unmount."
    parallel: true
    depends-on: [deps-install]

  - id: milkdown-editor
    files: [ui/src/components/editors/milkdown/MilkdownEditor.tsx]
    tests: []
    description: "New <MilkdownEditor> host. Compose plugin list (commonmark, gfm, history, clipboard, listener, diagramEmbed, autosave, serializerConfig). useEditor with defaultValueCtx=initialMarkdown. Memoize plugin list on docId. Wrap in <MilkdownProvider>. Export renderMilkdown test helper."
    parallel: false
    depends-on: [deps-install, serializer-config, diagram-embed-node, diagram-embed-view, autosave-plugin]

  - id: roundtrip-harness
    files: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    tests: [ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts]
    description: "Vitest suite using import.meta.glob to load fixtures. For each md: parse→doc→serialize→md2, expect equality modulo trailing newlines. Fail on any drift outside acceptable list. Initially skip via test.skip() if Phase 0 gate not yet passed — leave enabled for Phase 1."
    parallel: true
    depends-on: [milkdown-editor, roundtrip-fixtures]

  - id: wysiwyg-editor
    files: [ui/src/components/editors/DocumentEditor.wysiwyg.tsx]
    tests: [ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.test.tsx]
    description: "New DocumentEditorWysiwyg. Preserves header (doc name, save/cancel, unsaved indicator, error banner, history-modal trigger). Body hosts <MilkdownEditor> with flushRef. handleSave calls flushRef.current() then updateDocument. Ctrl+S→handleSave; Escape→no-op. Hide AnnotationToolbar (Phase 2). showButtons/className/debounceDelay props preserved."
    parallel: false
    depends-on: [milkdown-editor, autosave-plugin]

  - id: document-editor-router
    files: [ui/src/components/editors/DocumentEditor.tsx]
    tests: []
    description: "Rewrite DocumentEditor.tsx as a thin router (~30 lines): useFeatureFlags(); flag on → <DocumentEditorWysiwyg/>, flag off → <DocumentEditorLegacy/>. Pass all props through. Keep the existing default export signature."
    parallel: false
    depends-on: [wysiwyg-editor, legacy-copy, feature-flags]

  - id: legacy-test-gating
    files: [ui/src/components/editors/__tests__/DocumentEditor.test.tsx]
    tests: [ui/src/components/editors/__tests__/DocumentEditor.test.tsx]
    description: "Split existing 597-line test file. Keep legacy-only assertions (split-pane, codemirror-editor testid, sync-scroll, minimap) — import DocumentEditorLegacy directly in these. Remove the 2 obsolete test blocks (click-to-source, sync-scroll toggle). Ensure file still compiles and all remaining tests pass unchanged."
    parallel: false
    depends-on: [document-editor-router]
```

### Execution Waves

**Wave 1 (parallel, no deps):**
- deps-install, feature-flags, embed-bridge, legacy-copy, serializer-config, roundtrip-fixtures

**Wave 2 (depend on Wave 1):**
- diagram-embed-node (embed-bridge)
- diagram-embed-view (embed-bridge)
- autosave-plugin (deps-install)

**Wave 3 (depend on Wave 2):**
- milkdown-editor (deps-install, serializer-config, diagram-embed-node, diagram-embed-view, autosave-plugin)

**Wave 4 (depend on Wave 3):**
- roundtrip-harness (milkdown-editor, roundtrip-fixtures)
- wysiwyg-editor (milkdown-editor, autosave-plugin)

**Wave 5 (depend on Wave 4):**
- document-editor-router (wysiwyg-editor, legacy-copy, feature-flags)

**Wave 6 (depend on Wave 5):**
- legacy-test-gating (document-editor-router)

### Summary
- Total tasks: 14
- Total waves: 6
- Max parallelism: 6 (Wave 1)

---

## Phase 0 Go/No-Go Gate

After Wave 4 completes and before merging Waves 5–6, run the gate:

1. `roundtrip-harness` passes on ≥ 8 of 10 fixtures; any drift falls in the acceptable column (design doc §Round-trip fidelity hardening)
2. `diagramEmbed.test.ts` round-trips `{{diagram:foo}}` byte-exact
3. Manual smoke: open `__fixtures__/roundtrip/10-real-doc.md` in the wysiwyg editor; edit one word; confirm git diff is the one-word change only

**If gate passes:** proceed to Waves 5–6.
**If gate fails:** stop. Do not ship the router change. Report drift details and revisit design.
