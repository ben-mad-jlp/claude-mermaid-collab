# Wave 5 Implementation

## Tasks
- **session-store-cleanup** — removed `selectedEmbedId`, `selectedImageId`, `selectedPseudoPath`, `taskGraphSelected` from SessionState + initialState; removed actions `selectEmbed`, `selectImage`, `selectPseudoPath`, `selectTaskGraph`, `clearTaskGraphSelection`; removed legacy getter pair `getSelectedEmbed`/`getSelectedImage`; purged the field resets from setCurrentSession/clearSession and all select* artifact actions. Updated consumers:
  - `ArtifactTree.tsx` → reads active tab from tabsStore via `useSessionTabs`; `openNode` no longer fires the legacy `select*` calls; `isSelected` branches on active tab kind/artifactType.
  - `TabBar.tsx` / `PinnedTabBar.tsx` → removed no-op `selectEmbed`/`selectPseudoPath`/`selectTaskGraph`/`selectImage` calls in `activateTab`.
  - `ImageViewer.tsx` → falls back to tabsStore active tab (`artifact` / `image`) for `effectiveImageId` instead of `selectedImageId`.
  - Tests: `sessionStore.test.ts` (dropped Task Graph Selection describe block + property/method assertions), `ArtifactTree.test.tsx` / `ArtifactTree.clicks.test.tsx` (removed legacy mock fields/spies), `Sidebar.test.tsx` (removed task-graph-select tests + mock fields).

- **toolbar-tab-aware** — App.tsx: derived active left-pane tab via `useTabsStore((s) => s.bySession[sessionKey(project, name)])`, computed `showToolbar = activeTab?.kind === 'artifact' && activeTab.artifactType !== 'image'`, gated `<EditorToolbar ... />` on it. Hides toolbar for task-graph / embed / code-file / image. `EditorToolbar.tsx` itself unchanged (already prop-driven).

## Verification
- tsc: no new errors in wave-5 files. Pre-existing errors in Section/CollapsibleDetails/SplitPane/legacy pages are out of scope.
- Grep: no residual references to the removed names in `ui/src/`.

## Fix loop
- One iteration: initial verify flagged `getSelectedEmbed`/`getSelectedImage` still referencing removed fields; fix agent removed both (no callers existed). Second verify clean.
