# Milkdown vs Lexical — Concrete Comparison for mermaid-collab

## Verdict

**Stay on Milkdown.** Lexical is a better React-native engine in the abstract, but switching it in now would require us to *rebuild or discard* the three deepest investments we have made in this editor: the byte-exact markdown round-trip fidelity stack (`serializerConfig.ts`, `rawPositions.ts` — ~550 lines of mdast/PM plumbing), the position-based heading-collapse plugin bridging PM decorations to a React context, and the remark-level `<details>` transformer. All three are carried by ProseMirror / remark primitives that have no direct counterpart in Lexical, and Lexical's `@lexical/markdown` is explicitly convention-based (lossy), not position-preserving. The only thing we meaningfully gain is cleaner React ergonomics for NodeViews, and that is not worth weeks of migration plus a regression surface that will definitely break fixtures.

---

## Feature-by-feature table

| Feature we use | Milkdown today | Lexical equivalent | Porting cost |
|---|---|---|---|
| WYSIWYG core | `commonmark` + `gfm` presets, PM schema (`MilkdownEditor.tsx:187-189`) | `LexicalComposer` + `RichTextPlugin` + `ListPlugin` + `CheckListPlugin` | ~1 day wire-up |
| Markdown import | `@milkdown/transformer` via remark, with `rawPositionsPlugin` preprocessor (`plugins/rawPositions.ts:17-84`) | `@lexical/markdown` `$convertFromMarkdownString` — convention-based, not position-aware | **Architectural mismatch** — see Fidelity section |
| Markdown export | `remark-stringify` with custom `handlers.break`, `join`, `bullet`, `listItemIndent` options (`serializerConfig.ts:10-83`) | `$convertToMarkdownString` — fixed set of transformers, no `join`-style hook | **Architectural mismatch** — 1-2 weeks to reimplement, and some cases are not expressible |
| Hard break style preservation (`  \n` vs `\\\n` vs `<br>\n`) | `hardBreakStyle` node schema carrying `style` attr through parse↔serialize (`serializerConfig.ts:404-457`) | Would require custom `TextNode` subclass + custom markdown transformer; no mdast `data.style` plumbing | 3-5 days, partial fidelity at best |
| Bullet marker preservation (`-`/`*`/`+`), ordered marker (`.`/`)`) | `bulletListMarker`, `orderedListMarker` attrs on PM nodes (`serializerConfig.ts:149-264`) | Lexical `ListNode` has `listType` (bullet/number/check), no marker char attr; would need subclass | 2-3 days per list type |
| Blank-line count between blocks | `rawTrailing` attr + custom `join` fn counts newlines in source slice (`serializerConfig.ts:68-80`, `rawPositions.ts:25-40`) | No hook — `@lexical/markdown` emits canonical spacing only | **Not achievable without rewriting the markdown transformer** |
| Text escape post-processing (`\*` → `*` outside code) | `unescapeBenign` text handler (`serializerConfig.ts:18-46`) | Would hook the post-serializer string; straightforward | 0.5 day |
| Heading collapse (expand/fold) | PM `Plugin` + `Decoration.node('section-collapsed')` + React context bridge (`plugins/headingCollapse.ts:70-193`) | No built-in; DecoratorNode or `NodeTransform` + CSS-class-via-`mutation` listener | **3-5 days** — see dedicated section below |
| DiagramEmbed custom block | `$nodeSchema` + remark plugin + `$view` NodeView (`plugins/diagramEmbed.ts`, `MilkdownEditor.tsx:139-145`) | `DecoratorNode` subclass — cleaner ergonomics actually | 1-2 days (simpler than today) |
| `<details>` → collapsible node | `rawDetailsRemarkPlugin` pairs raw HTML at the mdast level, `detailsNode` schema + `DetailsView` (`plugins/rawDetails.ts:17-173`) | Custom importer scanning raw HTML blocks + `DecoratorNode`; no remark transformer phase | 3-4 days; the pairing logic has to be reimplemented against Lexical's linear import stream |
| Image URL rewriting | `imageResolverView` overrides `imageSchema` NodeView (`plugins/imageResolver.tsx:11-41`) | `ImageNode` subclass with custom `createDOM` / DecoratorNode | 1 day |
| Annotations (inline highlight) | PM `Plugin` with `DecorationSet.inline`, position anchors (`plugins/annotations/decoration.ts:9-85`) | Lexical `NodeTransform` + `MarkNode` (from `@lexical/mark`) or custom `Decorator` — Lexical has no decoration layer equivalent, you must mutate nodes | 3-5 days + anchor system redesign |
| Autosave / onChange / onPersist / onFlush | `markdownUpdated` listener + debounced persist + `onFlushRef` imperative flush (`plugins/autosave.ts:62-99`) | `registerUpdateListener` + `editor.read(() => $convertToMarkdownString())` — equivalent | 0.5 day |
| History (undo/redo) | `@milkdown/plugin-history` | `HistoryPlugin` — equivalent | trivial |
| Clipboard | `@milkdown/plugin-clipboard` | `ClipboardPlugin` from `@lexical/clipboard` — equivalent | trivial |
| Code block syntax highlighting | `codeBlockPrismPlugin` (Prism-based NodeView) | `CodeHighlightPlugin` (Prism-based, built-in) | 0.5 day, likely a net simplification |
| Task lists / GFM tables | `@milkdown/preset-gfm` | `CheckListPlugin` + `TablePlugin` from `@lexical/react` | 1 day |
| Telemetry hooks | `emitTelemetry` around listener + init (`MilkdownEditor.tsx:237-242,316-327`) | Drop-in equivalent in update listener | trivial |
| Collaboration (future) | `y-prosemirror` | `@lexical/yjs` — comparable, Lexical's arguably more polished | wash |
| IME / a11y | ProseMirror is solid | Lexical is notably better (Meta uses it in FB/Instagram composers) | Lexical **wins** |

**Estimated total migration cost: 4-6 weeks** of focused work, most of it rebuilding fidelity (which may only land at 80-90% parity), plus fixture regression triage.

---

## The heading-collapse story

This is the user's primary concern. Here is exactly how it works today and what the Lexical version looks like.

### How it works today in Milkdown / ProseMirror

The implementation is in `ui/src/components/editors/milkdown/plugins/headingCollapse.ts` and threads through three layers:

1. **React context of truth** (`CollapsibleSection.tsx:131-216`): `CollapsibleSectionsProvider` owns two sets — `allSections` (registered) and `expandedSections` (open). It exposes `toggleSection`, `expandAll`, `collapseAll`, `registerSection`.

2. **A module-level bridge** (`headingCollapse.ts:44-61`): a `collapseStateRef` object with `{expanded, knownSections, allSections, version}`. This is the only way PM and React can share state without tying PM plugin-state to React render cycles.

3. **A heading NodeView** (`headingCollapse.ts:198-261`): replaces the default heading rendering with `<h1><button>chevron</button><span ref=contentRef/></h1>`. The chevron's click handler calls `context.toggleSection(sectionId)`. `sectionId = heading-${pos}` — *derived from the PM doc position* (`headingCollapse.ts:40-42`).

4. **A PM plugin** (`headingCollapse.ts:161-188`) that on `docChanged` or on a `BUMP_META` meta:
   - walks `doc.descendants` to enumerate headings with their level + pos (`buildDecorations:70-89`)
   - for each heading known-to-context AND not-expanded, walks following top-level siblings until a heading of level ≤ current is encountered, and adds `Decoration.node(from, to, {class: 'section-collapsed'})` to each (`buildDecorations:117-153`)
   - CSS `.section-collapsed { display: none }` hides them.

5. **A bridge hook** (`useHeadingCollapseBridge:271-301`): effect watches `context.expandedSections` + `context.allSections`, updates the module ref, bumps `version`, and dispatches a PM transaction with `setMeta(BUMP_META)` to force the plugin to rebuild its DecorationSet.

Key subtlety: because section IDs are position-based, every keystroke changes IDs. The plugin defends against auto-collapsing by defaulting unknown-IDs to *expanded* (`headingCollapse.ts:117-122`). The React effect re-registers them asynchronously; during that lag, the "unknown defaults to expanded" rule keeps things stable.

Also subtle: the plugin also stamps `section-level-N` classes on every top-level block (`buildDecorations:93-106`) to let CSS indent sections visually.

### What it would look like in Lexical

Lexical is a *flat, normalized* node tree with no concept of PM decorations. There are three plausible implementations, all worse than what we have:

**Option A — DecoratorNode heading.** Subclass `HeadingNode` to render a chevron. Collapse is then a pure CSS concern: tag the node with a `collapsed` state and use sibling CSS selectors, but CSS sibling selectors *can't express "until the next h≤N"* — they can only match next-sibling. So pure CSS fails for anything but h1 hiding an h2 range. Rejected.

**Option B — NodeTransform that mutates siblings.** Register a `registerNodeTransform(HeadingNode, node => …)` that on each update walks the block-level children of root, decides which should be hidden, and either (a) adds a `data-collapsed` class via `node.setFormat`/custom attribute — but Lexical nodes *don't have freeform attributes* by default, so you'd subclass every block type, or (b) replace them with a wrapper `CollapsedBlockNode` on collapse and unwrap on expand — mutates the document and *dirties the undo stack every time you fold*. Rejected for UX.

**Option C — View-layer class marker via `registerMutationListener` + DOM direct manipulation.** Register a mutation listener that after each update traverses the root node's children, computes the collapsed ranges (same algorithm as our PM plugin), and directly toggles CSS classes on the rendered DOM elements by looking them up through `editor.getElementByKey(nodeKey)`. This is the closest to our current approach and is what we'd actually build. It requires:
- A custom `HeadingNode` subclass with `createDOM` rendering the chevron (Lexical needs `$createHeadingNode` override to use it)
- The same module-level bridge ref we already have
- A mutation/update listener that runs the level-walk and calls `element.classList.toggle('section-collapsed', …)`
- A separate React context, same as today

Porting cost: **3-5 days**. The algorithm transfers; the scaffolding does not. And direct-DOM class manipulation in Lexical is off the happy path — it works but sidesteps Lexical's reconciler, meaning the next update can overwrite your classes unless you re-run on every `registerUpdateListener` tick.

**Verdict on collapse specifically:** it ports, but you lose the clean "decorations are derived state, the doc is untouched" property that ProseMirror decorations give us. In Lexical, you either mutate the doc (ugly) or bypass the reconciler (fragile). Neither is as good as what we have.

---

## Markdown fidelity risk

This is the decisive factor. We invested heavily in byte-exact round-trip:

- `rawPositions.ts` stamps `data.rawTrailing` (the literal whitespace between blocks), `data.style` (break style), and `data.marker` (bullet/ordered marker char) onto the mdast tree *during parse* by slicing the source string via position offsets.
- `fidelityPlugins` (serializerConfig.ts:459-468) carry those fields onto PM node attrs and back to mdast on serialize.
- The `join` function in `remarkStringifyOptionsCtx` (serializerConfig.ts:68-80) reads `rawTrailing` to emit the exact number of blank lines between blocks.

**Lexical has no equivalent.** `@lexical/markdown` uses a fixed set of `TRANSFORMERS` (ElementTransformer, TextFormatTransformer, etc.) that operate on node trees without access to the original source offsets. You can write custom transformers, but:

1. There is no `join` hook between blocks — export always emits one blank line between block-level nodes.
2. There is no "remark mdast" phase you can intercept — it's a direct string ↔ Lexical node mapping.
3. Position-based source slicing would require running a separate parser (remark) alongside Lexical purely to enrich attrs, then wiring those attrs through custom node classes — effectively rebuilding half of `rawPositions.ts` outside the editor.

**Concrete user impact of losing fidelity:**
- Every user-authored file, on first edit, would get canonicalized: `*` bullets become `-`, `_em_` becomes `*em*` (or vice versa depending on our choice), `<br>` hard breaks become `  \n`, custom blank-line spacing collapses to single blanks.
- Git diffs for documents would blow up on the first save after migration.
- Anyone hand-editing markdown alongside the WYSIWYG editor loses their formatting choices every round-trip.

For a tool that advertises itself as editing the *actual markdown files* in a collab/git workflow, this is close to a dealbreaker.

---

## Things that get BETTER with Lexical (the honest side)

Not everything is worse. Real wins:

1. **NodeView ergonomics.** Our DiagramEmbedViewBridge has a comment explaining it can't read React context because `@prosemirror-adapter/react` mounts NodeViews in detached React roots (`MilkdownEditor.tsx:94-100`). Lexical DecoratorNodes render in the *same React tree* as the editor — context just works. We'd delete the `useProjectStore`/`useSessionStore` workaround.
2. **IME / composition / a11y.** Lexical is battle-tested on FB/IG web composers; ProseMirror's IME handling is good but famously fiddly. Mobile input edge cases would improve.
3. **Simpler state model.** Lexical's flat key-indexed tree with immutable updates is easier to reason about than PM's transactions + plugin states + decorations. Debugging state bugs is faster.
4. **Smaller bundle.** Rough order: Lexical core is ~30KB gz vs PM + Milkdown presets at ~90KB+. Modest but real.
5. **Update listeners are dead simple.** `editor.registerUpdateListener` vs wiring `listenerCtx` via a Milkdown plugin is cleaner.
6. **Collaboration via `@lexical/yjs` is arguably more polished** than `y-prosemirror`, though both work.
7. **No NodeView ↔ React lifecycle hazards.** We have queueMicrotask workarounds (`headingCollapse.ts:286`, `MilkdownEditor.tsx:338`) to avoid "flushSync called inside a lifecycle method" warnings from `@prosemirror-adapter/react`. Those disappear.

These are real but not worth the migration unless we were starting fresh.

---

## Migration plan sketch (if we ever do it)

Not recommending, but in case:

**Wave 0 — Parity fixture freeze.** Lock down all current round-trip fixtures. Build a parity test harness: for each fixture, Milkdown-import → markdown-out must equal Lexical-import → markdown-out. (Expect 20-40% fixture failures on day one; that's the fidelity tax.)

**Wave 1 — Core editor (1 week).** Wire LexicalComposer, RichTextPlugin, ListPlugin, CheckListPlugin, HistoryPlugin, ClipboardPlugin, CodeHighlightPlugin. Autosave via `registerUpdateListener`.

**Wave 2 — Custom nodes (1-2 weeks).** DiagramEmbed as DecoratorNode (easier than today). Details as DecoratorNode with custom importer. Image as subclass with URL resolver. Custom HeadingNode with chevron.

**Wave 3 — Heading collapse (3-5 days).** Update-listener-driven class toggling + React context bridge, as described above.

**Wave 4 — Annotations (3-5 days).** Rebuild anchor resolution against Lexical node keys. Use `MarkNode` or custom NodeTransform.

**Wave 5 — Fidelity (2-3 weeks, partial).** Custom markdown transformers for bullet markers, break styles, `<details>`, diagramEmbed. Accept loss of blank-line count preservation unless we bolt on a remark pre-processor that enriches attrs before Lexical import — about 1 week extra.

**Wave 6 — Fixture triage + user data migration note (1 week).** Document which fidelity guarantees dropped. Add a one-time-canonicalization migration.

**Total: 5-7 weeks.** Realistic, not optimistic.

---

## Files that matter

- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` — plugin stack, React wrapping, NodeView bridges
- `ui/src/components/editors/milkdown/serializerConfig.ts` — 470 lines of fidelity plumbing (**the load-bearing one**)
- `ui/src/components/editors/milkdown/plugins/rawPositions.ts` — mdast position enrichment
- `ui/src/components/editors/milkdown/plugins/headingCollapse.ts` — collapse algorithm + PM plugin + React bridge
- `ui/src/components/editors/milkdown/plugins/rawDetails.ts` — raw HTML `<details>` → mdast transform
- `ui/src/components/editors/milkdown/plugins/annotations/decoration.ts` — PM decoration-based annotation layer
- `ui/src/components/editors/milkdown/plugins/diagramEmbed.ts` — custom block node + remark plugin
- `ui/src/components/editors/milkdown/plugins/imageResolver.tsx` — image URL rewriting NodeView
- `ui/src/components/editors/milkdown/plugins/autosave.ts` — debounced persist + flush
- `ui/src/components/editors/CollapsibleSection.tsx` — React context owner for collapse state
