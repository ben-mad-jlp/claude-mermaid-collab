# Wave 1 Implementation — Unified Split-Pane UX

## Tasks Completed
- **store-refactor + promote-tab-kinds** (consolidated — same file): rewrote `ui/src/stores/tabsStore.ts` to single-list shape `{ tabs, activeTabId, rightPaneTabId, activePaneId }`. Added `pinTabRight`, `unpinTabRight`, `closeRightPane`. `moveTabBetweenPanes` + `setActivePaneId` kept as deprecated shims. Persist bumped to v3 (wipe-migrate). `useSessionTabs()` now returns `SessionTabsViewCompat` synthesizing `panes.left` / `panes.right` so downstream callers keep compiling. TabKind / TabArtifactType already covered all required members — no additions.
- **image-viewer-prop**: `ImageViewer` now accepts optional `imageId`, `project`, `session` props with fallback to sessionStore (`effectiveImageId` / `effectiveProject` / `effectiveSession`).

## Verification
- TypeScript clean inside impacted files aside from the expected "Expected 1 arguments, got 2" errors at pane-param call sites (SplitEditorHost, TabBar, PinnedTabBar, App, plus direct-state consumers `hooks/useEditorAutoPromote.ts` and `hooks/useTabKeyboard.ts`). These are resolved in Wave 2+.
- Pre-existing unrelated errors (SplitPane, pseudo pages, DocumentEditor.legacy, etc.) untouched.

## Follow-ups Surfaced
- `useEditorAutoPromote` and `useTabKeyboard` read `.panes` directly from raw store state — should migrate to `useSessionTabs()` during Wave 2 tabbar work or track separately.
