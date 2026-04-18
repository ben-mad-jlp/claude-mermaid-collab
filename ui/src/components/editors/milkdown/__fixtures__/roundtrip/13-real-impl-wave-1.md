# Wave 1 Implementation (Milkdown)

## Tasks completed

- **deps-install** — Added 7 @milkdown/* + 2 prosemirror-* packages to ui/package.json.
- **feature-flags** — New `featureFlags.ts` exporting `useFeatureFlags()` → `{ wysiwygDocumentEditor }`.
- **embed-bridge** — New `milkdownEmbedBridge.ts` exporting `EMBED_RE` and `resolveEmbedSrc(kind, refId, project, session, theme)`.
- **legacy-copy** — New `DocumentEditor.legacy.tsx` (540 lines); 2 renames only.
- **serializer-config** — New `serializerConfig.ts` Phase 0 stub.
- **roundtrip-fixtures** — 10 fixtures at `__fixtures__/roundtrip/`.

## Verification

- TypeScript: no errors in wave-1 files
- All 10 fixtures present
- Legacy rename confirmed (2 occurrences)
