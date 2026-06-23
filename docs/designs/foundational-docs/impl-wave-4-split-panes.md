# Wave 4 Implementation — Split Tab Panes

## Tasks
- **split-editor-host** — new `SplitEditorHost.tsx` owns a single `DndContext` wrapping `SplitTabBar` + `SplitPane(UnifiedEditor|EmptyPane)` + `EditorAreaDropZones`. Exports `buildDragEndHandler(deps)` for unit testing; handler routes drops on `editor-half-*` zones to `moveTabBetweenPanes` and intra-pane sortable drops through `arrayMove + reorderTabs(ids, pane)`. Uses `sessionKey()` + current session to read pane snapshots from the store.
- **Dependent edit: TabBar.tsx** — removed inner `DndContext` / sensors / local `handleDragEnd`; threaded `pane` into `SortableTab` and enriched `useSortable({ id, data: { tab, pane } })` so the ancestor DndContext can route drops.

## Verification
- `SplitEditorHost.test.tsx`: 6/6 passed.
- Regressions (SplitTabBar, tabsStore.panes, EditorAreaDropZones): 17/17 passed.
- Scoped tsc clean for both SplitEditorHost.tsx and TabBar.tsx.
