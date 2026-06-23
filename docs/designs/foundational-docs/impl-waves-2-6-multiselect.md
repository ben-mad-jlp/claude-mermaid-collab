# Waves 2–6 Implementation — Multi-select Tree Actions

## Wave 2 — UI primitives (10/10 tests)
- **node-component-styling**: `ArtifactTreeNode` accepts `isInMultiSelection`; adds `ring-2 ring-accent-500 dark:ring-accent-400` when true; composes cleanly with `selected`.
- **context-menu-multiscope**: `SidebarNodeContextMenu` prop union `node | nodes`; title shows node name or `"N items selected"`; `onAction(actionId, targetNodes)`; internal computation of `resolvedActions` via `getActionsForSelection` for multi / `getActionsForNode` for single.

## Wave 3 — click wiring (9/9 tests)
- **tree-click-handlers**: `ArtifactTree.tsx` now reads `multiSelection` from `sidebarTreeStore`; adds `visibleOrder` useMemo (sections with filtered/sorted children, collapsed-aware); `handleNodeClick(node, e)` routes ctrl/meta → toggleInSelection, shift → extendSelectionTo, plain → setSelection + activate; each rendered `ArtifactTreeNode` gets `isInMultiSelection={multiSelection.ids.has(node.id)}`.

## Wave 4 — right-click routing + summary bar (+4 tests, 14 total)
- **tree-context-menu-routing**: `allVisibleTreeNodes` useMemo (deduped by id via Map); `handleNodeContextMenu(node, e)` uses multi-scope when right-click is on a node already in selection, else collapses to single; `handleMenuAction(actionId, targetNodes)` threaded through; `ContextMenuState` widened to `{ node?, nodes?, x, y }`.
- **selection-summary-bar**: Renders `data-testid="selection-summary-bar"` at top of sidebar when `multiSelection.ids.size > 1`; Clear button resets.

## Wave 5 — batch dispatch (16 tests)
- **tree-batch-integration**: `handleMenuAction` invokes `runBatchAction` for `SUPPORTED_BATCH = {delete, deprecate, undeprecate}` when `targetNodes.length > 1`; `BatchDeps` wraps sync `applyDeprecatedToStore` into a `Promise<void>`; aggregate result logged (v1 placeholder; toast primitive TBD). Selection is NOT auto-cleared.

## Wave 6 — keyboard + session hygiene (verified)
- **keyboard-and-session**: Window `keydown` listener (with `keyboardHandlersRef` indirection to respect Rules of Hooks given the `if (!currentSession) return` early-exit above `allVisibleTreeNodes` / `handleMenuAction`). Escape → `clearSelection`; Delete → `handleMenuAction('delete', selected)` with input/textarea/contenteditable guard. Session-change effect (keyed on `${project}::${name}`) clears selection.

## Totals
- 11 tasks across 6 waves, all completed.
- 49 new/extended tests in multiselect scope: **49/49 passing**.
- 1 fix loop iteration (wave 1: selection-store test field-path).
- 1 minor post-hoc correctness fix (`allVisibleTreeNodes` dedup by id).
- Deferred: real toast primitive (v1 uses `console.info`/`warn`); blueprint clear-task-graph side effect not mirrored in batch `deprecate` path (noted for follow-up).
- Unrelated pre-existing failures in untracked `artifactTreeSelectors.*` remain out of scope.
