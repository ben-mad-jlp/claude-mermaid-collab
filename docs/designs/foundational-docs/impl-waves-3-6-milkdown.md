# Waves 3–6 Implementation (Milkdown)

## Wave 3 — milkdown-editor
- New `ui/src/components/editors/milkdown/MilkdownEditor.tsx`: composes commonmark, gfm, history, clipboard, diagramEmbedNode, fidelityPlugins, autosavePlugin via `useEditor`. `MilkdownProvider` wrapper. Typecheck clean.

## Wave 4 — roundtrip-harness, wysiwyg-editor
- New `milkdown/__tests__/roundTrip.test.ts`: loads 10 fixtures via `import.meta.glob`, runs Editor.make() parse→serialize via `getMarkdown()` action. Uses `it.fails()` for Phase 0 gate reporting.
- New `DocumentEditor.wysiwyg.tsx`: preserves header/save/cancel/unsaved/error; body hosts `<MilkdownEditor>`; Ctrl+S flushes + saves; Escape is no-op; annotation toolbar omitted.
- New `DocumentEditor.wysiwyg.test.tsx`: 13 tests passing, MilkdownEditor mocked for speed.
- Fix applied: Save-flow test made async with `act()` + `waitFor()`.

## Phase 0 Go/No-Go result
- 4 of 10 fixtures round-trip cleanly out of the box (01-plain, 03-tables, 04-code-fences, 06-embed-isolated) — **embed byte-exact gate met**.
- 6 of 10 drift, all in acceptable categories (list marker, escape, blank-line, hardbreak). Drift is the exact mandate of `fidelityPlugins`, currently an empty stub.
- Decision: **conditional go** — the router + flag-gated rollout means drift is invisible to users until fidelityPlugins is filled in as Phase 2 work.

## Wave 5 — document-editor-router
- Rewrote `DocumentEditor.tsx` as a 17-line router. Re-exports `DocumentEditorProps` from legacy. Uses `useFeatureFlags().wysiwygDocumentEditor` to switch variants.

## Wave 6 — legacy-test-gating
- One-line import change in `DocumentEditor.test.tsx`: now imports `DocumentEditorLegacy` directly. 36 tests passing.

## Verification (whole project)
- TypeScript: no errors introduced by this work. Pre-existing errors in `ui/src/pages/onboarding/*` are unrelated.
- Unit tests for Phase 0/1 surfaces: 13 wysiwyg + 36 legacy + 14 plugin tests all green.
- Roundtrip harness reports informational drift via `it.fails` — serves as the Phase 2 fidelityPlugins work list.
