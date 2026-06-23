# Blueprint: Left Sidebar Unified Tree + Tabs

## Source Artifacts
- `left-sidebar-tree-design` — unified tree + VSCode-style tab design

## 1. Structure Summary

### Files

**Phase A — Tree**
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — top-level tree container (header with search, show-deprecated toggle, Upload/Import, OS-file root drop target)
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTreeSection.tsx` — one per section; supports `headerActions` (+ button) and `dropHint` prop
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx` — generic leaf row (click/dblclick/contextmenu/keyboard)
- [ ] `ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx` — wraps SessionTodosSection, exposes imperative `revealAddInput()`
- [ ] `ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx` — right-click menu
- [ ] `ui/src/components/layout/sidebar-tree/getActionsForNode.ts` — pure actions matrix
- [ ] `ui/src/components/layout/sidebar-tree/artifactTreeSelectors.ts` — selectors + `filterTreeBySearch`
- [ ] `ui/src/stores/sidebarTreeStore.ts` — `useSidebarTreeState` (Zustand + persist)
- [ ] `ui/src/components/layout/SessionTodosSection.tsx` — refactor to accept external `collapsed`/`onToggle` + expose `revealAddInput` handle
- [ ] `ui/src/lib/importArtifact.ts` — add optional `forcedType` param
- [ ] `ui/src/lib/api.ts` — add `api.deleteEmbed` (replaces inline `fetch` in Sidebar)
- [ ] `ui/src/components/layout/Sidebar.tsx` — replace sections 3–9 with `<ArtifactTree/>`; keep VibeInstructions + SubscriptionsPanel

**Phase B — Tabs**
- [ ] `ui/src/stores/tabsStore.ts` — Zustand `persist` keyed by `${project}::${session}`
- [ ] `ui/src/components/layout/tabs/PinnedTabBar.tsx`
- [ ] `ui/src/components/layout/tabs/TabBar.tsx`
- [ ] `ui/src/components/layout/tabs/Tab.tsx`
- [ ] `ui/src/components/layout/tabs/TabContextMenu.tsx`
- [ ] `ui/src/App.tsx` — mount tab bars between app header and editor pane
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — rewire single-click → `openPreview`, double-click → `openPermanent` (behind `sidebar.tabs` flag)

**Phase C — Cleanup**
- [ ] Remove feature flags once parity confirmed
- [ ] Rename `ui/src/components/mobile/PreviewTab.tsx` to avoid naming collision

### Feature flags
- `sidebar.tree` — Phase A gate
- `sidebar.tabs` — Phase B gate (requires `sidebar.tree`)
- `sidebar.tree.searchContent` — content-match search (v2)

### Key types

```ts
// sidebarTreeStore.ts
interface SidebarTreeState {
  collapsedSections: Set<string>;
  showDeprecated: boolean;
  searchQuery: string;
  forceExpandedSections: Set<string>; // derived from search
  toggleSection(id: string): void;
  setShowDeprecated(v: boolean): void;
  setSearchQuery(q: string): void;
}

// tabsStore.ts
type TabKind = 'artifact'|'task-graph'|'task-details'|'blueprint'|'embed'|'code-file';
interface TabDescriptor {
  id: string; kind: TabKind;
  artifactType?: 'diagram'|'document'|'design'|'spreadsheet'|'snippet'|'image';
  artifactId: string; name: string;
  isPreview: boolean; isPinned: boolean; order: number; openedAt: number;
}
interface SessionTabsState { tabs: TabDescriptor[]; activeTabId: string|null; }
```

### Component interactions

- `ArtifactTree` reads from `sessionStore` (artifacts, selected*) + `sidebarTreeStore` + (Phase B) `tabsStore`.
- `ArtifactTreeSection` is presentational; calls back into `sidebarTreeStore.toggleSection`.
- Drag-drop dispatch routes through `importArtifact(forcedType?)`.
- Context menu dispatches into existing handlers lifted from `Sidebar.tsx` (delete/deprecate/pin/download/email/unlink/push/sync/rename).
- Phase B: tree clicks call `tabsStore.openPreview/openPermanent` instead of `selectXxxWithContent`; editor dirty events call `promoteToPermanent(activeTabId)`.

---

## 2. Function Blueprints

### `filterTreeBySearch(sections: TreeSection[], query: string): { visibleNodes: Set<string>, sectionsWithMatches: Set<string> }`

**Pseudocode:**
1. If `query` empty → return `{visibleNodes: all, sectionsWithMatches: all}`.
2. Lowercase query; iterate each section's leaves; match against `leaf.name` (case-insensitive substring).
3. Collect matching leaf IDs into `visibleNodes` and their parent section IDs into `sectionsWithMatches`.
4. Return both sets.

**Error handling:** none — pure function, empty input OK.
**Edge cases:** zero matches → empty sets (caller shows "No matching items"); query whitespace → treat as empty.
**Tests:** name-match/no-match, case-insensitive, multi-section, all-empty, todos text included.

### `sidebarTreeStore.setSearchQuery(q)`

**Pseudocode:**
1. Trim `q`; set `state.searchQuery`.
2. If non-empty: run `filterTreeBySearch` over currently loaded artifacts → store `sectionsWithMatches` into `forceExpandedSections`.
3. If empty: clear `forceExpandedSections`.

**Edge cases:** subscription to artifact updates must re-run filter; debounce not needed for names-only.
**Tests:** setting/clearing query updates forceExpanded; persisted collapsed survives a search.

### `importArtifact(project, session, file, opts?: { forcedType?: ArtifactType | 'code-file' })`

**Pseudocode:**
1. If `opts.forcedType`: skip `detectType` and dispatch by forced type.
2. Else call `detectType(file)` and dispatch as today.
3. If forced type is 'image' but extension is non-image → throw `WrongDropTargetError`.
4. For 'code-file' forced type: attempt linked-snippet path; if backend cannot resolve by path, fall back to regular snippet with a warning toast.

**Error handling:** surfaces wrong-type errors to caller for toast. Existing overwrite-confirm preserved.
**Tests:** image-only section rejects `.md`; forced snippet bypasses extension detection; default path unchanged.

### `tabsStore.openPreview(tab)`

**Pseudocode:**
1. Find existing tab by `id`.
2. If exists (any kind): just set `activeTabId = id`. Do not touch preview slot.
3. Else find the current preview tab: if one exists, replace it in-place with new tab (same `order`), preserving `isPreview=true`.
4. Else append new tab with `isPreview=true`, incremented `order`, `activeTabId = id`.
5. Persist.

**Edge cases:** rapid clicks burn a single preview slot; clicking the already-open permanent tab does nothing.
**Tests:** replace preview, promote-on-reopen, session-scoped isolation.

### `tabsStore.openPermanent(tab)`

**Pseudocode:**
1. If tab exists and is preview → set `isPreview=false`, activate.
2. If tab exists and permanent → activate.
3. Else append `isPreview=false`, activate.

### `tabsStore.closeTab(id)`

**Pseudocode:**
1. Find index; compute `nextActive = tabs[i+1]?.id ?? tabs[i-1]?.id ?? null`.
2. Remove tab; if it was active, `activeTabId = nextActive`.
3. Persist.

**Edge cases:** closing the last tab → `activeTabId = null`; closing a pinned tab uses same path (silent).

### `tabsStore` session switching

**Pseudocode:** subscribe to `sessionStore.currentSession`. On change:
1. Snapshot outgoing session's `SessionTabsState` into persisted map under `${project}::${session}`.
2. Load incoming session's entry (or init empty).
3. Update local store state.

**Tests:** A→B→A restores A's tabs; fresh session starts empty.

### `getActionsForNode(node, ctx): MenuAction[]`

**Pseudocode:** switch on `node.kind`; return the list per the matrix in design §4b. Missing-API items emitted as `{disabled: true, tooltip: 'Not yet supported'}`.

**Tests:** table-driven per kind; pin/unpin toggles reflect current `pinned`; blueprint deprecate includes confirm.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: sidebar-tree-store
    files: [ui/src/stores/sidebarTreeStore.ts]
    tests: [ui/src/stores/__tests__/sidebarTreeStore.test.ts]
    description: "Zustand+persist store for collapsed sections, showDeprecated, searchQuery, forceExpandedSections"
    parallel: true
    depends-on: []

  - id: tree-selectors
    files: [ui/src/components/layout/sidebar-tree/artifactTreeSelectors.ts]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/artifactTreeSelectors.test.ts]
    description: "Pure selectors: pinned, blueprints, linked snippets, catch-all; filterTreeBySearch"
    parallel: true
    depends-on: []

  - id: import-artifact-forced-type
    files: [ui/src/lib/importArtifact.ts]
    tests: [ui/src/lib/__tests__/importArtifact.test.ts]
    description: "Add optional forcedType parameter; skip detectType when set; reject mismatched extensions for type-strict sections"
    parallel: true
    depends-on: []

  - id: api-delete-embed
    files: [ui/src/lib/api.ts]
    tests: []
    description: "Move embed-delete inline fetch from Sidebar into api.deleteEmbed"
    parallel: true
    depends-on: []

  - id: get-actions-for-node
    files: [ui/src/components/layout/sidebar-tree/getActionsForNode.ts]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/getActionsForNode.test.ts]
    description: "Action matrix per node kind: artifact/blueprint/embed/code-file/task-*/todo"
    parallel: true
    depends-on: []

  - id: sidebar-node-context-menu
    files: [ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/SidebarNodeContextMenu.test.tsx]
    description: "Floating context menu (pattern from diagram/ContextMenu.tsx); dispatches MenuAction handlers"
    parallel: false
    depends-on: [get-actions-for-node]

  - id: tree-node
    files: [ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTreeNode.test.tsx]
    description: "Leaf row: icon + name + selected highlight; click/dblclick/contextmenu/keyboard"
    parallel: false
    depends-on: [get-actions-for-node]

  - id: tree-section
    files: [ui/src/components/layout/sidebar-tree/ArtifactTreeSection.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTreeSection.test.tsx]
    description: "Section header with chevron, count, headerActions slot, dropHint-driven drop target with ring outline"
    parallel: false
    depends-on: [sidebar-tree-store, import-artifact-forced-type]

  - id: todos-refactor
    files: [ui/src/components/layout/SessionTodosSection.tsx, ui/src/components/layout/sidebar-tree/TodosTreeSection.tsx]
    tests: [ui/src/components/layout/__tests__/SessionTodosSection.test.tsx]
    description: "Accept external collapsed/onToggle; expose imperative revealAddInput() handle via forwardRef; new TodosTreeSection wrapper"
    parallel: true
    depends-on: []

  - id: artifact-tree
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.test.tsx]
    description: "Top-level tree; header (search, show-deprecated, Upload/Import); root drop target; ordered sections (Pins→Tasks→Blueprints→Todos→Embeds→Images→Code Files→Diagrams→Documents→Designs→Spreadsheets→Snippets)"
    parallel: false
    depends-on: [tree-section, tree-node, tree-selectors, todos-refactor, sidebar-node-context-menu, api-delete-embed]

  - id: sidebar-integration
    files: [ui/src/components/layout/Sidebar.tsx]
    tests: [ui/src/components/layout/__tests__/Sidebar.test.tsx]
    description: "Render VibeInstructions + SubscriptionsPanel + ArtifactTree (behind sidebar.tree flag); delete legacy sections 3–9"
    parallel: false
    depends-on: [artifact-tree]

  - id: tabs-store
    files: [ui/src/stores/tabsStore.ts]
    tests: [ui/src/stores/__tests__/tabsStore.test.ts]
    description: "Zustand+persist tab store keyed by ${project}::${session}; openPreview/openPermanent/promoteToPermanent/pinTab/unpinTab/closeTab/reorderTabs/setActive; session-switch save/hydrate"
    parallel: true
    depends-on: []

  - id: tab-component
    files: [ui/src/components/layout/tabs/Tab.tsx]
    tests: [ui/src/components/layout/tabs/__tests__/Tab.test.tsx]
    description: "Single tab chip: icon, name, close button, italic for preview, active highlight, right-click context"
    parallel: true
    depends-on: []

  - id: tab-context-menu
    files: [ui/src/components/layout/tabs/TabContextMenu.tsx]
    tests: [ui/src/components/layout/tabs/__tests__/TabContextMenu.test.tsx]
    description: "Close / Close Others / Close to the Right / Pin Tab / Unpin Tab / Reveal in Sidebar"
    parallel: true
    depends-on: []

  - id: tab-bar
    files: [ui/src/components/layout/tabs/TabBar.tsx]
    tests: [ui/src/components/layout/tabs/__tests__/TabBar.test.tsx]
    description: "Regular tab row; drag-to-reorder (dnd-kit reused from todos); horizontal scroll on overflow"
    parallel: false
    depends-on: [tab-component, tabs-store]

  - id: pinned-tab-bar
    files: [ui/src/components/layout/tabs/PinnedTabBar.tsx]
    tests: [ui/src/components/layout/tabs/__tests__/PinnedTabBar.test.tsx]
    description: "Pinned-row (hidden when no pinned tabs); close via context menu only"
    parallel: false
    depends-on: [tab-component, tabs-store]

  - id: tab-bars-mount
    files: [ui/src/App.tsx]
    tests: []
    description: "Mount PinnedTabBar + TabBar between app header and editor pane (behind sidebar.tabs flag)"
    parallel: false
    depends-on: [tab-bar, pinned-tab-bar]

  - id: tree-tab-wiring
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx, ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/tree-tabs-integration.test.tsx]
    description: "Wire single-click→openPreview, double-click→openPermanent, context-menu Open in New Tab→openPermanent (only when sidebar.tabs flag on)"
    parallel: false
    depends-on: [artifact-tree, tabs-store]

  - id: editor-auto-promote
    files: [ui/src/hooks/useEditorAutoPromote.ts, ui/src/App.tsx]
    tests: [ui/src/hooks/__tests__/useEditorAutoPromote.test.ts]
    description: "Subscribe to per-editor dirty events; call promoteToPermanent(activeTabId) on first dirty"
    parallel: false
    depends-on: [tabs-store]

  - id: tab-keyboard
    files: [ui/src/hooks/useTabKeyboard.ts]
    tests: [ui/src/hooks/__tests__/useTabKeyboard.test.ts]
    description: "Ctrl/Cmd+Tab cycle, Ctrl+W close, Ctrl+1..9 jump; wrap in sub-flag to disable if conflicts arise"
    parallel: false
    depends-on: [tabs-store]

  - id: cleanup-flags-rename
    files: [ui/src/components/mobile/PreviewTab.tsx]
    tests: []
    description: "Remove sidebar.tree / sidebar.tabs flag guards; rename mobile PreviewTab to avoid collision"
    parallel: false
    depends-on: [sidebar-integration, tab-bars-mount, tree-tab-wiring, editor-auto-promote]
```

### Execution Waves

**Wave 1 (parallel, 7 tasks):**
- sidebar-tree-store, tree-selectors, import-artifact-forced-type, api-delete-embed, get-actions-for-node, todos-refactor, tabs-store, tab-component, tab-context-menu

**Wave 2 (depends on Wave 1):**
- sidebar-node-context-menu (← get-actions-for-node)
- tree-node (← get-actions-for-node)
- tree-section (← sidebar-tree-store, import-artifact-forced-type)
- tab-bar (← tab-component, tabs-store)
- pinned-tab-bar (← tab-component, tabs-store)
- editor-auto-promote (← tabs-store)
- tab-keyboard (← tabs-store)

**Wave 3:**
- artifact-tree (← tree-section, tree-node, tree-selectors, todos-refactor, sidebar-node-context-menu, api-delete-embed)
- tab-bars-mount (← tab-bar, pinned-tab-bar)

**Wave 4:**
- sidebar-integration (← artifact-tree)
- tree-tab-wiring (← artifact-tree, tabs-store)

**Wave 5 (cleanup):**
- cleanup-flags-rename (← sidebar-integration, tab-bars-mount, tree-tab-wiring, editor-auto-promote)

### Summary
- Total tasks: 19
- Total waves: 5
- Max parallelism: 9 (Wave 1)

### Deferred / explicit non-goals (v1)
- Content search (`sidebar.tree.searchContent`) — names-only ships in v1
- Unified `selectedArtifact` consolidation — Phase B follow-up per design §8.5
- Rename / Duplicate backend endpoints — menu items disabled with tooltip
- Server-side tab persistence — localStorage only
