# Wave 3 Implementation

## Tasks completed (2)

- **artifact-tree** — `ArtifactTree.tsx` top-level tree; header (search + show-deprecated + Upload); root drop target → importArtifact; sections in canonical order wired to sidebarTreeStore; right-click → SidebarNodeContextMenu. Heavy confirm-dialog/email/download handlers are stubbed for sidebar-integration wave.
- **tab-bars-mount** — App.tsx mounts PinnedTabBar + TabBar above EditorToolbar in both task-graph and main-editor branches, gated by `VITE_SIDEBAR_TABS` env flag.

## Verification
- Typecheck: clean for wave 3 files (pre-existing onboarding errors unrelated)
- Tests: ArtifactTree 4/4 pass; wave 2 tests still green
- Pre-existing wave-1 test drift in `artifactTreeSelectors.test.ts` and `getActionsForNode.test.ts` noted; not regressed by wave 3

## Fix applied mid-wave
- `artifactTreeSelectors.ts` — added `id: string` to `selectBlueprintNodes` generic constraint
