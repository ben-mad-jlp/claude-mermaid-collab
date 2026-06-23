# Wave 5 Implementation — Split Tab Panes

## Tasks
- **app-dual-routing** — `App.tsx` now derives per-pane `leftItem`/`rightItem` via `resolveItem(tab)` from each pane's active tab; `activeItem = activePaneId === 'right' ? rightItem : leftItem`; kept `selectedItem = activeItem` alias so existing toolbar/auto-save wiring works unchanged. `handleContentChange` now `(itemId, content, pane)`; updates `localContent` only when `pane === activePaneId && itemId === activeItem?.id`. Replaced single TabBar+UnifiedEditor/DocumentView block with `<SplitEditorHost>`. Non-editor branches (task-graph, embed, image, pseudo) use `<SplitTabBar />`. Fixed `useEditorAutoPromote` / `useTabKeyboard` to read from `entry.panes[activePaneId]`.

## Dependent edits this wave
- **SplitEditorHost.tsx** — `renderPane(item, pane)` branches to `DocumentView` for `item.type === 'document'`, else `UnifiedEditor`. New UX: when right pane has no tabs, renders leftNode directly (no SplitPane). Introduced local `primarySize` state driven by `SplitPane.onSizeChange`; passes `primarySizePercent` into `SplitTabBar` so the tab bars track the splitter.
- **SplitTabBar.tsx** — accepts optional `primarySizePercent`; when provided, pane wrappers use inline `style={{width: N%}}` instead of `flex-1` so bars align with the editor splitter. Renders `PinnedTabBar` per pane.

## UX requirements addressed
- Right pane now only shows when it has tabs (no stub/empty split).
- Tab bar widths follow the editor splitter position.

## Follow-ups (deferred)
- Per-pane `localContent` + auto-save (single-pane auto-save only).
- Cmd+Z (undo/redo) placeholder.
- History/zoom/preview props not yet threaded through SplitEditorHost.

## Verification
- Full tsc: no errors in wave-5 files.
- Tests: 23/23 passed (tabsStore.panes, EditorAreaDropZones, SplitTabBar, SplitEditorHost).
