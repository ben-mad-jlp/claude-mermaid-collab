# Wave 4 Implementation

## Task
- **frontend-sidebar-integration** (scope extended with carry-forward fixes):
  - **Sidebar.tsx** — Added `images`/`selectedImageId`/`selectImage`/`removeImage` to the store destructure. Added `imagesCollapsed` and `dragOver` state. Added `image` branches to `handleConfirmDeleteItem` and `handleItemClick`. Added three drag handlers (`handleDragOver`, `handleDragLeave`, `handleDrop`) that call `importArtifact` per dropped file. Added a new Images section in the JSX mirroring the Embeds section. Attached drop handlers to the scrollable items list container with a ring/background highlight when dragging over.
  - **App.tsx** — Fixed `typeMap` exhaustive-match (added `image: 'update_image'`). Fixed `itemType` prop on EditorToolbar (pass `undefined` when selected item is an image, since the ImageViewer owns its own UI).
  - **ItemCard.tsx** — Widened `getItemIcon` parameter type to include `'image'` and added an image icon SVG case (rounded rect + circle + mountain path).

## Verification
- UI tsc: clean in all 3 edited files.
- All 3 previously-known carry-forward errors resolved.
- Only remaining tsc errors are pre-existing (`ui/src/pages/onboarding/*`, backend test files) — unrelated.
- Task marked completed.
