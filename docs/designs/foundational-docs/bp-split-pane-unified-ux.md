# Blueprint: Unified Split-Pane UX

## Source Artifacts
- `design-split-pane-unified-ux`

---

## 1. Structure Summary

### Files to create

- [ ] `ui/src/components/layout/editor/PaneContent.tsx` — single dispatcher keyed on `TabDescriptor` returning the correct viewer/editor for every tab kind.
- [ ] `ui/src/components/layout/editor/RightPaneCloseButton.tsx` — small overlay button (top-right, on-hover) calling `closeRightPane`.

### Files to modify

- [ ] `ui/src/stores/tabsStore.ts` — single tab list + `rightPaneTabId`; add `pinTabRight`, `unpinTabRight`, `closeRightPane`; deprecate (or reimplement) `moveTabBetweenPanes`.
- [ ] `ui/src/components/layout/editor/SplitEditorHost.tsx` — use `PaneContent` for both panes; drag-to-right-half → `pinTabRight`; render close-button overlay on right pane.
- [ ] `ui/src/components/layout/tabs/SplitTabBar.tsx` — delete (or reduce to a one-line re-export of `TabBar`).
- [ ] `ui/src/components/layout/tabs/TabBar.tsx` — remove per-pane activeTabId plumbing; single tab bar always backed by single tab list.
- [ ] `ui/src/App.tsx` — delete standalone branches for `selectedEmbedId`, `selectedImageId`, `selectedPseudoPath`, and the task-graph render block; sidebar open handlers always call the left-pane openers.
- [ ] `ui/src/stores/sessionStore.ts` — remove `selectedEmbedId` / `selectedImageId` / `selectedPseudoPath` (or mark as derived-from-active-tab).
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — open handlers route through tab store, not selection globals.
- [ ] `ui/src/components/EditorToolbar.tsx` (or wherever toolbar dispatch lives) — key off active tab's kind/artifactType.

### Type Definitions

```ts
// tabsStore.ts
export type TabKind =
  | 'artifact'       // document|diagram|design|spreadsheet|snippet|image (via artifactType)
  | 'embed'
  | 'task-graph'
  | 'task-details'
  | 'blueprint'
  | 'code-file';

// Single tab list per session; right pane is a pointer, not a second list.
export interface SessionTabsState {
  tabs: TabDescriptor[];           // the ONE list
  activeTabId: string | null;      // drives left pane
  rightPaneTabId: string | null;   // null = split collapsed
}
```

`PaneId` is retained only for drop-zone semantics (`'left' | 'right'`), not for tab ownership.

### Component Interactions

```
Sidebar click ──► openPermanent(tab)          ──► activeTabId = tab.id  (left)
Tab click     ──► setActive(tab.id)           ──► activeTabId = tab.id  (left)
Drag → right  ──► pinTabRight(tab.id)         ──► rightPaneTabId = tab.id
Right close   ──► closeRightPane()            ──► rightPaneTabId = null
Tab close     ──► closeTab(id)                ──► remove from tabs; if == rightPaneTabId, clear it
```

`SplitEditorHost` reads `activeTabId` → left `PaneContent`; reads `rightPaneTabId` → right `PaneContent`.

---

## 2. Function Blueprints

### `tabsStore.pinTabRight(id: string): void`

**Pseudocode:**
1. Resolve session entry by currentKey().
2. If tab `id` not in `tabs`, return.
3. Set `rightPaneTabId = id`.
4. Do NOT mutate `tabs` or `activeTabId`.

**Edge cases:** tab is already pinned right → no-op. Tab is currently the active left tab → both panes render the same item (dual view — intentional).

**Tests:**
- pinning makes `rightPaneTabId === id`.
- pinning a non-existent tab is a no-op.
- `activeTabId` is unchanged after pin.

### `tabsStore.unpinTabRight(id?: string): void`

Optional `id` so callers can unpin-if-matches.

**Pseudocode:**
1. If `id` given and `rightPaneTabId !== id`, return.
2. Set `rightPaneTabId = null`.

### `tabsStore.closeRightPane(): void`

Alias for `unpinTabRight()` with no id. Explicit name improves call-site clarity.

### `tabsStore.closeTab(id: string): void` (modify existing)

**Add:** if `rightPaneTabId === id`, set it to `null` during the same set().

### `PaneContent({ tab }: { tab: TabDescriptor | null }): ReactElement`

**Pseudocode:**
1. If `!tab`, return `<EmptyPane />`.
2. Switch on `tab.kind`:
   - `artifact` → switch on `tab.artifactType`:
     - `document` → `<DocumentView document={…} onContentChange={…} />`
     - `diagram` → `<UnifiedEditor item={…} …diagram props />`
     - `design` → `<DesignEditor designId={tab.artifactId} />`
     - `spreadsheet` → `<SpreadsheetEditor spreadsheetId={tab.artifactId} />`
     - `snippet` → `<SnippetGroupView item={…} />` (or `CodeEditor` if linked — reuse `UnifiedEditor`'s snippet branch)
     - `image` → `<ImageViewer imageId={tab.artifactId} />` *(ImageViewer must accept explicit id prop; currently it reads `selectedImageId` from sessionStore — refactor it.)*
   - `embed` → `<EmbedViewer embed={lookup(tab.artifactId)} />`
   - `task-graph` → `<TaskGraphView project={…} session={…} />`
   - `task-details` → `<TaskDetailsView taskId={tab.artifactId} />`
   - `blueprint` → `<BlueprintView documentId={tab.artifactId} />` *(likely same as document view; confirm.)*
   - `code-file` → `<PseudoViewer path={tab.artifactId} project={…} />`

**Error handling:** unknown kind → `<EmptyPane message="Unknown tab kind" />`. Missing lookup target (e.g. embed id not found) → `<EmptyPane message="Artifact not found" />`.

**Tests:** one snapshot test per kind; one test for unknown-kind fallback; one test for missing-lookup fallback.

### `SplitEditorHost.buildDragEndHandler` (modify)

Replace `moveTabBetweenPanes` usage on `editor-half-right` with `pinTabRight(activeTab.id)`; on `editor-half-left` with `unpinTabRight(activeTab.id)`. Intra-pane reorder behavior is unchanged (single list).

### `RightPaneCloseButton({ onClose }: { onClose: () => void })`

**Pseudocode:**
1. Render `<button>` absolute-positioned top-right inside right pane container.
2. Opacity 0 default, group-hover:opacity-100.
3. onClick → `onClose()` which calls `closeRightPane()`.

### App-level open handlers (sidebar)

All sidebar open handlers collapse to: `openPermanent({ id, kind, artifactType, artifactId, name })` — no pane argument; tabsStore always targets the single list and sets `activeTabId`.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: store-refactor
    files: [ui/src/stores/tabsStore.ts]
    tests: [ui/src/stores/__tests__/tabsStore.test.ts]
    description: "Single tab list + rightPaneTabId. Add pinTabRight / unpinTabRight / closeRightPane. closeTab clears rightPaneTabId if matched. Deprecate moveTabBetweenPanes (keep a shim that calls pin/unpin during migration, or remove outright)."
    parallel: true
    depends-on: []

  - id: promote-tab-kinds
    files: [ui/src/stores/tabsStore.ts]
    tests: [ui/src/stores/__tests__/tabsStore.kinds.test.ts]
    description: "Audit TabKind / TabArtifactType enums; ensure image, embed, task-graph, task-details, blueprint, code-file are all representable. Add any missing kinds. (Combined into store-refactor if changes are small.)"
    parallel: true
    depends-on: []

  - id: pane-content-dispatcher
    files: [ui/src/components/layout/editor/PaneContent.tsx]
    tests: [ui/src/components/layout/editor/__tests__/PaneContent.test.tsx]
    description: "New component PaneContent({ tab }) switching on kind + artifactType, covering all kinds. Fallbacks for unknown kind and missing lookup."
    parallel: false
    depends-on: [store-refactor, promote-tab-kinds]

  - id: image-viewer-prop
    files: [ui/src/components/ImageViewer.tsx]
    tests: [ui/src/components/__tests__/ImageViewer.test.tsx]
    description: "Refactor ImageViewer to accept imageId prop instead of reading selectedImageId from sessionStore. Keep a fallback to the store during migration if needed."
    parallel: true
    depends-on: []

  - id: split-editor-host-wire
    files: [ui/src/components/layout/editor/SplitEditorHost.tsx, ui/src/components/layout/editor/RightPaneCloseButton.tsx]
    tests: [ui/src/components/layout/editor/__tests__/SplitEditorHost.test.tsx]
    description: "Use PaneContent for both panes. Drag-to-right-half → pinTabRight; drag-to-left-half → unpinTabRight. Render RightPaneCloseButton overlay when rightPaneTabId != null. Remove moveTabBetweenPanes call."
    parallel: true
    depends-on: [pane-content-dispatcher, image-viewer-prop]

  - id: tabbar-single
    files: [ui/src/components/layout/tabs/TabBar.tsx, ui/src/components/layout/tabs/SplitTabBar.tsx, ui/src/components/layout/tabs/PinnedTabBar.tsx]
    tests: [ui/src/components/layout/tabs/__tests__/TabBar.test.tsx]
    description: "Collapse SplitTabBar to a thin wrapper (or delete and update imports). TabBar renders the single tab list. Remove per-pane activeTabId handling. Keep drag sources intact for the right-half drop zone."
    parallel: true
    depends-on: [store-refactor]

  - id: app-integration
    files: [ui/src/App.tsx, ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.clicks.test.tsx]
    description: "Delete standalone render branches: selectedEmbedId, selectedImageId, selectedPseudoPath, task-graph block. All content now flows through SplitEditorHost. Sidebar open handlers always openPermanent without a pane arg. Open-by-id for embed/image/pseudo/task-graph creates a tab of the appropriate kind."
    parallel: false
    depends-on: [split-editor-host-wire, tabbar-single]

  - id: session-store-cleanup
    files: [ui/src/stores/sessionStore.ts]
    tests: [ui/src/stores/__tests__/sessionStore.test.ts]
    description: "Remove selectedEmbedId, selectedImageId, selectedPseudoPath, and any task-graph-mode flag. Update any remaining consumers to read the active tab from tabsStore instead."
    parallel: true
    depends-on: [app-integration]

  - id: toolbar-tab-aware
    files: [ui/src/components/EditorToolbar.tsx, ui/src/App.tsx]
    tests: [ui/src/components/__tests__/EditorToolbar.test.tsx]
    description: "EditorToolbar itemType/history/zoom dispatch keys on the left pane's active tab (kind + artifactType) rather than legacy selection globals. Hide toolbar for kinds that don't need it (task-graph, embed, image)."
    parallel: true
    depends-on: [app-integration]

  - id: bug-retriage-and-parity-tests
    files: []
    tests: [ui/src/components/layout/editor/__tests__/SplitPaneParity.test.tsx]
    description: "New integration test: for each tab kind, verify it renders when pinned right. Re-triage review-bugs-split-panes H/M/L bugs against the new model; close the three H bugs if moot; file any new issues exposed by the refactor."
    parallel: false
    depends-on: [session-store-cleanup, toolbar-tab-aware]
```

### Execution Waves

**Wave 1 (parallel):** `store-refactor`, `promote-tab-kinds`, `image-viewer-prop`

**Wave 2 (depends on Wave 1):** `pane-content-dispatcher`

**Wave 3 (parallel, depends on Wave 2):** `split-editor-host-wire`, `tabbar-single`

**Wave 4 (depends on Wave 3):** `app-integration`

**Wave 5 (parallel, depends on Wave 4):** `session-store-cleanup`, `toolbar-tab-aware`

**Wave 6 (depends on Wave 5):** `bug-retriage-and-parity-tests`

### Summary

- Total tasks: 10
- Total waves: 6
- Max parallelism: 3 (Wave 1)
