# Wave 3 Implementation — Split Tab Panes

## Tasks
- **split-tab-bar** — `SplitTabBar.tsx` composes two `TabBar` instances. Renders single-pane when `panes.right.tabs.length === 0`; otherwise splits with two flex-1 wrappers, each mousedown-sets the active pane. Forwards `onContextMenu`. Tests: 3/3 passing.

## Verification
- `SplitTabBar.test.tsx`: 3/3 (49ms).
- tsc clean within SplitTabBar.tsx.
