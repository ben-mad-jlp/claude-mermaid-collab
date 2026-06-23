# Wave 2 Implementation — Split Tab Panes

## Tasks
- **tab-bar-pane** — `TabBar.tsx` and `PinnedTabBar.tsx` now accept a required `pane: PaneId` prop; read tabs/activeTabId from `session.panes[pane]`; thread pane through `setActive`, `closeTab`, `pinTab`, `unpinTab`, `promoteToPermanent`, `reorderTabs`. Added `data-pane` on root for testability.
- **editor-drop-zones** — new `EditorAreaDropZones.tsx` with two 50%-width `useDroppable` overlays keyed by `editor-half-left`/`editor-half-right`; gated `pointer-events` via `useDndMonitor` drag state; accent highlight on isOver. 4 tests pass.

## Verification
- `EditorAreaDropZones.test.tsx`: 4/4 passed (29ms).
- tsc on the three source files: clean. Full-project tsc still fails on App.tsx — expected, resolved in Wave 5.
