# Design: Milkdown WYSIWYG Migration for DocumentEditor

Companion to `research-wysiwyg-markdown`. Milkdown is chosen — this doc is the build plan.

## Goals and non-goals

Goals: replace the split-pane (CodeMirror source + rendered preview) in `DocumentEditor.tsx` with an inline WYSIWYG markdown surface; preserve the existing 300/500ms debounced persistence through `updateDocument`; preserve `{{diagram:id}}` / `{{design:id}}` embeds as first-class editable blocks; preserve annotation workflows; be shippable behind a feature flag with zero-risk fallback to the existing editor.

Non-goals: collaborative editing (Yjs), outline / minimap parity on day one, click-to-source (obsolete in unified view), touch-optimised table editing, replacing `CodeMirrorWrapper` in `CodeEditor` / `SnippetEditor`.

## Architecture

### Core vs Crepe

Use **Milkdown Core** (`@milkdown/core` + `@milkdown/react` + presets), not **Crepe**. Rationale:

- Crepe bundles Tailwind-conflicting styles and a slash-command/block-handle UX that we'd fight for our own header/annotation toolbar.
- Core gives us explicit plugin registration.
- Round-trip fidelity control is harder to tune with Crepe.

Trade-off: we reimplement a few Crepe niceties ourselves. Phase 1 ships without them; Phase 3 adds a thin toolbar.
