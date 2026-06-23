# Blueprint: Multi-Select + Right-Click Actions for Sidebar Artifact Tree

## Source Artifacts
- `design-multiselect-tree-actions` — full v1 design spec (selection model, interactions, actions, API assessment, waves)

## 1. Structure Summary

### Files to Modify
- [ ] `ui/src/stores/sidebarTreeStore.ts` — add non-persisted `multiSelection` slice (Set<nodeId>, anchorId) + actions (setSelection, toggleInSelection, extendSelectionTo, clearSelection)
- [ ] `ui/src/components/layout/sidebar-tree/getActionsForNode.ts` — add `getActionsForSelection(nodes)` returning intersection of per-node action lists; keep existing `getActionsForNode` for single-node callers
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx` — accept `isInMultiSelection` prop and apply selected-ring styling when set; call new props `onClick(e)`, `onContextMenu(e)` so modifier keys propagate
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — wire click/ctrl-click/shift-click/right-click to selection store; pass selection to each node; route context menu through selection-aware path; add Escape/Delete keyboard handlers; clear selection on session switch; add batch runner
- [ ] `ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx` — accept either `node` (single) or `nodes` (multi); render title reflecting count; call `getActionsForSelection` when multi
- [ ] `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx` — add selection summary bar (N selected · Clear) when `multiSelection.size > 1`

### Files to Create
- [ ] `ui/src/components/layout/sidebar-tree/orderVisibleNodes.ts` — helper returning the flat visible node order (used to resolve shift-click ranges)
- [ ] `ui/src/components/layout/sidebar-tree/runBatchAction.ts` — batch executor: `runBatchAction(actionId, nodes, deps)` → `Promise.allSettled` fan-out; aggregate success/failure counts; single toast

### Type Definitions

```ts
// sidebarTreeStore.ts additions
interface MultiSelection {
  ids: Set<string>;          // tree node ids currently selected
  anchorId: string | null;   // shift-click anchor
}

interface SidebarTreeStoreState {
  // ...existing
  multiSelection: MultiSelection;
  setSelection: (ids: string[], anchorId?: string | null) => void;
  toggleInSelection: (id: string, anchorId?: string | null) => void;
  extendSelectionTo: (id: string, visibleOrder: string[]) => void;
  clearSelection: () => void;
}

// getActionsForNode.ts additions
export function getActionsForSelection(nodes: TreeNode[]): MenuAction[];

// runBatchAction.ts
export type BatchDeps = {
  performDelete: (node: TreeNode) => Promise<void>;
  applyDeprecatedToStore: (node: TreeNode, deprecated: boolean) => Promise<void>;
  // ...additional single-node handlers the batch forwards to
};
export async function runBatchAction(
  actionId: string,
  nodes: TreeNode[],
  deps: BatchDeps,
): Promise<{ ok: number; failed: Array<{ node: TreeNode; error: unknown }> }>;
```

### Component Interactions

```
ArtifactTree
  ├─ reads multiSelection from sidebarTreeStore
  ├─ on click(node, e):
  │    if e.metaKey || e.ctrlKey → toggleInSelection(node.id, anchorId=node.id)
  │    else if e.shiftKey        → extendSelectionTo(node.id, orderVisibleNodes())
  │    else                      → setSelection([node.id], node.id) + activate node
  ├─ on contextMenu(node, e):
  │    if node in multiSelection → open menu with nodes=multiSelection
  │    else                      → setSelection([node.id]); open menu with node
  ├─ on Escape                   → clearSelection()
  ├─ on Delete                   → trigger 'delete' batch if size>=1
  └─ renders selection summary bar when size > 1

ArtifactTreeNode
  └─ receives isInMultiSelection; applies ring-2 ring-accent-500 styling

SidebarNodeContextMenu
  ├─ if nodes.length > 1 → getActionsForSelection(nodes); title "N items"
  └─ else                → getActionsForNode(node); title node.name

runBatchAction
  ├─ maps actionId → per-node handler
  ├─ Promise.allSettled over nodes
  └─ returns aggregate; caller shows toast
```

---

## 2. Function Blueprints

### `extendSelectionTo(id: string, visibleOrder: string[]): void`

Shift-click range selection. Anchor stays stable across successive shift-clicks (Finder/VS Code behavior).

**Pseudocode:**
1. Read current `multiSelection.anchorId`. If null, set anchor = id; selection = [id]; return.
2. `aIdx = visibleOrder.indexOf(anchorId)`; `bIdx = visibleOrder.indexOf(id)`.
3. If either index < 0 → fall back to `setSelection([id], id)` (anchor stale after tree changes).
4. `[lo, hi] = sort([aIdx, bIdx])`; `ids = visibleOrder.slice(lo, hi + 1)`.
5. Set `multiSelection = { ids: new Set(ids), anchorId }` (anchor unchanged).

**Edge cases:** anchor node collapsed/removed (fall back to single); duplicate ids in visibleOrder (impossible by construction).
**Test strategy:** unit tests with mock visibleOrder arrays covering forward, backward, anchor-missing, single-node.

---

### `getActionsForSelection(nodes: TreeNode[]): MenuAction[]`

Intersect per-node action arrays so the context menu only shows actions valid for every selected item.

**Pseudocode:**
1. If `nodes.length === 0` → return [].
2. If `nodes.length === 1` → return `getActionsForNode(nodes[0])`.
3. `perNode = nodes.map(getActionsForNode)`.
4. `firstIds = new Set(perNode[0].map(a => a.id))`.
5. For each subsequent list, keep only ids present in `firstIds`; update `firstIds`.
6. Filter perNode[0] to the surviving id set; mark `disabled` on destructive actions if not allowed for every node (e.g., already-deprecated).
7. Return resulting array (preserves original ordering from perNode[0]).

**Edge cases:** mixed kinds (artifact + blueprint) → intersection may be tiny (delete/deprecate only); empty intersection → return `[{ id: 'noop', label: 'No shared actions', disabled: true }]`.
**Test strategy:** unit tests for homogeneous selection (full menu), heterogeneous (intersection only), empty intersection placeholder.

---

### `runBatchAction(actionId, nodes, deps): Promise<Result>`

Dispatch a single action id across many nodes in parallel and aggregate results.

**Pseudocode:**
1. Map `actionId` to a single-node handler from `deps`:
   - `'delete'` → `deps.performDelete`
   - `'deprecate'` / `'undeprecate'` → `(n) => deps.applyDeprecatedToStore(n, true|false)`
   - etc.
2. If no handler → throw `UnsupportedBatchAction(actionId)`.
3. `results = await Promise.allSettled(nodes.map(handler))`.
4. Walk results → `ok` count + `failed` list of `{ node, error }`.
5. Return aggregate; do NOT clear selection here (caller decides).

**Error handling:** each node failure is captured, never thrown; aggregate returned.
**Edge cases:** concurrent session switch mid-batch (caller cancels UI but in-flight requests complete); destructive action on deprecated-already item (handler noops or errors — aggregated).
**Test strategy:** unit tests with mocked handlers mixing success + rejection; verify aggregate counts and order-independence.

---

### `orderVisibleNodes(tree, collapsedSections, collapsedDirs): string[]`

Flat in-order traversal of visible nodes, used as the canonical order for shift-click ranges.

**Pseudocode:**
1. Walk the tree depth-first.
2. Skip children of any section or directory whose id is in the collapsed set.
3. Emit node ids in visit order.
4. Return the array.

**Edge cases:** virtualized rows (not used here); ensure output matches what user sees.
**Test strategy:** unit tests with nested tree fixtures and varying collapsed sets.

---

### ArtifactTree click handler (`handleNodeClick`)

**Pseudocode:**
1. `{ metaKey, ctrlKey, shiftKey } = e`.
2. If `metaKey || ctrlKey` → `toggleInSelection(node.id, node.id)`; do NOT activate.
3. Else if `shiftKey` → `extendSelectionTo(node.id, orderVisibleNodes(...))`; do NOT activate.
4. Else → `setSelection([node.id], node.id)`; activate node normally (existing selection logic).

**Edge cases:** user ctrl-clicks a section row — apply same rule but skip activation regardless; shift-click with no anchor — fall back to single-select.

---

### ArtifactTree context menu handler (`handleNodeContextMenu`)

**Pseudocode:**
1. `e.preventDefault()`.
2. `selected = multiSelection.ids`.
3. If `selected.size > 1 && selected.has(node.id)` → `setContextMenu({ nodes: resolveNodes(selected), x: e.clientX, y: e.clientY })`.
4. Else → `setSelection([node.id], node.id)`; `setContextMenu({ node, x, y })`.

**Edge cases:** right-click outside selection with multi active → collapse to single.

---

### Session-switch selection clear (`useEffect` in ArtifactTree)

**Pseudocode:**
1. Subscribe to `sessionStore.currentSession?.name`.
2. In effect, call `clearSelection()` whenever session changes.

**Why:** selection ids only meaningful within one session.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: selection-store
    files: [ui/src/stores/sidebarTreeStore.ts]
    tests: [ui/src/stores/__tests__/sidebarTreeStore.multiselect.test.ts]
    description: "Add non-persisted multiSelection slice with setSelection, toggleInSelection, extendSelectionTo, clearSelection actions"
    parallel: true
    depends-on: []

  - id: visible-order-helper
    files: [ui/src/components/layout/sidebar-tree/orderVisibleNodes.ts]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/orderVisibleNodes.test.ts]
    description: "Flat in-order visible node id traversal used for shift-click ranges"
    parallel: true
    depends-on: []

  - id: actions-for-selection
    files: [ui/src/components/layout/sidebar-tree/getActionsForNode.ts]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/getActionsForSelection.test.ts]
    description: "Add getActionsForSelection returning intersection of per-node action lists"
    parallel: true
    depends-on: []

  - id: batch-runner
    files: [ui/src/components/layout/sidebar-tree/runBatchAction.ts]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/runBatchAction.test.ts]
    description: "Promise.allSettled batch executor mapping actionId to per-node handlers, aggregating ok/failed counts"
    parallel: true
    depends-on: []

  - id: node-component-styling
    files: [ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTreeNode.multiselect.test.tsx]
    description: "Accept isInMultiSelection prop; apply ring-2 selected styling; forward modifier keys via onClick(e)/onContextMenu(e)"
    parallel: false
    depends-on: [selection-store]

  - id: context-menu-multiscope
    files: [ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/SidebarNodeContextMenu.multi.test.tsx]
    description: "Accept node | nodes prop; title reflects count; call getActionsForSelection when multi"
    parallel: false
    depends-on: [actions-for-selection]

  - id: tree-click-handlers
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.clicks.test.tsx]
    description: "Wire click/ctrl-click/shift-click to selection actions; pass isInMultiSelection to each node"
    parallel: false
    depends-on: [selection-store, visible-order-helper, node-component-styling]

  - id: tree-context-menu-routing
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.contextmenu.test.tsx]
    description: "Route right-click through selection-aware path; right-click outside selection collapses to single"
    parallel: false
    depends-on: [tree-click-handlers, context-menu-multiscope]

  - id: tree-batch-integration
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.batch.test.tsx]
    description: "handleMenuAction dispatches to runBatchAction when nodes.length>1; aggregates toast; does not clear selection automatically"
    parallel: false
    depends-on: [tree-context-menu-routing, batch-runner]

  - id: keyboard-and-session
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.keyboard.test.tsx]
    description: "Escape clears selection; Delete triggers delete batch; useEffect on session change calls clearSelection"
    parallel: false
    depends-on: [tree-batch-integration]

  - id: selection-summary-bar
    files: [ui/src/components/layout/sidebar-tree/ArtifactTree.tsx]
    tests: [ui/src/components/layout/sidebar-tree/__tests__/ArtifactTree.summary.test.tsx]
    description: "Render 'N selected · Clear' bar above tree when multiSelection.size > 1"
    parallel: false
    depends-on: [tree-click-handlers]
```

### Execution Waves

**Wave 1 (parallel foundations, 4 tasks):**
- selection-store
- visible-order-helper
- actions-for-selection
- batch-runner

**Wave 2 (depends on Wave 1, 2 tasks):**
- node-component-styling (needs selection-store)
- context-menu-multiscope (needs actions-for-selection)

**Wave 3 (depends on Wave 2, 1 task):**
- tree-click-handlers (needs selection-store + visible-order-helper + node-component-styling)

**Wave 4 (depends on Wave 3, 2 tasks — parallel to summary-bar):**
- tree-context-menu-routing (needs tree-click-handlers + context-menu-multiscope)
- selection-summary-bar (needs tree-click-handlers)

**Wave 5 (depends on Wave 4, 1 task):**
- tree-batch-integration (needs tree-context-menu-routing + batch-runner)

**Wave 6 (depends on Wave 5, 1 task):**
- keyboard-and-session (needs tree-batch-integration)

### Summary
- Total tasks: 11
- Total waves: 6
- Max parallelism: 4 (Wave 1)
