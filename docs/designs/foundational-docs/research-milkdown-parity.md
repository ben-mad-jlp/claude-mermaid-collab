# Milkdown Parity Research: Replacing `MarkdownPreview` with `DocumentView`

Goal: make the Milkdown-based `DocumentView` visually and behaviorally indistinguishable from the existing `MarkdownPreview` rendering pipeline (including collapsible heading sections).

Source files studied:
- `ui/src/components/editors/MarkdownPreview.tsx`
- `ui/src/components/editors/CollapsibleMarkdown.tsx`
- `ui/src/components/editors/CollapsibleSection.tsx` (Provider + `ManagedCollapsibleSection` + Expand/Collapse All controls)
- `ui/src/components/editors/CollapsibleDetails.tsx` (animated `<details>/<summary>` replacement)
- `ui/src/components/editors/AnnotationComponents.tsx` (referenced by `remarkAnnotations`)
- `ui/src/lib/remarkAnnotations.ts` (HTML-comment-driven annotation marker plugin)
- `ui/src/lib/remarkDiagramEmbeds.ts` (`{{diagram:id}}` / `{{design:id}}` -> image)
- `ui/src/components/editors/DocumentView.tsx`
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx`
- `ui/src/components/editors/milkdown/serializerConfig.ts`
- `ui/src/components/editors/milkdown/plugins/diagramEmbed.ts`
- `ui/package.json` (dependency inventory)

---

## 1. Features `MarkdownPreview` provides beyond plain rendering

### Typography
- NOT using `@tailwindcss/typography` `.prose` utilities as the source of truth — the outer div *does* carry `prose dark:prose-invert max-w-none` classes, but every block element is explicitly overridden via `ReactMarkdown`'s `components` prop with hand-written Tailwind classes. So the "look" is actually driven by those per-element classes (h1 -> `text-3xl font-bold mt-6 mb-4 text-gray-900 dark:text-white`, p -> `my-3 text-gray-700 dark:text-gray-300 leading-relaxed`, etc.), with `prose` only covering anything the overrides miss.
- Container chrome: `bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700`.
- Dark-mode aware for every single element via `dark:` variants.

### Code blocks
- `react-syntax-highlighter` (Prism build) with `oneDark` (dark) and `vs` (light) themes.
- Language detection via `language-xxx` class regex from fenced code fences (standard remark output).
- Wrapped in `div.my-4.rounded-lg.overflow-hidden.border` with `customStyle={{margin:0, padding:'1rem', fontSize:'0.875rem'}}`.
- NO copy button.
- Inline code gets `bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-sm`.

### Collapsible sections — TWO independent mechanisms
1. **`<details>` / `<summary>` raw HTML** in markdown -> `rehype-raw` parses the HTML through, then the `details` / `summary` component overrides render a `CollapsibleDetails` React component (animated maxHeight, chevron, themed container). Always available.
2. **Heading-based collapsibles** (opt-in via `collapsibleSections` prop) -> `CollapsibleMarkdown` parses the raw markdown string with a regex-based line scanner, builds a nested `Section` tree keyed by heading level, and renders each heading via `ManagedCollapsibleSection`. Provides an "Expand All / Collapse All" toolbar (`CollapsibleSectionsControls`) via a React context (`CollapsibleSectionsProvider`). Tracks each section's 1-based content start line so task-checkbox toggles can be translated back to the original document's line numbers.
- `CollapsibleDetails` and `CollapsibleSection` both use measured `scrollHeight` + `maxHeight` transitions (300ms ease-in-out) and a rotating chevron SVG.

### Diagram / design embeds
- Custom `remarkDiagramEmbeds` plugin converts `{{diagram:id}}` / `{{design:id}}` text into `image` mdast nodes with URLs `@diagram/id` or `@design/id`.
- `img` component override runs `resolveImageSrc` which maps:
  - `@design/id` -> `/api/design/:id/render?project=…&session=…`
  - `@diagram/id` -> `/api/render/:id?project=…&session=…&theme=…`
  - `./designs/id` / `designs/id` (with optional `.json`/`.design` extension stripped) -> same design render endpoint
  - `./diagrams/id` / `diagrams/id` (with optional `.mmd` stripped) -> same diagram render endpoint
  - Everything else passes through.
- Images get `max-w-full h-auto my-4 rounded-lg border`.

### Task lists (GFM)
- `li` override detects `className === 'task-list-item'`. If `onContentChange` is provided, the inner `<input type="checkbox">` is swapped with a controlled version whose `onChange` calls `handleCheckboxToggle(line)`. That handler splits the original markdown, finds `/^(\s*[-*+]\s+)\[([ xX])\]/` on the target 1-based line, flips it, and emits the new full content. Line comes from mdast `node.position.start.line`. `CollapsibleMarkdown` does the equivalent but adds a `lineOffset` so section-local line numbers map back to absolute document lines.

### Tables / blockquotes / hr / links
- Plain styled overrides, no extra behavior. Links always `target="_blank" rel="noopener noreferrer"`.

### Annotations
- `remarkAnnotations` converts HTML-comment markers (`<!-- comment: … -->`, `<!-- status: proposed -->`, `<!-- approve-start --> … <!-- approve-end -->`, `<!-- status: rejected: reason -->`, etc.) into custom `annotation` mdast nodes rendered by `AnnotationRenderer`.

### Diff mode
- Provided via `diff={{oldContent, newContent}}` prop: LCS-based line diff, rendered as three classes of `<div>` wrappers (`diff-unchanged / -added / -removed`) each re-invoking `ReactMarkdown` on its segment. Not mutually exclusive with collapsible sections (but in code, diff mode short-circuits collapsible mode).

### Other
- `onClearDiff` callback plumbed through (not rendered in the component itself — caller responsibility).
- `scrollRef` exposed for scroll sync.
- `onElementClick(line)` is declared but currently unused.

### What it does NOT do
- No heading anchors / auto-id / TOC generation.
- No math (no KaTeX/MathJax).
- No Mermaid-in-codeblock auto-rendering (diagrams only come via the embed syntax).
- No copy-to-clipboard on code blocks.

---

## 2. What Milkdown currently gives us for free

Current `MilkdownEditor` setup:
- `@milkdown/preset-commonmark` + `@milkdown/preset-gfm` -> headings, paragraphs, emphasis/strong, lists, tables, blockquotes, hr, inline + fenced code, images, links, task lists. All structurally parsed.
- `@milkdown/plugin-history` + `@milkdown/plugin-clipboard`.
- Fidelity plugins in `serializerConfig.ts` — these don't affect *look*, they just preserve marker chars + blank-line spacing round-trip.
- `diagramEmbedRemarkPlugin` + `diagramEmbedNode` + `DiagramEmbedView` -> `{{diagram:id}}` / `{{design:id}}` are already a real block-level node with a React node view. Rendering lives in `DiagramEmbedView` (not read here, but the bridge exists).
- `autosavePlugin`, `rawPositionsPlugin` -> editor mechanics, not visual.

Milkdown ships **zero CSS** by default — the ProseMirror DOM is unstyled, no Tailwind `prose`, no heading sizes, no code background, no list markers in many cases. Everything in section 1 ("typography") is missing until we add it.

### Parity scorecard

| Feature | Milkdown status |
| --- | --- |
| Headings / paragraphs / emphasis / strong / lists / tables / blockquotes / hr / links / inline code / fenced code / images / task list checkboxes (structural) | Already parsed by commonmark+gfm — only styling missing |
| Diagram / design embeds (`{{diagram:id}}`, `{{design:id}}`) | Already handled via `diagramEmbedNode` + node view |
| Syntax-highlighted code blocks | MISSING — fenced code renders as unstyled `<pre><code>` |
| Dark-mode aware typography | MISSING — no CSS at all |
| Container chrome (rounded, bordered, padded panel) | Partially present in `DocumentView` wrapper (`px-4 py-4 bg-white dark:bg-gray-900`) — not exact parity |
| `<details>` / `<summary>` animated sections | MISSING — commonmark ignores raw HTML; needs either a remark plugin that parses them into a node, or a directive / custom schema |
| Heading-based collapsible sections + Expand/Collapse All | MISSING — needs a ProseMirror NodeView that wraps heading + siblings, OR a post-parse transform; this is the biggest ask |
| Image URL resolution (`@diagram/id` etc.) | PARTIAL — embeds cover `{{…}}` syntax; raw image URLs like `@design/id`, `./designs/id` are currently passed through unchanged to `<img>` |
| Task list checkbox toggle writing back to source | MISSING in read-only preview sense — but in edit mode Milkdown mutates the doc directly, so if `editable=true` the user just clicks. For the read-only preview use case we'd need either to keep edit mode on for task items, or re-implement the toggle. |
| Annotations (`<!-- comment: … -->`) | MISSING — no equivalent |
| Diff rendering | MISSING — not trivial in Milkdown; easier to leave diff mode on the old component and only switch the non-diff path to Milkdown, OR render diff as a separate read-only view. |

---

## 3. Shortest path per missing feature

### A. Typography / CSS (highest priority, biggest visual delta)
Cleanest option: **apply `.prose dark:prose-invert` to the Milkdown host + add a scoped CSS file that ports the exact per-element classes from `MarkdownPreview` onto `.ProseMirror > *` selectors.** The existing `MarkdownPreview` overrides are already a complete visual spec; mechanically translate them:
```css
.milkdown .ProseMirror h1 { @apply text-3xl font-bold mt-6 mb-4 text-gray-900 dark:text-white; }
.milkdown .ProseMirror h2 { @apply text-2xl font-bold mt-5 mb-3 ... }
/* …p, strong, em, a, ul, ol, li, pre, code, blockquote, hr, table, thead, tr, td, th */
```
Add `data-prose` class to the host div in `DocumentView` so styles are scoped. Tailwind `@apply` inside a CSS file works in this repo (it uses Tailwind).
- ~1 new CSS file, ~80 lines, mostly copy-paste from `MarkdownPreview.tsx`.
- LOC: ~80.

### B. Code-block syntax highlighting
Two options:
1. **Official**: `@milkdown/plugin-prism` — drop-in, uses Prism, themeable. Accepts a `configureRefractor` ctx. Small config footprint. Recommended.
2. **Custom node view**: `$view(fencedCode.node, …)` rendering `react-syntax-highlighter` with the same `oneDark`/`vs` themes already in use. Gives pixel-identical parity to today.
Option 2 is safer for "identical" visuals since the current component uses `react-syntax-highlighter` and specific inline styles.
- Option 1 LOC: ~10 + a Prism theme CSS import.
- Option 2 LOC: ~60 (a React NodeView wrapper).

### C. Heading-based collapsible sections (the hard one)
Two viable approaches — recommend approach 2:

1. **Post-parse structural transform**: a `$prose` plugin that, after every transaction, walks the doc and groups `heading` + following sibling blocks into a `section` node using ProseMirror decorations. Pure decoration (no schema change) keeps the markdown round-trip intact. Render chevron + hide/show via decorations or a widget.
  - LOC: ~150 and tricky to get animation right.

2. **NodeView on the heading schema** that decorates the heading with a chevron button and, on toggle, sets CSS display:none on all following sibling blocks up to the next heading of same/higher level. This reuses the existing `headingRawTrailing` $nodeSchema — add a NodeView via `$view(headingRawTrailing.node, nodeViewFactory({ component: HeadingWithChevron }))`. The component queries `this.view.state.doc` from the provided getPos and toggles a ref/context-managed expanded-set (mirroring `CollapsibleSectionsProvider`). Hiding is done by adding a decoration that adds a `.cm-collapsed` class to the affected blocks, or more simply by walking `view.dom.children` DOM-side after mount.
  - Can reuse `CollapsibleSectionsProvider`, `ChevronIcon`, and the Expand/Collapse All button component verbatim.
  - LOC: ~120.

The "Expand All / Collapse All" toolbar: render it as a sibling of the editor in `DocumentView`, inside the same provider, talking to the same context.

Markdown fidelity: both approaches are pure view-layer — markdown source is unchanged.

### D. Raw HTML `<details>` / `<summary>`
Commonmark/gfm keep `<details>` as `html` blocks. Options:
1. **Custom remark plugin** that converts paired `<details>…</details>` HTML blocks into a `details` node with `summary` + content children, plus a `$nodeSchema('details')` + `$nodeSchema('summary')` with NodeViews reusing the existing `CollapsibleDetails` component. Tricky because remark splits open/close into separate `html` siblings.
2. **Directive-based**: use `remark-directive` + `:::details[Summary]\n…\n:::` syntax instead. Cleaner AST, but requires changing the authored markdown everywhere.
3. **Skip it**: if current content doesn't heavily use `<details>` tags (heading collapsibles do the same job), ship without this and accept a regression.
- Recommend option 1 for parity, ~100 LOC remark + ~40 LOC schemas + NodeView bridge.

### E. Image URL resolution (`@design/id`, `./designs/id`, etc.)
Override the `image` node's NodeView (or a `$view` on commonmark's `image` node), apply the same `resolveImageSrc` logic from `MarkdownPreview`. Pull `project`/`session` from the existing `ProjectSessionContext` (already set up in `MilkdownEditor.tsx`).
- LOC: ~40.

### F. Task-list checkbox writeback
If the editor is always mounted (edit + review mode), flipping a checkbox in edit mode just works — autosave picks it up. In read-only (`editable=false`) mode, either:
1. Keep the editor always `editable=true` but disable everything except checkbox clicks via a transaction filter. (~30 LOC)
2. Add a DOM-level click handler on task checkboxes that dispatches a ProseMirror transaction toggling the attribute. (~40 LOC)

### G. Annotations (`<!-- comment: … -->`)
Port `remarkAnnotations` directly — it's a `unified` plugin, works inside Milkdown via `$remark(...)`. Then register node schemas for `annotation` (and its variants) with NodeViews that reuse `AnnotationRenderer`. Non-trivial because annotations can be both block and inline.
- LOC: ~150 including schemas, NodeViews, and serialization. If annotations aren't required for v1 parity, defer.

### H. Diff mode
Suggest keeping `MarkdownPreview` for the diff code path and only route non-diff rendering through Milkdown. `DocumentView` can branch on the `diff` prop if/when it's added.
- LOC: 0 in Milkdown; just a branch in the caller.

### I. Container chrome + edit toggle button
`DocumentView` already has the outer wrapper and the edit toggle. Just tweak padding/border to match `MarkdownPreview`'s `bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700`.
- LOC: ~5.

---

## 4. Collapsible sections — concrete plan

Current implementation (`MarkdownPreview` + `collapsibleSections=true`):
- Regex-based markdown line scanner (NOT ast-based) builds a nested `Section[]` tree keyed by ATX heading depth `#..######`, with a `preamble` string for pre-first-heading content.
- Each section rendered by `ManagedCollapsibleSection` which consumes `CollapsibleSectionsProvider` context.
- Inner content of each section is rendered by a nested `ReactMarkdown` call with `remark-gfm` + `remarkDiagramEmbeds` + `rehype-raw` — so code highlighting, embeds, and raw HTML all still work per-section.
- Toolbar above sections: `CollapsibleSectionsControls` renders Expand All / Collapse All buttons that drive the provider's `expandAll` / `collapseAll`.
- Each section gets a numeric `sectionId` (`section-0`, `section-1`, …); provider tracks `expandedSections: Set<string>` and registers each section on mount.
- Animation: measure `innerRef.scrollHeight`, transition `maxHeight: 0 <-> measured` with 300ms ease-in-out, and flip to `overflow-visible` after the transition ends so absolutely-positioned children (tooltips etc.) aren't clipped when open.

Milkdown-native approach (recommended): **reuse the existing React components verbatim** via a heading NodeView:

1. In `MilkdownEditor`, wrap the editor host in `<CollapsibleSectionsProvider>` (moved up to `DocumentView`). Render `<CollapsibleSectionsControls>` above the editor.
2. Add a `$view(headingRawTrailing.node, nodeViewFactory({ component: HeadingNodeView }))` that:
   - Renders the chevron button + `<HeadingTag>{children}</HeadingTag>` using `useNodeViewContext`.
   - Assigns a stable `sectionId` per heading by hashing `getPos() + node.attrs.level` (or via a `useId`-backed Map keyed on the node's doc position observed once).
   - Subscribes to `useCollapsibleSections()` for `isExpanded`.
   - On toggle, calls a helper that walks the editor's `view.dom` and toggles `style.display` (or better: applies a CSS class via a ProseMirror decoration) on every block between this heading and the next heading of level <= its own.
3. "Hide following blocks" is implemented cleanest as a ProseMirror `Plugin` that produces `DecorationSet` based on the provider's `expandedSections` (exposed via a React ref). The plugin computes ranges [heading+1 … nextHeadingOfSameOrHigher) and adds a `nodeDecoration` with class `section-collapsed` when the heading's section is collapsed. CSS hides them.

Alternative "dumber" path: keep the *current* `CollapsibleMarkdown` (ReactMarkdown) as a read-only preview, but have Milkdown only render while `editable=true`. Toggle between the two views on the same component. Less work, not truly Milkdown-native, and loses the live-edit-while-collapsed story. Could be a stepping stone.

---

## 5. Typography / CSS strategy

Conclusion: **don't try to make Milkdown "look prose-y on its own" — just port the existing per-element Tailwind classes to a scoped stylesheet targeting `.ProseMirror`**.

Recommended layout:
- `ui/src/components/editors/milkdown/milkdown-prose.css` — one file, `.milkdown-prose .ProseMirror h1 { @apply … }` for every element already in `MarkdownPreview`'s `components` map. Mirror the `dark:` variants.
- `DocumentView` adds `className="milkdown-prose"` to the scroll container.
- Keep the outer `prose dark:prose-invert max-w-none` class as a safety net for any elements not explicitly targeted (footnotes, kbd, etc.).
- For code blocks, either:
  - Import a Prism theme CSS (`react-syntax-highlighter`'s themes are JS objects, not CSS — so use a static Prism theme CSS file for Option 1 from section 3B), OR
  - Use the React NodeView approach that literally renders `<SyntaxHighlighter style={theme === 'dark' ? oneDark : vs}>` — zero new CSS needed, perfect parity.

This keeps parity deterministic (every class that worked before still works) and avoids a risky rewrite in terms of `@tailwindcss/typography` variables.

---

## Rough total effort (LOC, excluding tests)

| Feature | LOC |
| --- | --- |
| Port CSS for typography | ~80 |
| Code-block node view with `react-syntax-highlighter` | ~60 |
| Heading NodeView + decoration plugin for heading-based collapse | ~120 |
| Reuse `CollapsibleSectionsProvider` + `Controls` in `DocumentView` | ~15 |
| `<details>/<summary>` raw-HTML paired-block remark plugin + node schema + NodeView | ~140 |
| Image `resolveImageSrc` NodeView override | ~40 |
| Task-list checkbox toggle (if needed in read-only) | ~40 |
| Annotations port (if in scope) | ~150 |
| Container chrome tweaks | ~5 |
| **Total (excluding annotations + diff)** | **~500 LOC** |

Biggest risk items: (a) getting the heading-decoration + NodeView animation to match the measured-scrollHeight transition of `CollapsibleSection`; (b) raw-HTML `<details>` parsing through commonmark (open/close come in as separate `html` siblings).

Recommended phasing:
1. CSS parity + code-block highlight + container chrome. (Fastest visual win, covers 80% of cases.)
2. Image URL resolution.
3. Heading-based collapsible sections (reusing existing React components).
4. `<details>` / `<summary>` support.
5. Annotations + diff mode (optional; can be left on `MarkdownPreview` indefinitely).
