# Wave 5 Implementation (Cleanup)

## Task completed

- **cleanup-flags-rename** — Removed `VITE_SIDEBAR_TREE`/`VITE_SIDEBAR_TABS` flag guards everywhere:
  - `Sidebar.tsx`: deleted legacy false-branch (Tasks, Blueprints, SessionTodos, Embeds, Images, Code Files, Items list, FileBrowserDialog, ConfirmDialogs). Kept Vibe Instructions + SubscriptionsPanel + `<ArtifactTree/>`.
  - `App.tsx`: unconditional `<PinnedTabBar/>` + `<TabBar/>`.
  - `ArtifactTree.tsx`: unconditional openPreview/openPermanent.
  - Mobile: renamed `PreviewTab.tsx` → `MobilePreviewTab.tsx` and updated all importers + test files (index.ts, MobileLayout.tsx).

## Verification

- Typecheck: no new errors in wave 5 files (pre-existing onboarding errors unrelated)
- MobilePreviewTab tests 38/38 pass
- No leftover flag references in source (docs retain historical mentions)
- Broader test-suite failures observed are pre-existing (getSelectedDesign hook issue, artifactTreeSelectors drift, getActionsForNode label mismatch, SubscriptionsPanel selector failures) — none reside in wave 5 files

## Next
- Blueprint complete (21/21 tasks)
- Outstanding pre-existing test failures should be triaged before shipping
- User will view & review the UI at http://localhost:9102
