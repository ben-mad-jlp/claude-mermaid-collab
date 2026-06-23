# Blueprint: Milkdown Parity — Closing G0–G12

Anchor: `design-milkdown-parity`. Supporting docs: `research-milkdown-parity`, `review-completeness-phase-1-6`, `review-bugs-phase-1-6`.

**Guiding Principle (from the design doc):** Prefer Milkdown built-in plugins, themes, and presets over custom reimplementations — even when the result looks visually different from the legacy editor. Byte-exact round-trip and functional parity are the bar, **not** pixel parity. Every task below that touches styling/plugins must adopt this principle; only reach for custom code when no built-in exists (G3 heading-collapse, G4 raw `<details>`, G7 annotations) or a functional blocker forces it.

---

## 1. Structure Summary

### Files modified

- `ui/src/components/editors/DocumentEditor.tsx` — replace the 10-line passthrough stub with a router that reads `useFeatureFlags().wysiwygDocumentEditor` and dispatches to `DocumentEditorWysiwyg` or `DocumentEditorLegacy`.
- `ui/src/components/editors/DocumentEditor.wysiwyg.tsx` — add History button wiring (G10), route diff prop to `MarkdownPreview` (G8), mount `CollapsibleSectionsProvider` + `Controls` around the editor host (G3).
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` — register new plugins (prism G2, image resolver view G5, heading NodeView + collapse decoration G3, details schema + NodeView G4, annotation decoration plugin G7), load theme stylesheet (G1), wire telemetry hooks (G11), fix `autosaveDelay` ref stability (G12 / bug I4).
- `ui/src/components/editors/milkdown/serializerConfig.ts` — add strong-mark join handler (G9), ordered-list marker schema (G12 / bug M6), remove `bulletMarkerRemark` no-op (G12 / bug M4).
- `ui/src/components/editors/milkdown/plugins/rawPositions.ts` — fix break-style slice window (G12 / bug M2).
- `ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts` — remove `05-emphasis.md` from the allowlist after G9 lands.
- `ui/src/config/featureFlags.ts` — (optional) expose helper used by router; no behavior change expected.

### Files created

- `ui/src/components/editors/milkdown/milkdown-prose.css` — scoped theme entry; re-exports built-in Milkdown theme and dark-mode class toggles (G1).
- `ui/src/components/editors/milkdown/plugins/codeBlockPrism.ts` — thin wrapper registering `@milkdown/plugin-prism` with light/dark Prism themes (G2).
- `ui/src/components/editors/milkdown/plugins/imageResolver.tsx` — `$view(image.node, …)` NodeView invoking `resolveImageSrc` with `{project, session}` from `useProjectSession()` (G5).
- `ui/src/components/editors/milkdown/plugins/headingCollapse.ts` — heading NodeView + ProseMirror decoration plugin that hides blocks between a collapsed heading and the next heading of equal-or-higher level (G3).
- `ui/src/components/editors/milkdown/plugins/rawDetails.ts` — remark pre-plugin pairing `<details>`/`</details>` sibling `html` nodes + `$nodeSchema('details')`, `$nodeSchema('summary')`, NodeViews rendering native `<details>`/`<summary>` (G4).
- `ui/src/components/editors/milkdown/plugins/taskListFixtures.ts` — optional round-trip fixture scaffolding only (G6); code may be empty if GFM built-in already round-trips cleanly — drive the decision from a new fixture test.
- `ui/src/components/editors/milkdown/plugins/annotations/` — new directory with `schema.ts` (document-metadata `Annotation` type), `anchor.ts` (position-resilient anchoring), `decoration.ts` (PM decoration plugin), `toolbar.tsx` (wysiwyg variant of `AnnotationToolbar`), `migrator.ts` (one-shot `<!-- comment-start:… -->` → metadata migrator) (G7).
- `ui/src/components/editors/milkdown/plugins/strongJoin.ts` — custom `mdast-util-to-markdown` strong handler that tracks raw marker positions and emits adjacent runs without collapsing (G9).
- `ui/src/components/editors/milkdown/plugins/telemetry.ts` — emits `editor_variant`, `round_trip_drift_bytes`, `autosave_latency_ms` (G11).
- `ui/src/components/editors/__tests__/DocumentEditor.router.test.tsx` — router flag-plumbing test (G0).
- `ui/src/components/editors/milkdown/__tests__/codeBlockPrism.test.ts` (G2).
- `ui/src/components/editors/milkdown/__tests__/imageResolver.test.tsx` (G5).
- `ui/src/components/editors/milkdown/__tests__/headingCollapse.test.tsx` (G3).
- `ui/src/components/editors/milkdown/__tests__/rawDetails.test.ts` (G4).
- `ui/src/components/editors/milkdown/__tests__/taskList.roundtrip.test.ts` (G6).
- `ui/src/components/editors/milkdown/__tests__/annotations/*.test.ts` (G7, multiple).
- `ui/src/components/editors/milkdown/__tests__/strongJoin.test.ts` (G9).
- `ui/src/components/editors/milkdown/__tests__/telemetry.test.ts` (G11).
- `ui/src/components/editors/milkdown/__fixtures__/roundtrip/15-tasklist.md` (G6).
- `ui/src/components/editors/milkdown/__fixtures__/roundtrip/16-raw-details.md` (G4).

### Key type definitions

```ts
// annotations/schema.ts
export interface Annotation {
  id: string;
  kind: 'comment' | 'proposed' | 'approved' | 'rejected';
  anchor: { from: number; to: number; text: string; checksum: string };
  body: string;
  author?: string;
  createdAt: number;
  resolvedAt?: number;
  reason?: string;  // for rejected
}

// headingCollapse.ts
export interface HeadingNodeViewProps {
  sectionId: string;     // stable id derived from heading doc position
  level: 1|2|3|4|5|6;
  isExpanded: boolean;
  onToggle(): void;
}

// imageResolver.tsx
export interface ResolvedImageProps {
  src: string;          // raw markdown URL
  alt?: string;
  title?: string;
  project?: string;
  session?: string;
}

// telemetry.ts
export type EditorVariant = 'wysiwyg' | 'legacy';
export interface TelemetryEvent {
  editor_variant: EditorVariant;
  round_trip_drift_bytes?: number;
  autosave_latency_ms?: number;
  timestamp: number;
}
```

### Component interactions

```
DocumentEditor (router, G0)
 ├── useFeatureFlags() → wysiwygDocumentEditor
 ├── [flag on]  DocumentEditorWysiwyg
 │                ├── CollapsibleSectionsProvider (G3) → Controls
 │                ├── MilkdownEditor
 │                │     ├── rawPositionsPlugin (existing)
 │                │     ├── commonmark + gfm (existing)
 │                │     ├── @milkdown/plugin-prism (G2, built-in)
 │                │     ├── @milkdown/theme-nord (G1, built-in)
 │                │     ├── diagramEmbedNode + View (existing)
 │                │     ├── imageResolverView (G5)
 │                │     ├── headingCollapse plugin + NodeView (G3)
 │                │     ├── rawDetails remark + schema + NodeView (G4)
 │                │     ├── annotations decoration + toolbar (G7)
 │                │     ├── strongJoin handler (G9)
 │                │     ├── telemetry plugin (G11)
 │                │     └── fidelityPlugins (+M4/M6 fixes, G12)
 │                ├── HistoryModal (G10, now with open button)
 │                └── diff → MarkdownPreview branch (G8)
 └── [flag off] DocumentEditorLegacy (unchanged)
```

---

## 2. Function Blueprints

### `DocumentEditor` (router, G0)

**Signature:** `const DocumentEditor: React.FC<DocumentEditorProps>`

**Pseudocode:**
1. Call `const { wysiwygDocumentEditor } = useFeatureFlags()`.
2. If `wysiwygDocumentEditor === true`, render `<DocumentEditorWysiwyg {...props} />`.
3. Otherwise render `<DocumentEditorLegacy {...props} />`.
4. Emit telemetry `{ editor_variant }` once per mount (dedupe via `useRef`).

**Error handling:** If `useFeatureFlags()` throws (SSR / no window), fall through to legacy.

**Edge cases:** Flag flipping mid-session unmounts/remounts the chosen variant — acceptable since document id is stable and content re-hydrates from store.

**Test strategy (`DocumentEditor.router.test.tsx`):** render with flag on and off (via `setWysiwygDocumentEditor`), assert `data-testid` is `document-editor-wysiwyg` vs `document-editor`. Assert telemetry event fired once.

---

### `imageResolverView` NodeView (G5)

**Signature:** `$view(image.node, nodeViewFactory({ component: ResolvedImage }))`

**Pseudocode:**
1. Read `node.attrs.src`, `alt`, `title`.
2. `useProjectSession()` → `{project, session}`.
3. Call shared `resolveImageSrc(src, {project, session})` (extract from `MarkdownPreview` into `ui/src/lib/resolveImageSrc.ts` if not already shared).
4. Render `<img src={resolvedSrc} alt={alt} title={title} class="max-w-full h-auto my-4 rounded-lg border" />`.

**Error handling:** If resolution throws, fall back to raw `src` and log once.

**Edge cases:** Empty/missing project/session → pass through raw `src`. Embeds (`{{diagram:id}}`) are handled by `diagramEmbedNode` path — image view only fires on plain markdown image nodes.

**Test strategy:** render fixture with `![](@diagram/xyz)`; mount with `ProjectSessionContext` value, assert `img.src` starts with `/api/render/xyz`.

---

### `headingCollapsePlugin` (G3)

**Signatures:**
```ts
export const headingCollapsePlugin: MilkdownPlugin;
export function useHeadingSectionId(getPos: () => number, level: number): string;
```

**Pseudocode (decoration plugin):**
1. Create a ProseMirror `Plugin` with a `state.apply` that reads the current expanded-set from a React-ref-exposed context (via `pluginKey.getState` + side channel).
2. On every transaction, walk `state.doc`; for each heading node at position `p` with level `L` whose `sectionId` is NOT in the expanded set:
   - Find next sibling heading with `level <= L` (or end-of-doc).
   - For every block between heading end and that next heading, add `Decoration.node(from, to, { class: 'section-collapsed' })`.
3. Return a `DecorationSet` from `props.decorations`.
4. CSS: `.section-collapsed { display: none; }`.

**Pseudocode (HeadingNodeView):**
1. Read `level`, `sectionId` (stable id from doc position hash).
2. Subscribe to `useCollapsibleSections()` for `isExpanded(sectionId)`.
3. Render `<HTag><ChevronButton rotated={isExpanded} onClick={() => toggle(sectionId)} /> {children}</HTag>`.

**Error handling:** If expanded-set context missing, treat all as expanded (decorations empty).

**Edge cases:**
- Empty doc → DecorationSet.empty.
- Heading at end of doc (no siblings) → no decorations needed.
- Section id collisions on identical heading text → disambiguate by doc position, not text.
- Performance on 50k-char doc: cache by `(docVersion, expandedSetHash)`; recompute only on doc change or toggle.

**Test strategy:** fixture with three H2 sections; toggle middle one collapsed; assert middle siblings have `display:none`, others don't. Snapshot DecorationSet ranges. Perf smoke test: 100 headings renders in < 50ms.

---

### `rawDetailsPlugin` remark pairing (G4)

**Signature:** `function pairDetails(tree: mdastRoot): void` plus `$nodeSchema('details')` / `$nodeSchema('summary')`.

**Pseudocode:**
1. Walk `tree.children` in order.
2. When encountering an `html` node matching `/^<details[^>]*>/i`, scan forward for the closing `</details>` sibling html node at the same depth.
3. If found, splice the range into a new `details` mdast node; parse any leading `<summary>…</summary>` sibling into a `summary` child node; preserve remaining children as `details.children`.
4. If no matching close tag, leave the `html` nodes intact (graceful degradation) and emit a dev-only `console.warn`.
5. Register `$nodeSchema('details')` parseMarkdown/toMarkdown that emits `<details>…</details>` literal HTML on serialize; NodeView renders native `<details>` element (children flow as ProseMirror content).

**Error handling:** Malformed nesting → skip pairing, preserve original HTML nodes.

**Edge cases:** Nested `<details>`; `<summary>` missing; attributes on `<details open>` preserved as attrs on the node; non-paired `<details>` mid-document.

**Test strategy:** Round-trip fixture `16-raw-details.md` with paired, nested, and malformed variants; native browser toggle behavior unit-tested by clicking `<summary>` and asserting `open` attribute changes.

---

### `strongJoinHandler` (G9)

**Signature:** `const strongToMarkdown: ToMarkdownHandler`

**Pseudocode:**
1. Read `rawPositions` data on the `strong` node (existing mechanism).
2. If two adjacent `strong` runs in the source shared no whitespace (i.e. `**a****b**` pattern), emit them as two separate runs `**a****b**` rather than joining to `**ab**`.
3. Fall back to default handler if `rawPositions` absent.

**Error handling:** If raw positions unavailable or ambiguous, default to current behavior (allowlist re-enabled would be the signal).

**Edge cases:** Strong containing inline code (`**bold `code`**`) — exact fixture 05; nested emphasis inside strong; strong spanning multiple lines.

**Test strategy:** Run fixture 05 through round-trip; assert byte-exact. Remove `05-emphasis.md` from `acceptableDrift` allowlist. Add targeted unit test for `**a****b**` split.

---

### `annotationsMigrator` (G7)

**Signature:** `function migrateInlineAnnotations(markdown: string): { cleaned: string; annotations: Annotation[]; orphans: string[] }`

**Pseudocode:**
1. Scan for `<!-- comment-start: {json} --> … <!-- comment-end -->` and sibling variants (`status:`, `approve-start/end`, etc.).
2. For each matched pair, extract the anchored text, compute a checksum (e.g. SHA-1 of trimmed text), and build an `Annotation` with `anchor: {from, to, text, checksum}` based on positions in the cleaned document.
3. Strip the HTML-comment markers from the output.
4. If a marker has no matching closer, push the raw marker to `orphans[]` and leave it intact in `cleaned`.
5. Return `{cleaned, annotations, orphans}`.

**Error handling:** Malformed JSON in `comment-start` → orphan; preserve original marker intact.

**Edge cases:** Nested annotations; overlapping ranges; markers inside code fences (ignore); Windows line endings.

**Test strategy:** 5 real annotated docs as fixtures; assert round-trip idempotency (`migrate(migrate(x).cleaned) === migrate(x).cleaned`); orphan rate < 10%; server-side metadata schema bump covered by `document-metadata.test.ts`.

---

### `telemetryPlugin` (G11)

**Signature:** `function emitTelemetry(evt: TelemetryEvent): void`

**Pseudocode:**
1. On editor mount: emit `{editor_variant: 'wysiwyg', timestamp}`.
2. On every autosave completion: measure `performance.now()` delta since persist request; emit `{autosave_latency_ms}`.
3. On every round-trip invariant probe (dev-only): emit `{round_trip_drift_bytes}` if the current doc re-serialized differs from its source.
4. Sink: start with `console.debug` + a pluggable `window.__telemetrySink` hook; the real sink decision is an Open Question in the design doc.

**Error handling:** Sink failures never propagate (wrap in try/catch).

**Edge cases:** SSR (no `performance`) → no-op. Very fast autosaves (< 1 ms) → still emit; downstream can bucket.

**Test strategy:** Mock sink; trigger mount + autosave + flush; assert event shapes.

---

## 3. Task Dependency Graph

```yaml
tasks:
  - id: g0-router-flag
    files:
      - ui/src/components/editors/DocumentEditor.tsx
    tests:
      - ui/src/components/editors/__tests__/DocumentEditor.router.test.tsx
    description: "Wire useFeatureFlags().wysiwygDocumentEditor into DocumentEditor.tsx router; replace the 10-line passthrough stub with a flag-driven dispatch between DocumentEditorWysiwyg and DocumentEditorLegacy. Phase R0 prereq — blocks every other wysiwyg-facing task from being reachable in production."
    parallel: false
    depends-on: []

  - id: g11-telemetry
    files:
      - ui/src/components/editors/milkdown/plugins/telemetry.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests:
      - ui/src/components/editors/milkdown/__tests__/telemetry.test.ts
    description: "Add telemetry scaffolding for editor_variant, round_trip_drift_bytes, autosave_latency_ms. R0 scaffolding — independent of G0 so it can ship in parallel."
    parallel: true
    depends-on: []

  - id: g1-typography-theme
    files:
      - ui/src/components/editors/milkdown/milkdown-prose.css
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
      - ui/package.json
    tests:
      - ui/src/components/editors/milkdown/__tests__/theme.test.tsx
    description: "Adopt a Milkdown built-in theme package (@milkdown/theme-nord or @milkdown/crepe) per the guiding principle — do NOT port legacy Tailwind per-element classes. Add a thin dark-mode class toggle wrapper. Accept visual delta from legacy; readability is the bar, not pixel parity."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g2-code-prism
    files:
      - ui/src/components/editors/milkdown/plugins/codeBlockPrism.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
      - ui/package.json
    tests:
      - ui/src/components/editors/milkdown/__tests__/codeBlockPrism.test.ts
    description: "Adopt @milkdown/plugin-prism (built-in) for fenced code highlighting per the guiding principle. Do NOT bolt react-syntax-highlighter into a custom NodeView — the built-in plugin handles this without a custom integration layer. Ship prism-one-light + prism-one-dark themes."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g5-image-resolver
    files:
      - ui/src/components/editors/milkdown/plugins/imageResolver.tsx
      - ui/src/lib/resolveImageSrc.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests:
      - ui/src/components/editors/milkdown/__tests__/imageResolver.test.tsx
    description: "Add NodeView over the image node that invokes resolveImageSrc with {project, session} from useProjectSession() — handles @diagram/id, @design/id, ./designs/id, ./diagrams/id. Extracts shared resolver from MarkdownPreview into ui/src/lib/resolveImageSrc.ts."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g8-diff-branch
    files:
      - ui/src/components/editors/DocumentEditor.wysiwyg.tsx
    tests:
      - ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.diff.test.tsx
    description: "Route diff prop cases to MarkdownPreview inside DocumentEditorWysiwyg (prop-driven branch) — keep the LCS diff renderer on the legacy component per the migration design. No Milkdown-side implementation needed."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g10-history-modal
    files:
      - ui/src/components/editors/DocumentEditor.wysiwyg.tsx
    tests:
      - ui/src/components/editors/__tests__/DocumentEditor.wysiwyg.history.test.tsx
    description: "Port the History button + open-handler from legacy header into DocumentEditor.wysiwyg.tsx; wire handleHistoryVersionSelect + modal open state parity with legacy."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g12-deferred-bugs
    files:
      - ui/src/components/editors/milkdown/plugins/rawPositions.ts
      - ui/src/components/editors/milkdown/serializerConfig.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests:
      - ui/src/components/editors/milkdown/plugins/__tests__/rawPositions.test.ts
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    description: "Address deferred bug-review follow-ups: M2 (break-style raw slice window — use fixed ±2 window around startOffset), M4 (remove bulletMarkerRemark no-op registration), M6 (add orderedListMarker attr schema paralleling bulletListMarker — 1. vs 1)), plus I4 (stabilize autosaveDelay via ref). Grouped with R1 for convenience per guidance."
    parallel: true
    depends-on: [g0-router-flag]

  - id: g3-heading-collapse
    files:
      - ui/src/components/editors/milkdown/plugins/headingCollapse.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
      - ui/src/components/editors/DocumentEditor.wysiwyg.tsx
      - ui/src/components/editors/milkdown/milkdown-prose.css
    tests:
      - ui/src/components/editors/milkdown/__tests__/headingCollapse.test.tsx
    description: "Heading-based collapsible sections via heading NodeView + ProseMirror decoration plugin that hides blocks between a collapsed heading and the next heading of equal-or-higher level. Reuse existing CollapsibleSectionsProvider + Controls + chevron React components verbatim. NOTE: No Milkdown built-in exists for this — guiding principle doesn't apply; custom implementation required. Ship without animation in v1; revisit only if users complain."
    parallel: true
    depends-on: [g0-router-flag, g1-typography-theme, g2-code-prism, g5-image-resolver, g8-diff-branch, g10-history-modal]

  - id: g4-raw-details
    files:
      - ui/src/components/editors/milkdown/plugins/rawDetails.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/16-raw-details.md
    tests:
      - ui/src/components/editors/milkdown/__tests__/rawDetails.test.ts
    description: "Raw <details>/<summary> blocks: remark pre-plugin pairs open/close html siblings into a details mdast node + $nodeSchema('details')/$nodeSchema('summary') with NodeViews rendering NATIVE <details>/<summary> (browser-maintained toggle, minimal CSS). NOTE: No Milkdown built-in — custom required. Graceful degradation on malformed nesting."
    parallel: true
    depends-on: [g0-router-flag, g1-typography-theme, g2-code-prism, g5-image-resolver, g8-diff-branch, g10-history-modal]

  - id: g6-task-list
    files:
      - ui/src/components/editors/milkdown/__fixtures__/roundtrip/15-tasklist.md
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
    tests:
      - ui/src/components/editors/milkdown/__tests__/taskList.roundtrip.test.ts
    description: "Validate task-list checkbox toggle semantics using Milkdown's built-in GFM task-list plugin per the guiding principle. Likely zero code change — verify round-trip fidelity with a new fixture first; only add transaction filter if a gap surfaces. No custom checkbox component."
    parallel: true
    depends-on: [g0-router-flag, g1-typography-theme, g2-code-prism, g5-image-resolver, g8-diff-branch, g10-history-modal]

  - id: g7-annotations
    files:
      - ui/src/components/editors/milkdown/plugins/annotations/schema.ts
      - ui/src/components/editors/milkdown/plugins/annotations/anchor.ts
      - ui/src/components/editors/milkdown/plugins/annotations/decoration.ts
      - ui/src/components/editors/milkdown/plugins/annotations/toolbar.tsx
      - ui/src/components/editors/milkdown/plugins/annotations/migrator.ts
      - ui/src/components/editors/milkdown/MilkdownEditor.tsx
      - ui/src/components/editors/DocumentEditor.wysiwyg.tsx
      - src/services/document-metadata.ts
    tests:
      - ui/src/components/editors/milkdown/__tests__/annotations/schema.test.ts
      - ui/src/components/editors/milkdown/__tests__/annotations/anchor.test.ts
      - ui/src/components/editors/milkdown/__tests__/annotations/decoration.test.tsx
      - ui/src/components/editors/milkdown/__tests__/annotations/migrator.test.ts
    description: "Annotations migrated to document-metadata field (document.annotations) with position-resilient anchors, per design-milkdown-migration §Resolved-decisions-3. Includes: Annotation type, anchor with checksum, PM decoration plugin, wysiwyg toolbar variant, one-shot migrator from inline <!-- comment-start --> markers, server-side metadata schema bump. Largest task — ~300+ LOC. No Milkdown built-in applies."
    parallel: true
    depends-on: [g0-router-flag, g1-typography-theme, g2-code-prism, g5-image-resolver, g8-diff-branch, g10-history-modal]

  - id: g9-strong-mark
    files:
      - ui/src/components/editors/milkdown/plugins/strongJoin.ts
      - ui/src/components/editors/milkdown/serializerConfig.ts
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    tests:
      - ui/src/components/editors/milkdown/__tests__/strongJoin.test.ts
      - ui/src/components/editors/milkdown/__tests__/roundTrip.test.ts
    description: "Custom mdast-util-to-markdown strong handler that tracks raw marker positions (from rawPositions plugin) and emits adjacent runs without collapsing — fixes **a****b** → **ab** drift. Remove 05-emphasis.md from acceptableDrift allowlist once green. Addresses the last round-trip allowlist entry."
    parallel: true
    depends-on: [g0-router-flag, g1-typography-theme, g2-code-prism, g5-image-resolver, g8-diff-branch, g10-history-modal]
```
