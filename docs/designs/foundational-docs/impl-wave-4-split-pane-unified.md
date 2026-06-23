# Wave 4 Implementation — app-integration

## Tasks
- **app-integration** (App.tsx, ArtifactTree.tsx)
  - App.tsx: removed `selectedEmbedId`, `selectedImageId`, `selectedPseudoPath`, `taskGraphSelected` from the useSessionStore destructure and useShallow selector; kept `embeds/images/addEmbed/removeEmbed/addImage/removeImage` (websocket + handleDeleteEmbed still consume them). Deleted the `selectedEmbedId` and `selectedImageId` branches in `selectedItem` useMemo and dropped them from the dep array.
  - ArtifactTree.tsx: removed the unused `openPreview` selector; `handleNodeClick` and `renderSection` onClick now always call `openPermanent(d)` — no more preview/permanent branching. `openNode`, `toTabDescriptor`, and double-click handler untouched.

## Verification
- Grep: App.tsx has no remaining references to the four selection globals; ArtifactTree.tsx has no `openPreview` references.
- `tsc --noEmit`: clean for App.tsx and ArtifactTree.tsx. Pre-existing errors in Section.tsx, CollapsibleDetails.tsx, SplitPane.tsx, DocumentEditor.legacy.tsx, onboarding/pseudo pages are out of scope.

## Notes
- Fix loop: one iteration. First verify caught a stale `taskGraphSelected` still in the destructure; fix agent removed it; second verify passed.
- Session store cleanup itself is deferred to Wave 5 (session-store-cleanup).
