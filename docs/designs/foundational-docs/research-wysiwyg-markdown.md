# WYSIWYG Markdown Editor Research

## Recommendation

**Milkdown** (built on ProseMirror + remark). One-line justification: it is the only mature option that treats markdown as the source of truth with a ProseMirror round-trip, has first-class React bindings, and exposes a remark plugin slot — which is exactly where our existing `{{diagram:id}}` / `{{design:id}}` embed handling already lives (`ui/src/lib/remarkDiagramEmbeds.ts`), so the custom-node cost collapses to reusing an existing plugin.

Runner-up: **TipTap + tiptap-markdown**. Easier API, bigger community, but markdown is a lossy serializer (attributes drift on round-trip, GFM tables/task-lists need extra extensions), and custom marks for our `{{embed}}` syntax must be re-implemented from scratch.

Dismissed:
- **Lexical (@lexical/markdown)** — WYSIWYG-capable but markdown round-trip fidelity is the weakest of the group (block-level only, inline extensions limited); Meta-driven, churny API.
- **Remirror** — ProseMirror-based like Milkdown but maintenance has slowed and React integration is heavier.
- **Raw ProseMirror + prosemirror-markdown** — most flexible, but we'd be rebuilding Milkdown.

## Current State

- `ui/src/components/editors/DocumentEditor.tsx` (541 lines): split pane — `CodeMirrorWrapper` (left) + `MarkdownPreview` (right).
- Persistence: `useDocument()` hook → `updateDocument(id, { content, lastModified })`. Debounced at 300ms (`debounceDelay` prop) in `handleContentChange`; explicit save via Ctrl+S → `handleSave`.
- Embeds: `{{diagram:id}}` / `{{design:id}}` expanded by `ui/src/lib/remarkDiagramEmbeds.ts` into `image` nodes with `@diagram/id` URLs, resolved at render time. Only used in preview today.
- Collaboration features tightly coupled to CodeMirror `EditorView`:
  - `AnnotationToolbar` (CM6 commands)
  - `Minimap` (reads scroll offset from CM scroll container)
  - `useSyncScroll` (line-mapped editor<->preview)
  - Click-to-source from preview → `editorView.dispatch({ selection })`
  - Diff view (`showDiff`) against `previousContent`
  - HistoryModal
- Tests: `DocumentEditor.test.tsx` (597 lines) asserts split pane, save/cancel buttons, keyboard shortcuts, debounce, annotation toolbar presence.
- Stack: React 18.2, Vite 5, Vitest 0.34, TypeScript 5.3. No existing rich-text lib. Already has `@codemirror/*`, `react-markdown`, `remark-gfm`, `rehype-raw`.

## Effort Estimate

| Phase | Scope | Estimate |
|---|---|---|
| Spike + dep install | Add `@milkdown/core @milkdown/react @milkdown/preset-commonmark @milkdown/preset-gfm @milkdown/plugin-listener`; prove round-trip on sample doc | 0.5 day |
| Replace editor pane | New `WysiwygDocumentEditor` wrapping Milkdown `<Editor>`, wire `onChange` to existing `handleContentChange` debounce | 1 day |
| Port embed plugin | Convert `remarkDiagramEmbeds` into a Milkdown node (parser + serializer + React view for inline artifact render) | 1.5 days |
| Annotation toolbar | Rewrite `AnnotationToolbar` against ProseMirror commands (bold/italic/list/heading); annotations currently use CM6 decorations — needs ProseMirror marks | 1–2 days |
| Sync scroll / minimap / click-to-source | Remove or replace — no editor/preview split anymore; minimap drives a single DOM scroller | 1 day |
| Diff view | Keep `react-diff-viewer-continued` on serialized markdown; trigger is still source-level | 0.5 day |
| Tests rewrite | `DocumentEditor.test.tsx` is 597 lines and selector-heavy; at least 60% of assertions (split pane, CM value, annotation selectors) break | 1.5 days |
| Mobile QA + paste/keyboard polish | Touch selection, IME, paste-from-Word, paste image | 1 day |
| **Total** | | **~8–10 dev-days** |

## Files Touched (primary)

- `ui/src/components/editors/DocumentEditor.tsx` — rewrite
- `ui/src/components/editors/CodeMirrorWrapper.tsx` — likely retained for `SnippetEditor`/`CodeEditor`, unchanged
- `ui/src/components/editors/AnnotationToolbar.tsx` — rewrite against PM
- `ui/src/components/editors/Minimap.tsx` — rewire scroll source
- `ui/src/components/editors/MarkdownPreview.tsx` — no longer needed in editor view (keep for preview-only surfaces)
- `ui/src/lib/remarkDiagramEmbeds.ts` — refactor into Milkdown node schema
- `ui/src/hooks/useSyncScroll.ts` — delete / disable in doc editor
- `ui/src/components/editors/__tests__/DocumentEditor.test.tsx` — largely rewritten
- `ui/package.json` — +5 Milkdown packages (~180 KB min+gzip ProseMirror+Milkdown core)

## Risks / Blockers

1. **Markdown round-trip fidelity** (medium-high). Users expect `git diff`-clean files. ProseMirror normalizes whitespace, emphasis markers (`_` vs `*`), list indentation, and fenced-code info strings. Even Milkdown drifts on these. Mitigation: run a golden-file test suite against real docs before committing.
2. **Embed custom node** (medium). Must support parse (markdown → node), serialize (node → `{{diagram:id}}`), and render (inline React component with live artifact). Getting the serializer to emit exact source is the trickiest piece.
3. **Annotation system** (medium). Current annotations are CM6 decorations layered on markdown source. WYSIWYG hides the source — the annotation mental model changes. May need to keep annotations in a sidecar store keyed by block, or defer annotations to a "source mode" toggle (which the user explicitly rejected).
4. **Click-to-source from preview** (low) — obsolete once unified.
5. **Paste behavior** (medium). ProseMirror paste rules are flexible but paste from Google Docs / Word produces inline styles; need explicit sanitizers.
6. **Mobile UX** (medium). ProseMirror mobile caret handling is better than CodeMirror, but table editing on touch is universally painful.
7. **Collaborative editing path** (low now, high later). If Yjs/CRDT is on the roadmap, Milkdown + y-prosemirror is the clean path; TipTap has `@tiptap/extension-collaboration` out of the box.

## Blocker-level Flag

The **annotation system** is the single item that could kill this. If annotations must continue to round-trip through markdown source comments, the WYSIWYG layer has to preserve unknown inline syntax verbatim — which neither Milkdown nor TipTap do out of the box. Before committing to the migration, verify the annotation format and decide whether annotations move to a sidecar (recommended) or require a custom PM mark (adds ~2 days).

## Go / No-Go

**Conditional Go.** Greenlight if:
1. Annotation format can be moved to a sidecar store (not embedded in markdown source), AND
2. A one-day spike confirms acceptable round-trip diff on 5 real project docs containing tables, nested lists, and `{{embed}}` references.

Otherwise, **No-Go** — keep the split pane. The WYSIWYG win is real for casual editors but does not justify breaking annotation fidelity for power users.
