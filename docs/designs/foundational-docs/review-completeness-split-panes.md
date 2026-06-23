# Completeness Review — bp-split-tab-panes

## Summary
- Tasks: 8/8 implemented (all 6 waves landed)
- Files: 8/8 planned source+integration files present with real code
- Test files: 4/4 new test files present (tabsStore.panes, SplitTabBar, EditorAreaDropZones, SplitEditorHost)
- Stubs/TODOs in listed files: none found
- Acceptance criteria: met (horizontal split, half-zone drop, right-pane auto-hide on empty)

## Tasks coverage (blueprint §3)

| Task | Status | Evidence |
|------|--------|----------|
| tabs-store-panes-shape | Done | `ui/src/stores/tabsStore.ts` has `panes:{left,right}`, `activePaneId`, `moveTabBetweenPanes`, `setActivePaneId`, persist `version:2` + `migrate`. |
| empty-pane | Done | `ui/src/components/layout/editor/EmptyPane.tsx` — dotted border, spec copy, optional `isDragOver` accent, `data-testid="editor-empty-pane"`. |
| tab-bar-pane | Done | `TabBar.tsx` + `PinnedTabBar.tsx` accept required `pane: PaneId`; route store ops per pane; `data-pane` attr. |
| editor-drop-zones | Done | `EditorAreaDropZones.tsx` — two `useDroppable` halves with `data.zone='editor-half-left|right'`, pointer-events gated via `useDndMonitor`, `isOver` highlight. |
| split-tab-bar | Done | `SplitTabBar.tsx` — single-pane when right empty, else split with optional `primarySizePercent` width sync, per-wrapper `onMouseDown` sets active pane. |
| split-editor-host | Done | `SplitEditorHost.tsx` — single `DndContext`, `buildDragEndHandler` exported; routes `editor-half-*` to `moveTabBetweenPanes`, else intra-pane `arrayMove + reorderTabs(ids,pane)`. |
| app-dual-routing | Done | `App.tsx` lines 1049-1058 derive `leftItem`/`rightItem` via memo + `resolveItem`; `activeItem` keyed by `activePaneId`; `handleContentChange(itemId, content, pane)` at 1223; `<SplitEditorHost leftItem rightItem .../>` at 1614. |
| active-pane-focus-ring | Done | `SplitEditorHost.tsx` 168-189: split-mode only, `ring-2 ring-inset ring-accent-500`, `onMouseDown` → `setActivePaneId`, `data-active-pane` attr. |

## Function-level spec compliance

### `moveTabBetweenPanes(tabId, fromPane, toPane, insertAtIndex?)`
Signature matches. Implementation (tabsStore.ts:370-433):
- Short-circuits when `fromPane === toPane` (blueprint step 1)
- Removes from source with renumber (steps 3-4)
- Inserts at `insertAtIndex` clamped (step 5)
- Reassigns source active tab id (step 6)
- Sets `toPane.activeTabId = movedId` and `activePaneId = toPane` (step 7)
- Promotes right→left when left empties (step 8). Correctly guarded with `fromPane === 'left'` per Wave-1 bugfix note.

### `setActivePaneId(pane)`
tabsStore.ts:435-448. Early-returns when `entry.panes[pane].tabs.length === 0` — matches blueprint "no-op if target pane is empty".

### Persist v1→v2 migration
tabsStore.ts:456-479. `version: 2`, migrate hoists legacy `{tabs, activeTabId}` into `panes.left`, seeds `panes.right={tabs:[],activeTabId:null}`, `activePaneId:'left'`. Matches spec.

### SplitEditorHost drag-end dispatcher
buildDragEndHandler at SplitEditorHost.tsx:39-77: reads `over.data.current.zone`, dispatches to `moveTabBetweenPanes` for `editor-half-left|right` (with same-pane guard), else falls through to `arrayMove + reorderTabs(ids, sourcePane)`. Matches blueprint pseudocode.

### EditorAreaDropZones
Two halves, `data.zone` set via `useDroppable({ id, data:{ zone: id } })`, pointer-events toggled by `useDndMonitor` dragging state, accent highlight on isOver. Matches spec.

### EmptyPane
Placeholder with spec copy verbatim: "No tab open — drag a tab here or open from the sidebar".

## Acceptance criteria (blueprint Goal)
- [x] Horizontal editor split — `SplitEditorHost` wraps `SplitPane` when `panes.right.tabs.length > 0`
- [x] Drag to half-zone to split — `EditorAreaDropZones` + `buildDragEndHandler` route to `moveTabBetweenPanes`
- [x] Collapse to single when last tab removed — `SplitTabBar` + `SplitEditorHost` both read `panes.right.tabs.length` and render single-pane fallback; promotion branch in `moveTabBetweenPanes` guarantees "never only right pane"

## Gaps / deferred (called out in impl-wave-5)
- Per-pane `localContent` + auto-save not yet wired (single-pane auto-save only). Non-blocking polish; not in blueprint task list.
- Cmd+Z undo/redo placeholder — out of scope for blueprint tasks.
- History/zoom/preview props not yet threaded through SplitEditorHost — out of scope for blueprint tasks.

## Stub / TODO scan
Grep for `TODO|FIXME|Not implemented|throw new Error('Not` across the six listed source files and their test files: **no matches**.

## Verdict
Blueprint fully implemented. 8/8 tasks, 8/8 planned files present, 4/4 new test files present, all signatures and behaviours align with spec. No stubs or unresolved TODOs in the listed sources.
