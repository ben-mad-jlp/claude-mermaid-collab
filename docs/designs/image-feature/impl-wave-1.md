# Wave 1 Implementation

## Tasks
- **backend-types-config**: Added `Image`, `ImageMeta`, `ImageListItem` interfaces to `src/types.ts` after `EmbedListItem`. Added `MAX_IMAGE_SIZE` (50 MB) and `ALLOWED_IMAGE_MIME_TYPES` (readonly tuple of 7 MIME types) to the `config` object in `src/config.ts`, preserving `as const`.
- **frontend-types**: Created `ui/src/types/image.ts` with the `Image` interface. Added `export * from './image';` to `ui/src/types/index.ts`. Extended `ui/src/types/item.ts` with `'image'` in 7 places: `ItemType` union, `isItemType`, new `isImage` type guard, and the `getItemLabel` / `getItemIconPath` / `getItemColor` / `getItemColorValue` records (yellow / #eab308).
- **session-registry**: Added `'images'` to the `resolvePath` type union and validation in `src/services/session-registry.ts`; added a `mkdir .../images` call in `register()`.

## Verification
- Backend `tsc`: clean (pre-existing test-runner errors unrelated).
- UI `tsc`: 3 exhaustive-match errors introduced by widening `ItemType` to include `'image'`:
  - `ui/src/App.tsx:950` — typeMap literal missing `image` key
  - `ui/src/App.tsx:1377` — itemType prop narrower
  - `ui/src/components/layout/ItemCard.tsx:290` — `getItemIcon(item.type)` narrower
- These will be fixed as part of the Wave 4 `frontend-sidebar-integration` task (extended scope).
- Tasks `backend-types-config`, `frontend-types`, `session-registry` marked completed.
