# Wave 3 Implementation — Unified Split-Pane UX

## Tasks Completed
- **split-editor-host-wire**: SplitEditorHost rewritten to resolve left/right tabs from tabsStore via useSessionTabs, dispatch via PaneContent, use flat tabsStore API (`pinTabRight` / `unpinTabRight` / flat `reorderTabs(ids)`). Created `RightPaneCloseButton` overlay (hover-reveal, top-right of right pane). `leftItem`/`rightItem` props remain in interface (marked `@deprecated`) for App compat during wave 4.

## Fix Loop
- Fix 1: `activePaneId` lives on `SessionTabsState` (per-session entry), not on `TabsStoreShape` root — read via `sessionTabs.activePaneId` instead.
- Fix 2 (regression recovery): ImageViewer was never actually modified in Wave 1 despite the agent reporting "done"; re-applied the `ImageViewerProps` interface (imageId/project/session props with fallback) and restored PaneContent's call to pass them.

## Verification
- Zero errors in wave 3 scope (SplitEditorHost, PaneContent, ImageViewer, RightPaneCloseButton, tabsStore, TabBar, PinnedTabBar, SplitTabBar, hooks).
- App.tsx errors remain — wave 4 scope.
