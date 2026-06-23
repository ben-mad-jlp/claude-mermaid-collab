# Wave 1 Implementation (Milkdown)

## Tasks completed
- **deps-install** — Added 7 @milkdown/* + 2 prosemirror-* packages to ui/package.json; `npm install` succeeded (266 packages added).
- **feature-flags** — New `ui/src/config/featureFlags.ts` exporting `useFeatureFlags()` → `{ wysiwygDocumentEditor }`; localStorage-backed (`ff.wysiwygDocumentEditor`), SSR-safe.
- **embed-bridge** — New `ui/src/lib/milkdownEmbedBridge.ts` exporting `EMBED_RE` and `resolveEmbedSrc(kind, refId, project, session, theme)` mirroring `MarkdownPreview.resolveImageSrc`.
- **legacy-copy** — New `DocumentEditor.legacy.tsx` (540 lines); 2 renames only (export const + export default → `DocumentEditorLegacy`); `DocumentEditorProps` preserved.
- **serializer-config** — New `ui/src/components/editors/milkdown/serializerConfig.ts` Phase 0 stub exporting empty `fidelityPlugins`; real overrides deferred until round-trip data lands.
- **roundtrip-fixtures** — 10 fixtures at `__fixtures__/roundtrip/`; 01-plain, 02-lists, 03-tables, 04-code-fences, 05-emphasis, 06-embed-isolated ({{diagram:abc123}}), 07-embed-in-list ({{design:img-42}}), 08-nested-lists, 09-hardbreaks, 10-real-doc (copied from `docs/designs/brave-light-harbor/interface-item-1.md`).

## Verification
- TypeScript: no errors in wave-1 files
- All 10 fixtures present
- Legacy rename confirmed (2 occurrences)
- `@milkdown/core` present in package.json
