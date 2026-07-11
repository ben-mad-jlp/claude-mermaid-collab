# Wave 2 Implementation

## Tasks
- **backend-image-manager**: Created `src/services/image-manager.ts` with ImageManager class following the EmbedManager pattern. Binary files stored at `{id}.{ext}`, metadata at `{id}.meta.json` sidecars. MIME validation uses `config.ALLOWED_IMAGE_MIME_TYPES`, size validation uses `config.MAX_IMAGE_SIZE`. Methods: initialize, create, list, get, getContent, delete, hasImage, reset.
- **frontend-store**: Added `images` + `selectedImageId` state to `sessionStore.ts` with 6 actions (setImages, addImage, selectImage, updateImage, removeImage, getSelectedImage). Added image reset to setCurrentSession, clearSession, and all 7 select* actions.
- **frontend-api-client**: Added `createImage` (multipart FormData), `listImages`, `deleteImage` methods to api.ts with matching ApiClient interface signatures.
- **frontend-import-artifact**: Widened ArtifactType to include `'image'`, added IMAGE_EXTS set, added image extension detection in detectType, added image branch in importArtifact that posts multipart FormData to `/api/image`. Hoisted `detectType` call above `file.text()` so binary files aren't read as text.

## Verification
- Backend tsc: clean in changed files.
- UI tsc: clean in changed files; only the 3 known carry-forward exhaustive-match errors from Wave 1 remain (App.tsx:950, App.tsx:1377, ItemCard.tsx:290) — scheduled to be fixed in Wave 4.
- Tasks marked completed: all 4.
