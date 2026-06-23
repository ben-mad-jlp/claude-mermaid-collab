# Wave 2 Implementation (Milkdown)

## Tasks completed
- **diagram-embed-node** — New `milkdown/plugins/diagramEmbed.ts`: `splitTextByEmbed` helper + `$nodeSchema('diagramEmbed')` with atom block, parseDOM/toDOM, parseMarkdown/toMarkdown. Unit tests (8 passing + 1 skip TODO) for splitTextByEmbed covering edge cases (empty, plain, isolated, alternating, malformed, adjacent).
- **diagram-embed-view** — New `milkdown/plugins/diagramEmbedView.tsx`: pure React component with broken-embed fallback, iframe rendering via `resolveEmbedSrc`, click/dbl-click handlers for selection and open-in-editor.
- **autosave-plugin** — New `milkdown/plugins/autosave.ts`: `createDebounced` helper + `autosavePlugin({ onChange, onPersist, onFlushRef, delay })` factory wiring listenerCtx. Unit tests (6) cover debounce, flush, cancel, module surface.

## Fixes applied
- Removed `state.closeBlock(node)` from toMarkdown runner (not part of Milkdown 7.x `SerializerState` API). Atom block terminates tokens on its own.

## Verification
- TypeScript: clean for wave-2 files
- Tests: 13 passing + 1 skipped
