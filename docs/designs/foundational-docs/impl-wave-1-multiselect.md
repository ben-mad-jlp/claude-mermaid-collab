# Wave 1 Implementation — Multi-select Foundations

## Tasks
- **selection-store** — Added `MultiSelection` interface + 4 actions (setSelection, toggleInSelection, extendSelectionTo, clearSelection) to `sidebarTreeStore`. Excluded from persist partialize.
- **visible-order-helper** — New `orderVisibleNodes.ts` with `VisibleTreeNode` interface and DFS traversal that skips collapsed subtrees.
- **actions-for-selection** — Added `getActionsForSelection(nodes, ctx)` to `getActionsForNode.ts` — pure id intersection, preserves first-node ordering, noop placeholder on empty intersection.
- **batch-runner** — New `runBatchAction.ts` exporting `BatchDeps`, `BatchResult`, `UnsupportedBatchAction`, and the async executor using `Promise.allSettled`.

## Verification
- All 4 new test files pass: 30/30 tests.
- tsc clean in wave scope.
- Fix loop: 1 attempt (selection-store test used wrong field path `state.selectedIds` → fixed to `state.multiSelection.ids`).
