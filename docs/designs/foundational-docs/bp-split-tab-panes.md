# Blueprint: Left/Right Split Tab Panes with Drag-and-Drop

## Source Artifacts
- `research-split-tab-panes` (refined with editor-area half-drop-zone UX model)

## Goal
Enable a horizontal split of the editor area so two tabs can be viewed side-by-side. Users split by dragging a tab onto the **left or right half** of the editor region; the highlighted half absorbs the tab. Dragging the last tab out of a pane collapses the split back to single-pane.

---

## 1. Structure Summary

### Files to modify
- [ ] `ui/src/stores/tabsStore.ts` — refactor `SessionTabsState` from single `{tabs, activeTabId}` to `{panes: {left, right}, activePaneId}`; add `moveTabBetweenPanes`, `setActivePaneId`; migrate persist v1→v2
- [ ] `ui/src/stores/__tests__/tabsStore.test.ts` — existing tests adapted for panes
- [ ] `ui/src/components/layout/tabs/TabBar.tsx` — rename to single-pane `TabBarPane` (scoped to one pane)
- [ ] `ui/src/App.tsx` — dual `selectedItem` derivation, split-pane hosting, keyboard routing

### Files to create
- [ ] `ui/src/components/layout/tabs/SplitTabBar.tsx` — wraps two `TabBarPane`s inside one `DndContext`
- [ ] `ui/src/components/layout/editor/EditorAreaDropZones.tsx` — two 50%-width invisible `useDroppable` zones layered over the editor region; highlight on drag-over
- [ ] `ui/src/components/layout/editor/EmptyPane.tsx` — placeholder "No tab open"
- [ ] `ui/src/components/layout/editor/SplitEditorHost.tsx` — composes `SplitPane` + two `<UnifiedEditor>` + `EditorAreaDropZones`; hosts the `DndContext`
- [ ] `ui/src/stores/__tests__/tabsStore.panes.test.ts` — new test file for pane ops + cross-pane move
- [ ] `ui/src/components/layout/tabs/__tests__/SplitTabBar.test.tsx`
- [ ] `ui/src/components/layout/editor/__tests__/EditorAreaDropZones.test.tsx`
- [ ] `ui/src/components/layout/editor/__tests__/SplitEditorHost.test.tsx`

### Type Definitions

```typescript
// tabsStore.ts
export type PaneId = 'left' | 'right';

export interface PaneState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

export interface SessionTabsState {
  panes: { left: PaneState; right: PaneState };
  activePaneId: PaneId;
}

// persist v2 migration: if old `tabs` + `activeTabId` detected,
// hoist to panes.left and set panes.right = { tabs: [], activeTabId: null }.
```

### Component Interactions

```
App.tsx
 └── SplitEditorHost
      ├── DndContext (sensors, collisionDetection, onDragEnd)
      │    ├── SplitTabBar
      │    │    ├── TabBarPane pane="left"  (SortableContext + tabs)
      │    │    └── TabBarPane pane="right" (SortableContext + tabs)
      │    └── SplitPane
      │         ├── [left]  UnifiedEditor item={leftSelectedItem} | EmptyPane
      │         └── [right] UnifiedEditor item={rightSelectedItem} | EmptyPane
      └── EditorAreaDropZones (absolutely positioned overlay, two 50% droppables)
```

On drag-end, the handler inspects `over.data.zone`:
- `zone: 'tab-pane-<id>'` → intra-pane reorder via existing logic
- `zone: 'editor-half-left' | 'editor-half-right'` → `moveTabBetweenPanes`, creating the right pane if needed.

Only-left-pane is the default visible state. The right pane becomes visible when `panes.right.tabs.length > 0`; otherwise `SplitPane` renders single-pane.

---

## 2. Function Blueprints

### `tabsStore.moveTabBetweenPanes(tabId: string, fromPane: PaneId, toPane: PaneId, insertAtIndex?: number): void`

**Pseudocode:**
1. Resolve current session key; no-op if fromPane === toPane.
2. Read entry from `bySession[key]`.
3. Find `tab = entry.panes[fromPane].tabs.find(t => t.id === tabId)`; no-op if missing.
4. Remove tab from fromPane tabs; renumber `order`.
5. Insert tab into toPane tabs at `insertAtIndex` (default: end); renumber `order`.
6. If fromPane.activeTabId === tabId, new fromActive = fromTabs[0]?.id ?? null.
7. New state: toPane.activeTabId = tabId, activePaneId = toPane.
8. If fromPane tabs now empty AND toPane === 'left': move remaining right-pane tabs into left, clear right. (collapse when left empties — see edge case.)

**Error handling:** No throws; no-op on invalid input.

**Edge cases:**
- Empty fromPane after move → if fromPane is right, it naturally becomes "hidden" by SplitPane check.
- Empty left pane while right has tabs → promote right's tabs into left so the UI never shows only a right pane.
- Tab with same id already in target pane → ignore (shouldn't happen; tab descriptors are session-unique).
- Active tab id no longer present → choose first remaining tab in the pane.

**Test strategy:** unit: move preserves tab metadata (pinned, preview, order); active tab handoff; activePaneId update; cross-pane with empty target; right→left collapse; idempotent when source==target.

---

### `tabsStore.setActivePaneId(pane: PaneId): void`

**Pseudocode:** Set `activePaneId` in the current session entry. If target pane has no tabs, no-op.

**Edge cases:** Called frequently from focus events; must be cheap and reference-stable when unchanged.

**Test:** setting same pane twice → single state update; setting pane without tabs → no state mutation.

---

### `tabsStore` persist migration v1 → v2

**Pseudocode:** In `persist` config, set `version: 2` and define `migrate(persistedState, prevVersion)`:
1. For each session entry, if shape has `tabs` + `activeTabId` (no `panes`), wrap into `panes.left = {tabs, activeTabId}`, `panes.right = {tabs: [], activeTabId: null}`, `activePaneId = 'left'`.
2. Return migrated state.

**Test:** feed a v1 localStorage blob to `persist`; assert output has panes; assert right pane empty.

---

### `SplitTabBar({ onContextMenu })`

**Pseudocode:**
1. Read `panes` + `activePaneId` from store.
2. If `panes.right.tabs.length === 0`, render only `<TabBarPane pane="left">`.
3. Else render both in a horizontal flex row divided 50/50 (matches `SplitPane` split position — read from `react-resizable-panels` autoSave or duplicate the ratio via uiStore).
4. Pass pane id to each so Tab clicks call `setActive(id, pane)` + `setActivePaneId(pane)`.

**Edge cases:** tab bars should align with the editor panes below; consider rendering them inside `SplitEditorHost` so they share the same SplitPane splitter.

---

### `EditorAreaDropZones({ children, onDropToHalf })`

**Pseudocode:**
1. Absolutely position two `useDroppable` divs at 0–50% and 50–100% width over the editor area.
2. Only activate (pointer-events: auto) when a `useDndMonitor` reports `isDragging === true`; idle state uses pointer-events: none so they don't block editor clicks.
3. On drag-over, each zone reads `isOver` and renders a blue overlay + border.
4. `droppable.data = { zone: 'editor-half-left' | 'editor-half-right' }`.

**Error handling:** If a drag finishes without hitting a zone, parent `onDragEnd` falls through to intra-pane reorder.

**Test strategy:** render with a simulated drag; assert left zone highlights when pointer x < 50% and right when >= 50%.

---

### `SplitEditorHost` drag-end dispatcher

**Pseudocode:**
```
onDragEnd(e):
  if !e.over: return
  const activeTab = findTabById(e.active.id)
  if !activeTab: return

  const targetZone = e.over.data?.zone
  if targetZone === 'editor-half-left':
    moveTabBetweenPanes(activeTab.id, activeTab.pane, 'left')
    return
  if targetZone === 'editor-half-right':
    moveTabBetweenPanes(activeTab.id, activeTab.pane, 'right')
    return
  // Fall through: intra-pane reorder using existing logic (arrayMove + reorderTabs(..., pane))
```

**Edge cases:**
- Drop on same pane's half → no-op (moveTabBetweenPanes short-circuits).
- Drop on right half when right pane empty → creates the right pane (moveTabBetweenPanes writes to panes.right and sets activePaneId).

---

### `App.tsx` dual-selection derivation

**Pseudocode:**
1. `const { panes } = useSessionTabs()`
2. `const leftTab = panes.left.tabs.find(t => t.id === panes.left.activeTabId)`
3. `const rightTab = panes.right.tabs.find(t => t.id === panes.right.activeTabId)`
4. `const leftSelectedItem = useMemo(() => resolveItem(leftTab, diagrams, documents, …), [leftTab, …])`
5. Same for right.
6. Keyboard shortcuts (Cmd+S, Cmd+Z) read `activePaneId` and dispatch to that pane's editor ref.

**Edge cases:** `resolveItem` returns null for missing tab → render `<EmptyPane />`. Content-change handler is passed as a closure carrying the pane id so `onContentChange` writes to the right artifact.

---

### `EmptyPane`

**Pseudocode:** Static component with a subtle dotted border, centered text "No tab open — drag a tab here or open from the sidebar", and an accent on drag-over (wired via EditorAreaDropZones).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: tabs-store-panes-shape
    files:
      - ui/src/stores/tabsStore.ts
    tests:
      - ui/src/stores/__tests__/tabsStore.panes.test.ts
    description: "Refactor SessionTabsState to {panes:{left,right}, activePaneId}; add moveTabBetweenPanes and setActivePaneId; adapt existing methods (openPreview, openPermanent, promoteToPermanent, pinTab, closeTab, reorderTabs, setActive) to accept optional pane param defaulting to activePaneId; add persist v1→v2 migration."
    parallel: true
    depends-on: []

  - id: tab-bar-pane
    files:
      - ui/src/components/layout/tabs/TabBar.tsx
    tests:
      - ui/src/components/layout/tabs/__tests__/TabBar.test.tsx
    description: "Refactor TabBar to accept a pane prop and read only that pane's tabs; pass pane through to setActive, closeTab, pinTab, promoteToPermanent, reorderTabs calls."
    parallel: true
    depends-on: [tabs-store-panes-shape]

  - id: editor-drop-zones
    files:
      - ui/src/components/layout/editor/EditorAreaDropZones.tsx
    tests:
      - ui/src/components/layout/editor/__tests__/EditorAreaDropZones.test.tsx
    description: "Create two useDroppable overlay zones (50% each) with data.zone='editor-half-left|right'; gate pointer-events on dragging state via useDndMonitor; highlight when isOver."
    parallel: true
    depends-on: [tabs-store-panes-shape]

  - id: empty-pane
    files:
      - ui/src/components/layout/editor/EmptyPane.tsx
    description: "Static placeholder component shown when a pane has no active tab."
    parallel: true
    depends-on: []

  - id: split-tab-bar
    files:
      - ui/src/components/layout/tabs/SplitTabBar.tsx
    tests:
      - ui/src/components/layout/tabs/__tests__/SplitTabBar.test.tsx
    description: "Compose two TabBarPane instances side-by-side (left always visible; right only when panes.right.tabs.length>0); align widths with SplitPane splitter position."
    parallel: false
    depends-on: [tab-bar-pane]

  - id: split-editor-host
    files:
      - ui/src/components/layout/editor/SplitEditorHost.tsx
    tests:
      - ui/src/components/layout/editor/__tests__/SplitEditorHost.test.tsx
    description: "Host the single DndContext, SplitTabBar on top, SplitPane below with left+right editor slots, and EditorAreaDropZones overlay. onDragEnd dispatches intra-pane reorder vs cross-pane move based on over.data.zone."
    parallel: false
    depends-on: [split-tab-bar, editor-drop-zones, empty-pane]

  - id: app-dual-routing
    files:
      - ui/src/App.tsx
    description: "Replace the single <UnifiedEditor> + TabBar with <SplitEditorHost>. Derive leftSelectedItem and rightSelectedItem via useMemo from each pane's activeTabId. Route keyboard shortcuts to the editor matching activePaneId. Pass pane-scoped onContentChange closures."
    parallel: false
    depends-on: [split-editor-host]

  - id: active-pane-focus-ring
    files:
      - ui/src/components/layout/editor/SplitEditorHost.tsx
    description: "Add focus outline to the pane matching activePaneId so keyboard users know which pane receives shortcuts. Clicking anywhere inside a pane sets activePaneId. Purely additive polish."
    parallel: false
    depends-on: [app-dual-routing]
```

### Execution Waves

**Wave 1 (parallel):**
- `tabs-store-panes-shape`
- `empty-pane`

**Wave 2 (parallel, after Wave 1):**
- `tab-bar-pane`
- `editor-drop-zones`

**Wave 3 (after Wave 2):**
- `split-tab-bar`

**Wave 4 (after Wave 3 + `empty-pane` + `editor-drop-zones`):**
- `split-editor-host`

**Wave 5 (after Wave 4):**
- `app-dual-routing`

**Wave 6 (after Wave 5):**
- `active-pane-focus-ring`

### Summary
- Total tasks: 8
- Total waves: 6
- Max parallelism: 2
