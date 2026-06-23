# Wave 1 Implementation — Split Tab Panes

## Tasks
- **tabs-store-panes-shape** — store already refactored (no-op on code); fixed `moveTabBetweenPanes` bug: promotion branch now guarded by `fromPane === 'left'` so it only fires when the move itself emptied the left pane. Updated one test expectation to match documented UX invariant ("never show only a right pane"): after 3 left→right moves, tabs are promoted back to left.
- **empty-pane** — rewrote `ui/src/components/layout/editor/EmptyPane.tsx` to accept optional `isDragOver?: boolean` prop, render dotted-border placeholder with "No tab open — drag a tab here or open from the sidebar" message, conditional accent styling on drag-over, `data-testid="editor-empty-pane"`.

## Verification
- `tabsStore.panes.test.ts`: 10/10 passed (733ms)
- Wave-1 files are TS-clean in isolation; full-project tsc still fails on consumers (App.tsx, TabBar.tsx, PinnedTabBar.tsx) — expected, will be resolved in later waves.
