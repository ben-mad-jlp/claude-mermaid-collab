# Design: Milkdown WYSIWYG Migration for DocumentEditor

Companion to `research-wysiwyg-markdown`. Milkdown is chosen — this doc is the build plan.

## Goals and non-goals

Goals: replace the split-pane (CodeMirror source + rendered preview) in `DocumentEditor.tsx` with an inline WYSIWYG markdown surface; preserve the existing 300/500ms debounced persistence through `updateDocument`; preserve `{{diagram:id}}` / `{{design:id}}` embeds as first-class editable blocks; preserve annotation workflows; be shippable behind a feature flag with zero-risk fallback to the existing editor.

Non-goals: collaborative editing (Yjs), outline / minimap parity on day one, click-to-source (obsolete in unified view), touch-optimised table editing, replacing `CodeMirrorWrapper` in `CodeEditor` / `SnippetEditor`.

## Architecture

### Core vs Crepe

Use **Milkdown Core** (`@milkdown/core` + `@milkdown/react` + presets), not **Crepe**. Rationale:

- Crepe bundles Tailwind-conflicting styles and a slash-command/block-handle UX that we'd fight for our own header/annotation toolbar.
- Core gives us explicit plugin registration — we need to plug our custom `diagramEmbed` node in between the commonmark parser and the serializer, which Crepe obscures.
- Round-trip fidelity control is harder to tune with Crepe because it ships an opinionated schema (including hardBreak rewrites and list-marker normalization).

Trade-off: we reimplement a few Crepe niceties (slash menu, inline toolbar on selection) ourselves. Phase 1 ships without them; Phase 3 adds a thin toolbar.

### Package set

```
@milkdown/core
@milkdown/react
@milkdown/preset-commonmark
@milkdown/preset-gfm
@milkdown/plugin-listener        // onUpdate → autosave
@milkdown/plugin-history         // ctrl-z
@milkdown/plugin-clipboard       // paste
@milkdown/theme-nord             // or bring our own tokens
@milkdown/utils                  // $node, $nodeSchema helpers
prosemirror-view                 // for decorations (annotations)
prosemirror-state                // for plugin state
```

Transitive cost (minified+gzip, rough): ~180–210 KB. Acceptable; lazy-load the component.

### React binding

Wrap with `@milkdown/react`'s `<Milkdown />` inside a memoized `<MilkdownProvider>`. The editor factory function (`useEditor`) composes the plugin list. Content I/O uses:

- Initial load: `defaultValueCtx` at factory time
- Updates: `listenerCtx.markdownUpdated((_, md) => onChange(md))` — fires on every ProseMirror transaction that changes the doc
- Programmatic set (cancel / history revert): `editor.action(ctx => replaceAll(newMarkdown)(ctx))`

### File layout

```
ui/src/components/editors/
  DocumentEditor.tsx           (becomes thin feature-flag router)
  DocumentEditor.legacy.tsx    (current 540-line implementation, renamed)
  DocumentEditor.wysiwyg.tsx   (new Milkdown-backed editor)
  milkdown/
    MilkdownEditor.tsx         (the <Milkdown/> host + useEditor factory)
    plugins/
      diagramEmbed.ts          (node schema + parser + serializer)
      diagramEmbedView.tsx     (React nodeView rendering the iframe)
      annotations.ts           (PM plugin: state field + decorations)
      autosave.ts              (listener → debounce → updateDocument)
    serializerConfig.ts        (list-marker + emphasis + whitespace overrides)
ui/src/lib/
  remarkDiagramEmbeds.ts       (kept — still used by MarkdownPreview / CollapsibleMarkdown)
  milkdownEmbedBridge.ts       (new — shared regex constants reused by both paths)
ui/src/stores/
  annotationStore.ts           (new sidecar store — see Annotation strategy)
```

## File-by-file change plan

| File | Action | One-liner |
|---|---|---|
| `ui/package.json` | modify | Add 7 Milkdown deps + `prosemirror-view/state` peers |
| `ui/src/components/editors/DocumentEditor.tsx` | rewrite | Feature-flag router: reads flag, delegates to legacy or wysiwyg |
| `ui/src/components/editors/DocumentEditor.legacy.tsx` | new (copy) | Verbatim copy of today's implementation |
| `ui/src/components/editors/DocumentEditor.wysiwyg.tsx` | new | Header / save buttons / history modal preserved; body hosts `MilkdownEditor` |
| `ui/src/components/editors/milkdown/MilkdownEditor.tsx` | new | `useEditor` factory, plugin composition, theme binding |
| `ui/src/components/editors/milkdown/plugins/diagramEmbed.ts` | new | `$nodeSchema` defining `diagramEmbed` block; parser matches `{{(diagram|design):id}}`; serializer emits the exact source |
| `ui/src/components/editors/milkdown/plugins/diagramEmbedView.tsx` | new | React node view rendering `<iframe src="/api/render/:id?...">` reusing `MarkdownPreview.resolveImageSrc` logic |
| `ui/src/components/editors/milkdown/plugins/annotations.ts` | new | PM plugin driving decorations from `annotationStore` |
| `ui/src/components/editors/milkdown/plugins/autosave.ts` | new | Wires listener → 500ms debounce → `updateDocument` |
| `ui/src/components/editors/milkdown/serializerConfig.ts` | new | Custom `toMarkdown` overrides for list/emphasis/hardBreak fidelity |
| `ui/src/components/editors/AnnotationToolbar.tsx` | modify | Add `variant: 'codemirror' \| 'prosemirror'`; new path calls store actions instead of `view.dispatch` |
| `ui/src/stores/annotationStore.ts` | new | Zustand slice: `{ docId → Annotation[] }`, persisted to `.claude-mermaid/annotations.json` via a new API |
| `ui/src/lib/remarkDiagramEmbeds.ts` | keep | Still used by `MarkdownPreview` / `CollapsibleMarkdown`; extract regex to shared constant |
| `ui/src/lib/milkdownEmbedBridge.ts` | new | Shared `EMBED_RE = /\{\{(diagram\|design):([^}]+)\}\}/` used by remark plugin, Milkdown parser, and sidecar migration |
| `ui/src/hooks/useSyncScroll.ts` | keep | Unused by wysiwyg path — legacy-only |
| `ui/src/components/editors/Minimap.tsx` | keep | Legacy-only for phase 1; revisit in phase 3 |
| `ui/src/components/editors/MarkdownPreview.tsx` | keep | Still used by legacy editor, history diff modal, proposed-edit review, collapsible markdown |
| `ui/src/components/editors/__tests__/DocumentEditor.test.tsx` | split | Keep, gated to legacy path |
| `ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.test.tsx` | new | New test surface (see Test strategy) |
| `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts` | new | Golden-master markdown round-trip corpus |
| `ui/src/config/featureFlags.ts` | modify (or new) | Add `wysiwygDocumentEditor` flag, default `false` |

## Embed custom node (`{{diagram:id}}` → Milkdown node)

The current `remarkDiagramEmbeds.ts` converts `{{diagram:id}}` text into an `image` node with URL `@diagram/id`, then `MarkdownPreview.resolveImageSrc` rewrites that to `/api/render/:id?project=...&session=...`. For Milkdown we want a dedicated block node so users can click it, select it, delete it cleanly, and we can render a live iframe.

### Node schema (`plugins/diagramEmbed.ts`)

```ts
// sketch, not production code
$nodeSchema('diagramEmbed', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: { kind: { default: 'diagram' }, refId: { default: '' } },
  parseDOM: [{ tag: 'div[data-diagram-embed]', getAttrs: ... }],
  toDOM: (node) => ['div', { 'data-diagram-embed': '', 'data-kind': node.attrs.kind, 'data-ref': node.attrs.refId }],
  parseMarkdown: {
    match: (node) => node.type === 'diagramEmbed',
    runner: (state, node, type) =>
      state.addNode(type, { kind: node.kind, refId: node.refId }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'diagramEmbed',
    runner: (state, node) => {
      state.addNode('text', undefined, `{{${node.attrs.kind}:${node.attrs.refId}}}`);
      state.closeBlock(node);
    },
  },
}))
```

### Remark parser

Register a remark plugin in the Milkdown remark pipeline that mirrors today's `remarkDiagramEmbeds` but produces `{ type: 'diagramEmbed', kind, refId }` MDAST nodes instead of images. (Milkdown accepts custom remark plugins via its `remarkCtx` — we do not need to reuse the existing file verbatim; we share the regex via `milkdownEmbedBridge.ts`.)

### React node view (`plugins/diagramEmbedView.tsx`)

Renders a bordered card with:
- title row: `diagram:<id>` + edit-in-artifact link
- body: `<iframe src={resolveEmbedSrc(kind, refId, project, session, theme)} />` at fixed aspect ratio
- click → selects the PM node; Delete / Backspace removes it
- dbl-click → opens the source artifact in its own editor (routes to `/diagrams/:id` or `/designs/:id`)

URL resolution is extracted from `MarkdownPreview.resolveImageSrc` into a small utility so both renderers stay in sync.

### Serializer discipline

Node serializer writes a single line `{{kind:id}}` surrounded by block boundaries. **Critical**: verify the serializer does NOT wrap it in a paragraph (causing `\n{{x:y}}\n\n` drift). Add a round-trip test for this exact case as part of Phase 0.

## Annotation strategy — **decision: sidecar store**

**Recommendation: move annotations out of the markdown source into a sidecar store keyed by a position anchor.** One-line rationale: the current HTML-comment-in-source format is fragile even today (a naive edit across a `<!-- comment-start -->` boundary silently breaks pairing), and WYSIWYG makes the problem worse because ProseMirror doesn't preserve arbitrary inline HTML comments round-trip. A sidecar removes the round-trip constraint entirely and lets us render annotations as PM decorations without touching the markdown.

### Sidecar shape

```ts
type Annotation = {
  id: string;           // uuid
  docId: string;
  type: 'comment' | 'propose' | 'approve' | 'reject';
  text: string;
  reason?: string;
  anchor: {
    // Position-resilient anchor. Primary: textual anchor (first ~40 chars of selected text)
    // Secondary: block-index hint for disambiguation.
    snippet: string;
    blockIndex: number;
    startOffset: number;
    endOffset: number;
  };
  createdAt: number;
  resolved?: boolean;
};
```

Anchors resolve at render time with a small PM plugin that walks the doc looking for the snippet; if found, emits an `inline-deco` span; if not found (drift), the annotation becomes "orphaned" and is shown in a sidebar list. This matches Hypothesis / Google Docs suggestion anchoring and is robust to edits that don't touch the anchored text.

### New persistence surface

Add `/api/annotations/:docId` GET/PUT (mirrors existing document API shape) backed by a JSON file at `.claude-mermaid/annotations/<docId>.json`. Zustand store hydrates on mount, debounced writes on change.

### Migration path for existing annotations on disk

Existing documents contain `<!-- comment-start: ... -->` / `<!-- status: approved -->` markers in their markdown. On first open of a document with the wysiwyg flag enabled:

1. Run a one-shot migrator (`migrateInlineAnnotations(md) → { cleanedMd, annotations[] }`) that:
   - Extracts each pair (or standalone marker) using the same regexes `clearAnnotations` uses today
   - For each extraction, computes an anchor from the surrounding 40 chars
   - Emits `Annotation` records and a cleaned markdown string
2. Writes annotations to the sidecar, writes cleaned markdown back via `updateDocument`
3. Marks the document with `meta.annotationsMigrated = true` so migration is idempotent

This is safe because the migration is reversible (we can re-stamp markers back into the source if we disable the flag) and runs lazily per-doc, not as a big-bang batch.

### Alternative considered: ProseMirror decorations only, no sidecar

Keep annotations as HTML comments in markdown, round-trip them through a custom PM mark that serializes to `<!-- comment-start: … -->`. **Rejected** because (a) HTML comments don't have a clean home in the CommonMark AST — they'd need a raw HTML mark, which gfm's sanitizer strips, (b) the PM serializer would need bespoke overrides to emit un-paired start/end tokens, (c) a single bad edit inside the span still silently breaks the pair, and (d) we'd be carrying the current fragility forward instead of fixing it.

## Round-trip fidelity hardening

Known ProseMirror / Milkdown drift points and mitigations:

| Issue | Default Milkdown behavior | Mitigation |
|---|---|---|
| Emphasis marker choice | Normalises `_x_` → `*x*` | Override `toMarkdown` marks for emphasis/strong to emit the marker found at parse time (track in a `data-marker` attr) |
| List bullet style | Normalises `*` → `-` | Same pattern: preserve original bullet via node attr; custom `bulletList` toMarkdown |
| List indentation | 2-space default | Configure `bulletListIndent: 4` if repo's prettier does 4-space |
| Hard breaks | `<br>` vs trailing-two-spaces | Track on parse, preserve on serialize |
| Fenced code info string | Preserved | Verify — add golden test |
| Trailing whitespace | Stripped on paragraph close | Acceptable; note in release notes |
| Blank lines between blocks | Normalised to single | Acceptable |
| Heading style (ATX vs setext) | Forces ATX | Acceptable, but add lint rule so no new setext headings |
| Image vs link angle brackets | Auto-linked | Configure serializer for URL escape style |
| GFM tables | Column alignment preserved; column widths lost | Acceptable |
| Diagram embed node | N/A — our node | Dedicated test in round-trip suite |

### Golden-master round-trip test

New file `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts`:

1. Corpus: 10 real markdown files (copy five from this repo's existing session docs, plus synthetic fixtures for each drift point).
2. For each file: `parse(md) → doc → serialize(doc) → md'`. Assert `md === md'` after normalising only known-acceptable differences (trailing newlines).
3. Fixture-driven: adding a new `.md` file to `__fixtures__/roundtrip/` auto-includes it.
4. Run in CI as a blocking check.

## Autosave integration

The listener plugin exposes `markdownUpdated(ctx)` which fires on every doc transaction. Wire it through a 500ms debounce in `plugins/autosave.ts`:

```ts
// sketch
const debounced = debounce((md: string) => {
  updateDocument(docId, { content: md, lastModified: Date.now() });
  onChange?.(md);
}, 500);

listenerCtx.markdownUpdated((_, md, prevMd) => {
  if (md === prevMd) return;
  setHasChanges(true);
  debounced(md);
});
```

Two behaviors to preserve from today:
- `onChange` callback still fires on every keystroke (not debounced) — keep the same pattern: call `onChange` immediately, debounce only the store write.
- Ctrl+S flushes the debounce and calls `updateDocument` synchronously. Expose `debounced.flush()` via a ref so the existing `handleSave` wrapper can call it.

Debounce delay stays configurable through the existing `debounceDelay` prop. Note: current code uses 300ms in the prop default but the problem statement says 500ms — clarify in Open Questions.

## Test strategy

### Existing 597-line suite — triage

Of the 30+ existing tests:

- **Keep verbatim, gate to legacy**: split-pane rendering, `codemirror-editor` testid assertions, sync-scroll, minimap — move into `DocumentEditor.legacy.test.tsx` that imports the legacy file directly.
- **Adapt to wysiwyg**: save/cancel buttons, Ctrl+S / Escape keyboard shortcuts, unsaved-changes indicator, document switching, debounced `updateDocument` call, error handling, `className` passthrough, `showButtons=false` — these are editor-agnostic and just need a new testid for the editor surface. About 18 tests, ~3h of work.
- **Rewrite**: content-edit tests (use PM `view.dispatch` via a helper, not `fireEvent.change` on a textarea), annotation toolbar (calls store actions, not `view.dispatch`). About 6 tests.
- **Delete**: click-to-source, sync-scroll toggle.

### New tests required

1. **Round-trip golden master** (`milkdown/__tests__/roundTrip.test.ts`) — described above.
2. **Embed node lifecycle** (`milkdown/plugins/__tests__/diagramEmbed.test.ts`) — parse `{{diagram:foo}}` → node, serialize → same, backspace removes cleanly, paste preserves.
3. **Annotation anchoring** (`stores/__tests__/annotationStore.test.ts`) — anchor resolves, drift detection, orphan state.
4. **Migration** (`lib/__tests__/migrateInlineAnnotations.test.ts`) — converts existing comment markers to sidecar records without losing data.
5. **Autosave debounce** (`milkdown/plugins/__tests__/autosave.test.ts`) — 500ms debounce, Ctrl+S flush, onChange immediate.
6. **Feature-flag routing** (`DocumentEditor.test.tsx`) — flag off → legacy, flag on → wysiwyg.

### Testing ProseMirror is painful

jsdom is fine for PM; `@milkdown/react` renders in it without trouble. Key helper: a `renderMilkdown(md)` test util that awaits the first render, returns `{ getMarkdown(), dispatch(tr), findEmbed(id) }`. Build this first — it unblocks the rest of the suite.

## Phased delivery

### Phase 0 — Spike / go-no-go gate (1 day)

**Deliverable**: a branch with:
- Milkdown deps installed
- A throwaway `milkdown-spike/` route that renders a `<MilkdownEditor>` with our 10-doc corpus
- The round-trip harness running in CI (initially as `test.skip`)
- The `diagramEmbed` node parsing + serialising `{{diagram:foo}}` with no drift
- A paper prototype of anchor-based annotation: pick one document, drop one annotation via dev console, see it highlight, edit around it, see it still highlight

**Go criteria** (all three must pass):
1. Round-trip corpus: ≤ 2 of 10 docs drift, and every drift is in the "acceptable" column above
2. Embed node: `{{diagram:foo}}` round-trips byte-exact in isolation
3. Annotation anchor resolves after a non-destructive edit

**No-go fallback**: if corpus drift is unacceptable, pause migration and report back. Sunk cost: 1 day.

### Phase 1 — Ship editor behind flag (3–4 days)

- `DocumentEditor.wysiwyg.tsx` complete with header / save / cancel / Ctrl+S / unsaved-indicator / error banner / history modal preservation
- Autosave plugin wired to 500ms debounce → `updateDocument`
- Embed node with node view rendering live iframe
- Feature flag `wysiwygDocumentEditor` defaults `false`; legacy renders by default
- New wysiwyg test file (~15 tests); legacy test file preserved
- No annotations yet — toolbar hidden when flag on

Shippable: internal dogfooding via `localStorage.setItem('ff.wysiwygDocumentEditor', '1')`.

### Phase 2 — Annotations + migration (3–4 days)

- `annotationStore` + `/api/annotations/:docId` endpoint
- PM annotation plugin (decorations + anchor resolution + orphan handling)
- `AnnotationToolbar` variant for prosemirror; writes to store instead of source
- `migrateInlineAnnotations` runs on first doc open when flag is on
- Annotation tests + migration tests green
- Sidebar lists orphans; user can drag-to-reattach (stretch) or delete

Shippable: annotation parity achieved; flag still defaults off.

### Phase 3 — Polish + rollout readiness (2–3 days)

- Paste sanitizer (Google Docs / Word cleanup)
- Inline toolbar on selection (bold / italic / link / heading dropdown)
- Slash-menu for embed insertion: `/diagram` `/design`
- Mobile caret / IME sweep
- Diff-view integration: serialize current PM doc to markdown and feed existing diff viewer (no longer needs CodeMirror)
- Performance pass (memoize plugin list, virtualise large docs > 50k chars)
- Migration guide doc

Shippable: flag default flips to `true` in staging; legacy still available behind `wysiwygDocumentEditor: false`.

### Phase 4 (optional) — Delete legacy (0.5 day, 30+ days after phase 3)

After a cooling-off period with no fallback usage spikes, delete `DocumentEditor.legacy.tsx` and the gated tests. `CodeMirrorWrapper` stays (still used by code/snippet editors).

Estimate total: **10–12 dev-days** (fits the 10–14 day envelope).

## Rollout plan

- Flag name: `wysiwygDocumentEditor` (boolean). Read from `localStorage` in dev, from a config endpoint (`/api/config/flags`) in staging/prod.
- Placement: `DocumentEditor.tsx` becomes a 30-line router:
  ```ts
  const { wysiwygDocumentEditor } = useFeatureFlags();
  return wysiwygDocumentEditor
    ? <DocumentEditorWysiwyg {...props} />
    : <DocumentEditorLegacy {...props} />;
  ```
- Fallback: per-user localStorage override `ff.wysiwygDocumentEditor=0` forces legacy for that user without a deploy.
- Staging verification checklist:
  1. Open each of 10 corpus docs; confirm visual parity
  2. Make a trivial edit; confirm on-disk `git diff` shows only the intended change (round-trip)
  3. Embed a diagram, delete the node, confirm source shows removed `{{diagram:id}}`
  4. Add / edit / resolve an annotation; reload; confirm persistence
  5. Open a pre-migration doc with inline annotations; confirm migration runs and annotations appear as decorations
  6. Ctrl+S saves; Escape is a no-op in wysiwyg mode (or revert — decide in Open Q)
  7. History modal renders historical markdown (unchanged — still uses MarkdownPreview)
  8. Toggle flag off; confirm legacy path still works
- Monitoring: log `editor_variant` + `round_trip_drift_bytes` + `autosave_latency_ms` from client telemetry for 1 week before flipping default.

## Resolved decisions (user input 2026-04-17)

1. **Debounce: 500ms** for the wysiwyg path. Overrides the 300ms legacy default. `debounceDelay` prop on wysiwyg editor defaults to 500.
2. **Escape: no revert.** Drop the Escape-reverts-unsaved-changes binding in wysiwyg mode. With autosave the "unsaved" window is < 500ms; reverting is more surprising than useful. Escape becomes a no-op (or just blurs the editor).
3. **Annotation persistence: new field on the document record** (not a disk sidecar). Rationale: co-located with doc metadata, atomic read/write via the existing `updateDocument` API, automatically included in any backup/export flow, fits the established field pattern (`deprecated`, `pinned`, `blueprint`, `locked`). Halves fsync load per edit vs a separate file, and avoids introducing `/api/annotations/:docId`. Schema: add optional `annotations?: Annotation[]` field to the document record; server persists it inside the document's metadata envelope (not inline in the markdown body). Client still uses a Zustand slice for UI state, but the slice hydrates from / flushes to `document.annotations` rather than a separate endpoint.

## Remaining open questions

1. **Migration reversibility**: once we migrate inline comment markers to the annotations field, do we need a "re-stamp" path for users who disable the flag? Or is the flag one-way-door per-document after migration?
2. **Embed node UX**: should `{{design:id}}` open an inline edit overlay (edit the design from inside the doc) or always route out to the design editor?
3. **Existing `<!-- ... -->` HTML comments that AREN'T annotations** (e.g. genuine author comments): should the migrator leave them alone, or round-trip them through a PM "raw comment" node? Safer default: leave alone.
4. **Crepe reconsideration**: if Phase 0 reveals we're rebuilding a slash menu and block handles anyway, is Crepe worth a second look? Decision deadline: end of Phase 1.
5. **Feature-flag plumbing**: is there an existing flags system in the UI, or do we build a tiny one? (Quick grep suggested no existing system — confirm.)
6. **Telemetry sink**: where do round-trip-drift / autosave-latency metrics go? Is there an existing client logger, or do we wire a new endpoint?
7. **Bundle budget**: +180 KB for Milkdown — acceptable to lazy-load, but confirm the main `DocumentEditor` entry can be code-split (likely yes via `React.lazy`).
4. **Migration reversibility**: once we migrate inline comment markers to sidecar, do we need a "re-stamp" path for users who disable the flag? Or is the flag one-way-door per-document after migration?
5. **Embed node UX**: should `{{design:id}}` open an inline edit overlay (edit the design from inside the doc) or always route out to the design editor?
6. **Existing `<!-- ... -->` HTML comments that AREN'T annotations** (e.g. genuine author comments): should the migrator leave them alone, or round-trip them through a PM "raw comment" node? Safer default: leave alone.
7. **Crepe reconsideration**: if Phase 0 reveals we're rebuilding a slash menu and block handles anyway, is Crepe worth a second look? Decision deadline: end of Phase 1.
8. **Feature-flag plumbing**: is there an existing flags system in the UI, or do we build a tiny one? (Quick grep suggested no existing system — confirm.)
9. **Telemetry sink**: where do round-trip-drift / autosave-latency metrics go? Is there an existing client logger, or do we wire a new endpoint?
10. **Bundle budget**: +180 KB for Milkdown — acceptable to lazy-load, but confirm the main `DocumentEditor` entry can be code-split (likely yes via `React.lazy`).
