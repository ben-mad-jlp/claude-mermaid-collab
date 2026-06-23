# Completeness review: bp-milkdown-parity (Wave 2 + Wave 3)

Scope: verify G0–G12 against the blueprint. Excludes acknowledged TODOs
(g7 `updateDocument` metadata wiring, g7 CSS for `.annotation-*`, g9 strong-mark drift allowlist).

## Files & wiring — all present

- `ui/src/components/editors/DocumentEditor.tsx` — real 30-line router reading `useFeatureFlags().wysiwygDocumentEditor`, with telemetry-like console.info on variant mount. Not stub.
- `ui/src/components/editors/DocumentEditor.wysiwyg.tsx` — diff branch, history button, annotations toolbar, migrator wiring, CollapsibleSectionsProvider all in place.
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` — registers codeBlockPrismPlugin, rawDetailsRemarkPlugin+detailsNode+DetailsView, headingCollapse (plugin+NodeView), imageResolverView, annotations plugin, telemetry emits on mount + autosave. autosaveDelay captured via ref (I4).
- `ui/src/components/editors/milkdown/milkdown-prose.css` — theme present.
- `ui/src/components/editors/milkdown/serializerConfig.ts` — list_item `checked` attr wired (G6), orderedListMarker + bulletListMarker schemas present.
- `ui/src/components/editors/milkdown/plugins/rawPositions.ts` — ±2 window fix (M2) in place.
- `ui/src/components/editors/milkdown/plugins/{codeBlockPrism,imageResolver,headingCollapse,rawDetails,telemetry}.ts(x)` — all real, non-stub.
- `ui/src/components/editors/milkdown/plugins/annotations/{schema,anchor,decoration,toolbar,migrator}.ts(x)` — all real.
- `ui/src/lib/resolveImageSrc.ts` — present.
- `src/services/document-metadata.ts` — present with validator, header comment explicitly notes it is a stub pending document-manager wiring (matches orchestrator-acknowledged TODO for g7 persistence).
- Fixtures `15-tasklist.md`, `16-raw-details.md` — present.
- Roundtrip test still allowlists `05-emphasis.md` — matches deferred g9.

## Gaps found

### G1 (theme)
- **Missing test file**: blueprint lists `ui/src/components/editors/milkdown/__tests__/theme.test.tsx` — does not exist. The wave-2 impl summary says theme was "already present" so it may have been skipped intentionally, but the blueprint acceptance criteria included a theme test.

### G6 (task list)
- **Missing test file**: blueprint lists `ui/src/components/editors/milkdown/__tests__/taskList.roundtrip.test.ts` — does not exist. Task-list round-trip is covered indirectly through `roundTrip.test.ts` picking up `15-tasklist.md` via `import.meta.glob`, so behavior is still tested — but the dedicated test file the blueprint calls for was not created.

### G7 (annotations)
- **Missing 3 of 4 annotation test files** (only `migrator.test.ts` exists at `plugins/annotations/__tests__/`). Blueprint required:
  - `__tests__/annotations/schema.test.ts` — missing
  - `__tests__/annotations/anchor.test.ts` — missing
  - `__tests__/annotations/decoration.test.tsx` — missing
  - `__tests__/annotations/migrator.test.ts` — present (but under `plugins/annotations/__tests__/migrator.test.ts`, not the blueprint path — functionally fine).
- Given `anchor.ts` implements FNV-1a checksum + `resolveAnchor` position resilience, and `decoration.ts` builds a PM plugin, the absence of targeted unit tests for those means those code paths are exercised only through the toolbar/migrator flow. This is a real coverage gap on the largest task in the blueprint.

### Not gaps (verified non-issues)
- No `TODO`/`Not implemented`/`FIXME` stubs in Wave-2/3 scope beyond a pre-existing `it.skip('…TODO Phase 1 integration', …)` in `plugins/__tests__/diagramEmbed.test.ts` (outside Milkdown-parity scope).
- `DocumentEditor.wysiwyg.tsx` contains only the orchestrator-acknowledged note about parking annotations on `window.__pendingAnnotations` — no other stubs.
- All named exports in Section 2 of blueprint are present with matching signatures (spot-checked `emitTelemetry`/`nowMs`, `headingCollapsePlugin`/`headingCollapseNodeView`, `imageResolverView`, `Annotation` type, `validateDocumentMetadata`).

## Gap count: 5

1. `__tests__/theme.test.tsx` missing (G1).
2. `__tests__/taskList.roundtrip.test.ts` missing (G6 — behavior covered transitively via roundTrip fixture glob, but dedicated test not created).
3. `__tests__/annotations/schema.test.ts` missing (G7).
4. `__tests__/annotations/anchor.test.ts` missing (G7) — real logic uncovered.
5. `__tests__/annotations/decoration.test.tsx` missing (G7) — real logic uncovered.

All gaps are missing test files; no production source stubs were found.
