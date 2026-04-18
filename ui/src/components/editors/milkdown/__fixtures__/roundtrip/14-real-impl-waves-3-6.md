# Waves 3–6 Implementation (Milkdown)

## Wave 3 — milkdown-editor

- New `MilkdownEditor.tsx`: composes commonmark, gfm, history, clipboard, diagramEmbedNode, fidelityPlugins, autosavePlugin.

## Wave 4 — roundtrip-harness, wysiwyg-editor

- New `roundTrip.test.ts`: loads 10 fixtures via `import.meta.glob`, runs parse→serialize.
- New `DocumentEditor.wysiwyg.tsx`: preserves header/save/cancel.

## Phase 0 Go/No-Go result

- 4 of 10 fixtures round-trip cleanly.
- 6 of 10 drift, all in acceptable categories.
- Decision: **conditional go** — flag-gated rollout.

## Wave 5 — document-editor-router

- Rewrote `DocumentEditor.tsx` as a 17-line router.

## Wave 6 — legacy-test-gating

- One-line import change in `DocumentEditor.test.tsx`.
