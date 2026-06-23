# Wave 1 Implementation

## Tasks completed (9)
- sidebar-tree-store — `ui/src/stores/sidebarTreeStore.ts` + test
- tree-selectors — `ui/src/components/layout/sidebar-tree/artifactTreeSelectors.ts` + test
- import-artifact-forced-type — `ui/src/lib/importArtifact.ts` (extended) + test
- api-delete-embed — `ui/src/components/layout/Sidebar.tsx` (inline fetch → embedsApi.deleteEmbed)
- get-actions-for-node — `ui/src/components/layout/sidebar-tree/getActionsForNode.ts` + test
- todos-refactor — `SessionTodosSection.tsx` (forwardRef + optional collapsed/onToggle) + `TodosTreeSection.tsx` wrapper + test
- tabs-store — `ui/src/stores/tabsStore.ts` + test
- tab-component — `ui/src/components/layout/tabs/Tab.tsx` + test
- tab-context-menu — `ui/src/components/layout/tabs/TabContextMenu.tsx` + test

## Verification
- TypeScript: wave-scope clean. Pre-existing unrelated errors in `src/pages/onboarding/*` (missing API methods) remain — not this wave.
- Fix loop: 1 iteration — sidebarTreeStore had `getItem` Promise-narrowing + partialize return-type mismatch; cast fixes applied.
