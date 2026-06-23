# Wave 3 — Milkdown Parity Implementation

## Tasks completed (4/5)

### g6-task-list ✅
- Added fixture `__fixtures__/roundtrip/15-tasklist.md`.
- Extended `list_item` schema in `serializerConfig.ts` with `checked: boolean | null` attr; wired through parseDOM/toDOM/parseMarkdown/toMarkdown so GFM task-list checkboxes round-trip.

### g3-heading-collapse ✅
- New `plugins/headingCollapse.ts` — heading NodeView (chevron + contentDOM) + PM decoration plugin that hides blocks between a collapsed heading and the next heading of equal-or-higher level.
- Bridges React state to PM via `useHeadingCollapseBridge()` (module ref + meta transaction).
- Exported `ChevronIcon` from `CollapsibleSection.tsx` for reuse.
- `DocumentEditorWysiwyg` wraps in `CollapsibleSectionsProvider` + renders `CollapsibleSectionsControls`.
- CSS rule `.ProseMirror .section-collapsed { display: none; }`.
- 4 new tests, all green.

### g4-raw-details ✅
- New `plugins/rawDetails.ts` — `remarkRawDetails` pairs `<details>`/`</details>` html siblings into a synthetic mdast node; `detailsNode` $nodeSchema serializes back to raw html; `DetailsView` renders native `<details>/<summary>`.
- Fixture `16-raw-details.md` round-trips exactly (no allowlist entry).
- 4 new unit tests, all green.

### g7-annotations ✅ (skeleton)
- New `plugins/annotations/` dir with `schema.ts`, `anchor.ts` (FNV-1a checksum, position-resilient `resolveAnchor`), `decoration.ts` (PM plugin + `setAnnotationsMeta`), `toolbar.tsx` (wysiwyg variant), `migrator.ts` (one-shot inline-comment marker stripper).
- `src/services/document-metadata.ts` schema stub (not yet wired to document-manager).
- `MilkdownEditor`: new `annotations` / `onAnnotationsChange` props, `getView()` on handle, PM plugin registered via `prosePluginsCtx`.
- `DocumentEditorWysiwyg`: migrates legacy markers on load, mounts `AnnotationToolbarWysiwyg`, stashes annotations on `window.__pendingAnnotations` pending server wiring.
- 5 new tests, all green.
- **TODOs**: `updateDocument` does not yet accept metadata — follow-up task needed to persist `annotations` server-side. No CSS yet for `.annotation-*` classes.

## Deferred

### g9-strong-mark ❗
- Drift reproduced: `**bold \`code\`**` → `**bold** **\`code\`**` because Milkdown's PM→mdast step emits two adjacent strong nodes when a strong mark spans an inlineCode child.
- Fix requires either a remark post-pass that joins adjacent strong mdast nodes whose only separator is a whitespace text node, or intervention in Milkdown's mark grouping.
- `05-emphasis.md` remains in `acceptableDrift` with explanatory note; marked as follow-up.

## Verification
- `tsc --noEmit` — zero errors in Wave 3 scope (only pre-existing onboarding-page errors remain).
- `vitest --run src/components/editors/milkdown` — 10 test files, 71 passed, 1 skipped, 1 todo.
- Roundtrip: N=16 M=16 K=0 (15-tasklist and 16-raw-details both round-trip exactly).
