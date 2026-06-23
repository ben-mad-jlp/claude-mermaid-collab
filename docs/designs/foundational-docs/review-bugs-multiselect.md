# Bug Review — Multi-select Tree Actions

Scope: `ui/src/stores/sidebarTreeStore.ts`, `ui/src/components/layout/sidebar-tree/*` (multi-select additions).

## Critical

### C1. Batch deprecate/undeprecate does not call the API — state lost on refresh
**File:** `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:796-801`

```ts
const batchDeps: BatchDeps = {
  performDelete,
  applyDeprecatedToStore: async (node, deprecated) => {
    applyDeprecatedToStore(node, deprecated);
  },
};
```

The batch wrapper only mutates the Zustand store (`applyDeprecatedToStore` just calls `updateDiagram/updateDocument/...`). It never calls `api.setDeprecated(project, session, node.id, deprecated)` — compare with the single-node path at lines 831-834 which does call the API before applying to the store.

**Impact:** Selecting N items and choosing "Deprecate"/"Undeprecate" from the multi-select context menu updates UI optimistically but is not persisted. On reload (or when the session store re-syncs), deprecation is reverted and the apparent action is silently lost.

**Fix:** In the batch wrapper, call the API then apply to store, mirroring single-node logic. Additionally mirror the blueprint → `api.clearTaskGraph` side-effect for deprecated blueprints.

```ts
applyDeprecatedToStore: async (node, deprecated) => {
  await api.setDeprecated(project, session, node.id, deprecated);
  applyDeprecatedToStore(node, deprecated);
  if (node.kind === 'blueprint' && deprecated) {
    await api.clearTaskGraph(project, session).catch((err) =>
      console.error('[ArtifactTree] clearTaskGraph failed', err),
    );
  }
},
```

## Important

### I1. Keyboard Delete bypasses confirmation dialog
**File:** `ArtifactTree.tsx:497-504`

Pressing `Delete` with any selection size (including size 1) invokes `handleMenuAction('delete', selected)`. For `targetNodes.length === 1`, `handleMenuAction` goes through the `setPendingDelete(node)` confirm-dialog path (good). But for `targetNodes.length > 1`, `handleMenuAction` short-circuits into `runBatchAction` which **deletes immediately with no confirmation** (performDelete fires API deletes in parallel).

**Impact:** A stray Delete keypress with N items selected permanently deletes all of them silently. No undo.

**Fix:** For batch delete, route through a confirm dialog (extend `ConfirmDialog` to take a list of names or a count, or gate the `runBatchAction('delete', ...)` call behind a new `pendingBatchDelete` state).

### I2. Silent filter of non-artifact ids from batch targets
**File:** `ArtifactTree.tsx:499, 695`

```ts
const selected = allVisibleTreeNodes.filter((n) => multiSelection.ids.has(n.id));
```

`allVisibleTreeNodes` (lines 657-689) only contains artifact/embed/blueprint/task nodes — it deliberately excludes todos, pseudo code files, and any nodes outside the section list. If `multiSelection.ids` ever contains such ids (e.g., future code tab, blueprint+todo mix, or stale ids after session switch before the `clearSelection` effect runs), those ids are silently dropped. Summary bar shows "5 selected", batch deletes only 3, and user has no indication the other 2 were skipped.

**Impact:** Discrepancy between reported selection size and acted-upon size; user may think a delete succeeded but 2 items remain.

**Fix:** Either (a) assert that every selected id resolves to a TreeNode and report a warning when they don't, or (b) have the summary bar / action path filter using the same `allVisibleTreeNodes` so the count matches what will actually be acted on.

### I3. `keyboardHandlersRef` assigned during render
**File:** `ArtifactTree.tsx:893`

```ts
keyboardHandlersRef.current = { allVisibleTreeNodes, handleMenuAction };
```

Mutation during render is unsafe under React concurrent rendering (StrictMode double-invocation, transitions) — a render may be discarded, leaving the ref reflecting work that never committed. In practice with the current handler it's close to harmless, but it is a hazard flagged by React docs.

**Fix:** Wrap in `useEffect(() => { keyboardHandlersRef.current = ...; })` or use `useLayoutEffect`.

## Minor

### M1. Dangling anchor after toggling the anchor off
**File:** `ui/src/stores/sidebarTreeStore.ts:255-266`

```ts
toggleInSelection: (id, anchorId) => {
  const current = get().multiSelection;
  const next = new Set(current.ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set({ multiSelection: { ids: next, anchorId: anchorId !== undefined ? anchorId : id } });
}
```

When the user cmd/ctrl-clicks an already-selected item (i.e., the anchor itself), the anchor is set to `id` — but `id` is no longer in the selection set. A subsequent shift-click will then shift-extend from an item that isn't selected, producing a range that visually includes an unselected anchor.

**Fix:** After removal, if the removed id equals anchor, pick a new anchor from remaining `next` (first in visible order, or just clear to `null`).

### M2. `handleNodeClick` ESLint-disabled deps hide stale closures
**File:** `ArtifactTree.tsx:610-627`

The callback closes over `openNode` and `toTabDescriptor` but they are omitted from deps (`// eslint-disable-next-line react-hooks/exhaustive-deps`). `openNode` captures many session-store select functions and `selectedXxxId` getters. Since `openNode` is not memoized, a stale instance can be captured — probably refreshes each render because `visibleOrder` changes often, but brittle.

**Fix:** Either memoize `openNode` with `useCallback` and include it in deps, or move `openNode` inside the callback.

### M3. `activeTab` legacy-value migration coerces `'pseudo'` → `'code'` in both storage and merge but not in initial `activeTab: 'items'`
**File:** `sidebarTreeStore.ts:99-108, 167-174, 349-356`

The three branches are consistent, so not a bug — noting for completeness.

### M4. Keyboard listener re-installed every time selection changes
**File:** `ArtifactTree.tsx:487-508`

Deps include `multiSelection.ids` (a Set). Every selection change creates a new Set identity, causing `add/removeEventListener` churn. Not incorrect but wasteful; depend on `multiSelection.ids.size > 0` gate via a guarded closure or use the ref pattern.

## Summary
- 1 Critical (batch deprecate never persists)
- 3 Important (silent delete without confirm, id filtering mismatch, render-time ref mutation)
- 4 Minor (anchor hygiene, stale closures, cosmetic)
