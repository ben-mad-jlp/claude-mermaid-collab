# WYSIWYG Markdown Editor Research

## Recommendation

**Milkdown** (built on ProseMirror + remark). One-line justification: it is the only mature option that treats markdown as the source of truth with a ProseMirror round-trip, has first-class React bindings, and exposes a remark plugin slot.

Runner-up: **TipTap + tiptap-markdown**. Easier API, bigger community, but markdown is a lossy serializer (attributes drift on round-trip).

Dismissed:

- **Lexical** — WYSIWYG-capable but markdown round-trip fidelity is the weakest of the group.
- **Remirror** — ProseMirror-based like Milkdown but maintenance has slowed.
- **Raw ProseMirror + prosemirror-markdown** — most flexible, but we'd be rebuilding Milkdown.

## Current State

- `DocumentEditor.tsx` (541 lines): split pane — `CodeMirrorWrapper` (left) + `MarkdownPreview` (right).
- Persistence: `useDocument()` hook → `updateDocument(id, { content, lastModified })`. Debounced at 300ms.
- Embeds: `{{diagram:id}}` / `{{design:id}}` expanded by `remarkDiagramEmbeds.ts` into `image` nodes.
- Tests: `DocumentEditor.test.tsx` (597 lines) asserts split pane, save/cancel, keyboard shortcuts.
- Stack: React 18.2, Vite 5, Vitest 0.34, TypeScript 5.3.

## Effort Estimate

Total: ~8–10 dev-days across spike, dep install, editor replacement, embed plugin port, annotation toolbar rewrite, test rewrite, and mobile QA.
